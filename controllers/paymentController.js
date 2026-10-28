
const mongoose = require("mongoose");
const Razorpay = require("razorpay");
const crypto = require("crypto");

const User = require("../models/User");
const Contest = require("../models/Contest");
const Enrollment = require("../models/Enrollment");
const PaymentOrder = require("../models/PaymentOrder");

const sendPushNotification = require("../utils/sendPushNotification");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const RESERVATION_MINUTES = 10;

// --------------------------------------------------
// Send notification after successful enrollment.
// Notification failure must not fail a payment.
// --------------------------------------------------

const notifyEnrollmentSuccess = async ({
  userId,
  contestId,
}) => {
  try {
    const [user, contest] = await Promise.all([
      User.findById(userId)
        .select("+fcmToken")
        .lean(),

      Contest.findById(contestId)
        .select("title")
        .lean(),
    ]);

    if (!user?.fcmToken) {
      console.log(
        "FCM token missing. Notification skipped:",
        String(userId)
      );
      return;
    }

    const contestTitle = contest?.title || "your contest";

    const messageId = await sendPushNotification({
      fcmToken: user.fcmToken,
      title: "Payment Successful! 🎉",
      body: `Your enrollment for ${contestTitle} is confirmed.`,
      data: {
        type: "enrollment_success",
        contestId: String(contestId),
      },
    });

    if (messageId) {
      console.log(
        "Enrollment notification sent:",
        messageId
      );
    } else {
      console.error(
        "Enrollment notification was not sent:",
        String(userId)
      );
    }
  } catch (error) {
    console.error(
      "Enrollment notification error:",
      error.message
    );
  }
};

// --------------------------------------------------
// Helpers
// --------------------------------------------------

const isValidObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id);

const getUserId = (req) =>
  req.user?._id || req.user?.id;

const isDuplicateKeyError = (error) =>
  error?.code === 11000;

const sendError = (res, status, message, extra = {}) =>
  res.status(status).json({ message, ...extra });

// --------------------------------------------------
// Release reservation exactly once.
// --------------------------------------------------


const releaseReservation = async (orderId, status) => {
  if (!["failed", "expired"].includes(status)) {
    throw new Error("Invalid reservation release status");
  }

  const session = await mongoose.startSession();

  try {
    let releasedOrder = null;

    await session.withTransaction(async () => {
      // Only one request can claim this reservation for release.
      const order = await PaymentOrder.findOneAndUpdate(
        {
          _id: orderId,
          status: "created",
          slotReserved: true,
          ...(status === "expired"
            ? { reservationExpiresAt: { $lte: new Date() } }
            : {}),
        },
        {
          $set: {
            status,
            slotReserved: false,
          },
        },
        {
          new: true,
          session,
        }
      );

      // Already released, paid, or otherwise changed.
      if (!order) {
        releasedOrder = null;
        return;
      }

      const contestResult = await Contest.updateOne(
        {
          _id: order.contestId,
          reservedParticipants: { $gt: 0 },
        },
        {
          $inc: { reservedParticipants: -1 },
        },
        { session }
      );

      if (contestResult.modifiedCount !== 1) {
        // Throwing aborts both database changes.
        throw new Error(
          `Unable to decrement reservation counter for contest ${order.contestId}`
        );
      }

      releasedOrder = order;
    });

    return releasedOrder;
  } catch (error) {
    console.error(
      "Release reservation transaction failed:",
      String(orderId),
      error.message
    );

    throw error;
  } finally {
    await session.endSession();
  }
};



// --------------------------------------------------
// Expire pending orders.
// --------------------------------------------------



const expirePendingOrders = async () => {
  const now = new Date();

  const expiredOrders = await PaymentOrder.find({
    status: "created",
    slotReserved: true,
    reservationExpiresAt: { $lte: now },
  })
    .select("_id")
    .lean();

  let released = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of expiredOrders) {
    try {
      const localOrder = await PaymentOrder.findById(
        item._id
      ).lean();

      if (
        !localOrder ||
        localOrder.status !== "created" ||
        !localOrder.slotReserved
      ) {
        skipped++;
        continue;
      }

      // Check Razorpay before releasing an expired reservation.
      const providerPayments =
        await razorpay.orders.fetchPayments(
          localOrder.razorpayOrderId
        );

      const hasCapturedPayment = (
        providerPayments?.items || []
      ).some(
        (payment) =>
          payment.status === "captured" &&
          payment.order_id === localOrder.razorpayOrderId
      );

      if (hasCapturedPayment) {
        console.warn(
          "Captured payment found; reservation retained for reconciliation:",
          localOrder.razorpayOrderId
        );

        skipped++;
        continue;
      }

      const order = await releaseReservation(
        item._id,
        "expired"
      );

      if (order) {
        released++;
      } else {
        skipped++;
      }
    } catch (error) {
      failed++;

      console.error(
        "Reservation expiry failed:",
        String(item._id),
        error.message
      );
    }
  }

  return {
    found: expiredOrders.length,
    released,
    skipped,
    failed,
  };
};





// Reserve a seat atomically, subject to the contest's capacity.
const reserveContestSlot = async (contestId, session) => {
  return Contest.findOneAndUpdate(
    {
      _id: contestId,
      $or: [
        { maxParticipants: null },
        { maxParticipants: { $exists: false } },
        {
          $expr: {
            $lt: [
              { $ifNull: ["$reservedParticipants", 0] },
              "$maxParticipants",
            ],
          },
        },
      ],
    },
    {
      $inc: { reservedParticipants: 1 },
    },
    {
      new: true,
      session,
    }
  );
};

// --------------------------------------------------
// Create Razorpay order + reserve participant slot.
// --------------------------------------------------


const createOrder = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { contestId } = req.body;

    if (!userId) {
      return sendError(res, 401, "Authentication required");
    }

    if (!contestId || !isValidObjectId(contestId)) {
      return sendError(res, 400, "Valid contest ID is required");
    }

    if (
      !process.env.RAZORPAY_KEY_ID ||
      !process.env.RAZORPAY_KEY_SECRET
    ) {
      console.error("Razorpay credentials are missing");
      return sendError(res, 500, "Payment service is not configured");
    }

    // Release expired reservations before checking for reuse.
    await expirePendingOrders();

    const contest = await Contest.findById(contestId).lean();

    if (!contest) {
      return sendError(res, 404, "Contest not found");
    }

    if (!Number.isFinite(contest.price) || contest.price < 1) {
      return sendError(
        res,
        400,
        "Contest price must be at least ₹1"
      );
    }

    const amount = Math.round(contest.price * 100);

    if (!Number.isSafeInteger(amount) || amount < 100) {
      return sendError(res, 400, "Invalid contest price");
    }

    const existingEnrollment = await Enrollment.findOne({
      userId,
      contestId,
      status: "paid",
    }).lean();

    if (existingEnrollment) {
      return sendError(res, 409, "You are already enrolled");
    }

    // Reuse the most recent order for this user and contest.
    const existingOrder = await PaymentOrder.findOne({
      userId,
      contestId,
      status: { $in: ["created", "expired"] },
    })
      .sort({ createdAt: -1 })
      .lean();

    if (existingOrder) {
      const providerOrder = await razorpay.orders.fetch(
        existingOrder.razorpayOrderId
      );

      const providerPayments = await razorpay.orders.fetchPayments(
  existingOrder.razorpayOrderId
);

const capturedPayments = (providerPayments?.items || []).filter(
  (payment) =>
    payment.order_id === existingOrder.razorpayOrderId &&
    payment.status === "captured"
);

if (capturedPayments.length > 0) {
  console.error("Captured payment found on reusable order", {
    paymentOrderId: String(existingOrder._id),
    razorpayOrderId: existingOrder.razorpayOrderId,
    paymentIds: capturedPayments.map((payment) => payment.id),
  });

  return sendError(
    res,
    409,
    "Payment already captured. Please refresh enrollment or contact support."
  );
}

      // Never reopen an order already paid at Razorpay.
      if (providerOrder.status === "paid") {
        return sendError(
          res,
          409,
          "Payment is already completed. Please refresh your enrollments."
        );
      }

      const reusable =
        ["created", "attempted"].includes(providerOrder.status) &&
        providerOrder.amount === amount &&
        providerOrder.currency === "INR" &&
        providerOrder.amount_due === amount;

      if (!reusable) {
        return sendError(
          res,
          409,
          "This payment order cannot be reused. Please contact support."
        );
      }

      const now = new Date();

      // Existing reservation is still valid.
      if (
        existingOrder.status === "created" &&
        existingOrder.slotReserved === true &&
        existingOrder.reservationExpiresAt > now
      ) {
        return res.status(200).json({
          message: "Existing payment order reused",
          orderId: existingOrder.razorpayOrderId,
          amount: existingOrder.amount,
          currency: existingOrder.currency,
          keyId: process.env.RAZORPAY_KEY_ID,
          reservationExpiresAt: existingOrder.reservationExpiresAt,
          reservationMinutes: RESERVATION_MINUTES,
          reused: true,
        });
      }

      // Reacquire the seat and reactivate an expired order atomically.
      const session = await mongoose.startSession();

      try {
        let reactivatedOrder = null;
        let contestFull = false;

        await session.withTransaction(async () => {
          const reservedContest = await reserveContestSlot(
            contestId,
            session
          );

          if (!reservedContest) {
            contestFull = true;
            return;
          }

          const reservationExpiresAt = new Date(
            Date.now() + RESERVATION_MINUTES * 60 * 1000
          );

          const claimedOrder = await PaymentOrder.findOneAndUpdate(
            {
              _id: existingOrder._id,
              userId,
              contestId,
              status: "expired",
              slotReserved: false,
            },
            {
              $set: {
                status: "created",
                slotReserved: true,
                reservationExpiresAt,
              },
            },
            {
              new: true,
              session,
            }
          );

          if (!claimedOrder) {
            // Abort the transaction so the seat increment is rolled back.
            throw new Error("ORDER_ALREADY_CLAIMED");
          }

          reactivatedOrder = claimedOrder;
        });

        if (contestFull) {
          return sendError(res, 409, "Contest is full", {
            contestFull: true,
          });
        }

        if (!reactivatedOrder) {
          return sendError(
            res,
            409,
            "Payment order is being processed. Please try again."
          );
        }

        return res.status(200).json({
          message: "Existing payment order reused",
          orderId: reactivatedOrder.razorpayOrderId,
          amount: reactivatedOrder.amount,
          currency: reactivatedOrder.currency,
          keyId: process.env.RAZORPAY_KEY_ID,
          reservationExpiresAt: reactivatedOrder.reservationExpiresAt,
          reservationMinutes: RESERVATION_MINUTES,
          reused: true,
        });
      } catch (error) {
        if (error.message === "ORDER_ALREADY_CLAIMED") {
          return sendError(
            res,
            409,
            "Payment order is being processed. Please try again."
          );
        }

        throw error;
      } finally {
        await session.endSession();
      }
    }

    // Create the provider order first. The local reservation and
    // PaymentOrder record are then committed together in MongoDB.

    const receipt = `c_${Date.now()}`;
    const razorpayOrder = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt,
      notes: {
        contestId: contestId.toString(),
        userId: userId.toString(),
      },
    });

    const reservationExpiresAt = new Date(
      Date.now() + RESERVATION_MINUTES * 60 * 1000
    );

    const session = await mongoose.startSession();

    try {
      let paymentOrder = null;
      let contestFull = false;

      await session.withTransaction(async () => {
        const reservedContest = await reserveContestSlot(
          contestId,
          session
        );

        if (!reservedContest) {
          contestFull = true;
          return;
        }

        const [createdOrder] = await PaymentOrder.create(
          [
            {
              userId,
              contestId,
              razorpayOrderId: razorpayOrder.id,
              amount: razorpayOrder.amount,
              currency: razorpayOrder.currency,
              status: "created",
              slotReserved: true,
              reservationExpiresAt,
            },
          ],
          { session }
        );

        paymentOrder = createdOrder;
      });

      if (contestFull) {
        return sendError(res, 409, "Contest is full", {
          contestFull: true,
        });
      }

      return res.status(201).json({
        message: "Payment order created",
        orderId: paymentOrder.razorpayOrderId,
        amount: paymentOrder.amount,
        currency: paymentOrder.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
        reservationExpiresAt: paymentOrder.reservationExpiresAt,
        reservationMinutes: RESERVATION_MINUTES,
        reused: false,
      });
    } finally {
      await session.endSession();
    }
  } catch (error) {
    console.error("Create order failed:", error);

    if (isDuplicateKeyError(error)) {
      return sendError(
        res,
        409,
        "A payment order is already pending"
      );
    }

    return sendError(
      res,
      500,
      "Unable to create payment order"
    );
  }
};



// --------------------------------------------------
// Request refund for an expired/failed order.
// --------------------------------------------------


const requestRefund = async (paymentOrder, paymentId, reason) => {
  if (!paymentOrder?._id || !paymentId) {
    throw new Error("Payment order and payment ID are required");
  }

  // Payment ID must match the payment recorded locally.
  if (
    paymentOrder.razorpayPaymentId &&
    String(paymentOrder.razorpayPaymentId) !== String(paymentId)
  ) {
    throw new Error("Refund payment ID does not match PaymentOrder");
  }

  // Atomically claim refund initiation.
  // Only one request can claim this order.
  const claimed = await PaymentOrder.findOneAndUpdate(
    {
      _id: paymentOrder._id,
      status: { $in: ["expired", "failed"] },
      slotReserved: false,
      $or: [
        { razorpayPaymentId: null },
        { razorpayPaymentId: { $exists: false } },
        { razorpayPaymentId: paymentId },
      ],
    },
    {
      $set: {
        status: "refund_pending",
        razorpayPaymentId: paymentId,
        refundReason: String(reason || "Contest payment refund").slice(0, 200),
        refundInitiatedAt: new Date(),
        lastProcessingError: null,
      },
    },
    { new: true }
  );

  if (!claimed) {
    const latest = await PaymentOrder.findById(
      paymentOrder._id
    ).lean();

    return {
      status: latest?.status || "unknown",
      message:
        "Refund was not started by this request. Check the latest order state.",
      refundId: latest?.razorpayRefundId || null,
    };
  }

  try {
    const refund = await razorpay.payments.refund(paymentId, {
      amount: claimed.amount,
      notes: {
        reason: String(reason || "Contest payment refund").slice(0, 200),
        contestId: String(claimed.contestId),
        paymentOrderId: String(claimed._id),
      },
    });

    // Validate Razorpay's response.
    if (
      !refund?.id ||
      String(refund.payment_id) !== String(paymentId) ||
      !["pending", "processed", "failed"].includes(refund.status)
    ) {
      throw new Error(
        "Refund response is incomplete or does not match the payment"
      );
    }

    const processed = refund.status === "processed";

    const updateResult = await PaymentOrder.updateOne(
      {
        _id: claimed._id,
        status: "refund_pending",
        razorpayPaymentId: paymentId,
      },
      {
        $set: {
          razorpayRefundId: refund.id,
          status: processed ? "refunded" : "refund_pending",
          refundedAt: processed ? new Date() : null,
          lastProcessingError:
            refund.status === "failed"
              ? "Razorpay refund failed; manual review required"
              : refund.status === "pending"
                ? "Razorpay refund is still pending"
                : null,
        },
      }
    );

    // Do not report a locally saved result if the DB update
    // did not match or modify the expected record.
    if (updateResult.matchedCount !== 1) {
      throw new Error(
        `Refund ${refund.id} was returned by Razorpay, but the PaymentOrder state could not be updated`
      );
    }

    return {
      status: processed ? "refunded" : "refund_pending",
      message:
        refund.status === "processed"
          ? "Refund processed successfully"
          : refund.status === "pending"
            ? "Refund is pending; reconciliation required"
            : "Refund failed at provider; manual review required",
      refundId: refund.id,
    };
  } catch (error) {
    console.error("Refund request/result handling failed:", error);

    // The refund might already exist at Razorpay even if the
    // request timed out or the local DB update failed.
    // Never automatically initiate another refund here.
    try {
      await PaymentOrder.updateOne(
        {
          _id: claimed._id,
          status: "refund_pending",
          razorpayPaymentId: paymentId,
        },
        {
          $set: {
            lastProcessingError: String(
              error?.message || error
            ).slice(0, 1000),
          },
        }
      );
    } catch (dbError) {
      console.error(
        "Unable to record refund error:",
        dbError.message
      );
    }

    // Re-read the local record in case the refund ID was saved
    // before a later error occurred.
    let latest = null;

    try {
      latest = await PaymentOrder.findById(
        claimed._id
      ).lean();
    } catch (dbError) {
      console.error("Unable to reload PaymentOrder:", dbError.message);
    }

    return {
      status: latest?.status || "refund_pending",
      message:
        "Refund outcome may be uncertain. Reconcile with Razorpay before retrying.",
      refundId:
        latest?.razorpayRefundId || null,
    };
  }
};




const reconcilePendingRefunds = async () => {
  const pendingOrders = await PaymentOrder.find({
    status: "refund_pending",
    razorpayPaymentId: { $type: "string" },
  })
    .select(
      "_id razorpayPaymentId razorpayRefundId amount currency lastProcessingError"
    )
    .lean();

  const stats = {
    found: pendingOrders.length,
    processed: 0,
    pending: 0,
    failed: 0,
  };

  for (const order of pendingOrders) {
    try {
      let refund = null;

      // If we already know the refund ID, fetch that exact refund.
      if (order.razorpayRefundId) {
        refund = await razorpay.refunds.fetch(
          order.razorpayRefundId,
          { payment_id: order.razorpayPaymentId }
        );
      } else {
        // Search provider refunds for this payment.
        const result = await razorpay.refunds.all({
          payment_id: order.razorpayPaymentId,
          count: 100,
        });

        const items = result?.items || [];

        // Match our unique PaymentOrder ID from refund notes.
        const matches = items.filter((item) => {
          const notes = item.notes || {};

          return (
            item.payment_id === order.razorpayPaymentId &&
            String(notes.paymentOrderId || "") === String(order._id)
          );
        });

        if (matches.length > 1) {
          throw new Error(
            "Multiple refunds match this PaymentOrder; manual review required"
          );
        }

        refund = matches[0] || null;
      }

      if (!refund) {
        // Absence from the provider list is not proof that a
        // timed-out refund request was never accepted.
        await PaymentOrder.updateOne(
          {
            _id: order._id,
            status: "refund_pending",
          },
          {
            $set: {
              lastProcessingError:
                "Refund not found in provider query; verify manually before retrying",
            },
          }
        );

        stats.pending++;
        continue;
      }

      // Validate that the refund belongs to this exact payment.
      if (
        refund.payment_id !== order.razorpayPaymentId ||
        !refund.id ||
        !["pending", "processed", "failed"].includes(refund.status)
      ) {
        throw new Error("Provider refund details failed validation");
      }

      const processed = refund.status === "processed";

      const update = await PaymentOrder.updateOne(
        {
          _id: order._id,
          status: "refund_pending",
          razorpayPaymentId: order.razorpayPaymentId,
        },
        {
          $set: {
            razorpayRefundId: refund.id,
            status: processed ? "refunded" : "refund_pending",
            refundedAt: processed ? new Date() : null,
            lastProcessingError:
              refund.status === "pending"
                ? "Razorpay refund is still pending"
                : refund.status === "failed"
                  ? "Razorpay refund failed; manual review required"
                  : null,
          },
        }
      );

      if (update.modifiedCount === 0) {
        // Another process may have changed the order.
        continue;
      }

      if (processed) {
        stats.processed++;
      } else if (refund.status === "pending") {
        stats.pending++;
      } else {
        stats.failed++;
      }
    } catch (error) {
      stats.pending++;

      console.error(
        "Refund reconciliation failed:",
        String(order._id),
        error.message
      );

      try {
        await PaymentOrder.updateOne(
          {
            _id: order._id,
            status: "refund_pending",
          },
          {
            $set: {
              lastProcessingError: String(error.message).slice(0, 1000),
            },
          }
        );
      } catch (dbError) {
        console.error(
          "Unable to record reconciliation error:",
          dbError.message
        );
      }
    }
  }

  return stats;
};




const ensureEnrollmentForCapturedPayment = async (
  paymentOrder,
  paymentId
) => {
  // 1. Validate before accessing object properties.
  if (!paymentOrder || !paymentId) {
    return {
      success: false,
      created: false,
      enrollment: null,
      conflict: true,
      reason: "Payment order or payment ID is missing",
    };
  }

  const orderId = paymentOrder.razorpayOrderId;

  if (!orderId) {
    return {
      success: false,
      created: false,
      enrollment: null,
      conflict: true,
      reason: "Razorpay order ID is missing",
    };
  }

  // 2. Only a locally paid order may create/recover enrollment.
  if (paymentOrder.status !== "paid") {
    return {
      success: false,
      created: false,
      enrollment: null,
      conflict: true,
      reason: "Payment order is not in paid status",
    };
  }

  // 3. A paid order must have a recorded payment ID.
  if (!paymentOrder.razorpayPaymentId) {
    return {
      success: false,
      created: false,
      enrollment: null,
      conflict: true,
      reason: "Paid order has no recorded payment ID",
    };
  }

  // 4. The incoming captured payment must match the recorded payment.
  if (
    String(paymentOrder.razorpayPaymentId) !==
    String(paymentId)
  ) {
    return {
      success: false,
      created: false,
      enrollment: null,
      conflict: true,
      reason: "Payment ID mismatch; reconciliation required",
    };
  }

  // 5. Check for an existing enrollment.
  const existing = await Enrollment.findOne({
    userId: paymentOrder.userId,
    contestId: paymentOrder.contestId,
  });

  if (existing) {
    const matches =
      existing.status === "paid" &&
      String(existing.orderId) === String(orderId) &&
      String(existing.paymentId) === String(paymentId);

    return {
      success: matches,
      created: false,
      enrollment: existing,
      conflict: !matches,
      reason: matches
        ? null
        : "Existing enrollment conflicts with this payment",
    };
  }

  // 6. Create the enrollment.
  try {
    const enrollment = await Enrollment.create({
      userId: paymentOrder.userId,
      contestId: paymentOrder.contestId,
      paymentId,
      orderId,
      status: "paid",
    });

    // Notification failure must not invalidate the enrollment.
    await notifyEnrollmentSuccess({
      userId: paymentOrder.userId,
      contestId: paymentOrder.contestId,
    });

    return {
      success: true,
      created: true,
      enrollment,
      conflict: false,
      reason: null,
    };
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }

    // Another request may have created the enrollment concurrently.
    const duplicate = await Enrollment.findOne({
      userId: paymentOrder.userId,
      contestId: paymentOrder.contestId,
    });

    if (!duplicate) {
      throw error;
    }

    const matches =
      duplicate.status === "paid" &&
      String(duplicate.orderId) === String(orderId) &&
      String(duplicate.paymentId) === String(paymentId);

    return {
      success: matches,
      created: false,
      enrollment: duplicate,
      conflict: !matches,
      reason: matches
        ? null
        : "Concurrent enrollment belongs to another payment",
    };
  }
};
// --------------------------------------------------
// Verify payment and create/recover enrollment.
// --------------------------------------------------


const verifyPayment = async (req, res) => {
  try {
    const userId = getUserId(req);

    const {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
    } = req.body;

    if (!userId) {
      return sendError(res, 401, "Authentication required");
    }

    if (!orderId || !paymentId || !signature) {
      return sendError(res, 400, "Payment details missing");
    }

    if (!process.env.RAZORPAY_KEY_SECRET) {
      return sendError(res, 500, "Payment service is not configured");
    }

    const paymentOrder = await PaymentOrder.findOne({
      razorpayOrderId: orderId,
      userId,
    });

    if (!paymentOrder) {
      return sendError(res, 404, "Payment order not found");
    }

    // 1. Checkout signature verify karo.
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    if (
      !/^[a-f0-9]{64}$/i.test(signature) ||
      !crypto.timingSafeEqual(
        Buffer.from(signature, "hex"),
        Buffer.from(expectedSignature, "hex")
      )
    ) {
      return sendError(res, 400, "Invalid payment signature");
    }

    // 2. Razorpay se trusted payment details lo.
    const payment = await razorpay.payments.fetch(paymentId);

    if (
      payment.id !== paymentId ||
      payment.order_id !== orderId ||
      payment.amount !== paymentOrder.amount ||
      payment.currency !== paymentOrder.currency
    ) {
      return sendError(
        res,
        400,
        "Payment details do not match the order"
      );
    }

    if (payment.status !== "captured") {
  return sendError(res, 409, "Payment is not captured", {
    paymentStatus: payment.status,
  });
}

    let current = await PaymentOrder.findById(paymentOrder._id);

    if (!current) {
      return sendError(res, 404, "Payment order not found");
    }

    // 3. Already-paid order par enrollment recover karo.
    if (current.status === "paid") {
      const result = await ensureEnrollmentForCapturedPayment(
        current,
        payment.id
      );

      if (result.success) {
        return res.json({
          message: result.created
            ? "Enrollment recovered"
            : "Already enrolled",
          enrollment: result.enrollment,
        });
      }

      await PaymentOrder.updateOne(
        { _id: current._id, status: "paid" },
        {
          $set: {
            lastProcessingError:
              "Captured payment conflicts with existing enrollment",
          },
        }
      );

      return sendError(
        res,
        409,
        "Payment needs reconciliation because another enrollment exists"
      );
    }

    if (
      current.status === "refund_pending" ||
      current.status === "refunded"
    ) {
      return sendError(
        res,
        409,
        "This payment is being refunded or has been refunded",
        { paymentStatus: current.status }
      );
    }

    // 4. Released reservation wale captured payment ko refund karo.
    if (["expired", "failed"].includes(current.status)) {
      const refund = await requestRefund(
        current,
        payment.id,
        "Captured payment found after reservation was released"
      );

      return sendError(res, 409, refund.message, {
        paymentStatus: refund.status,
        refundId: refund.refundId || null,
      });
    }

    // 5. Reservation expiry check.
    if (
      current.status === "created" &&
      (
        current.slotReserved !== true ||
        !current.reservationExpiresAt ||
        current.reservationExpiresAt <= new Date()
      )
    ) {
      await releaseReservation(current._id, "expired");
      current = await PaymentOrder.findById(current._id);

      if (!current) {
        return sendError(res, 404, "Payment order not found");
      }

      // Ho sakta hai concurrent request ne status change kar diya ho.
      if (current.status === "paid") {
        const result = await ensureEnrollmentForCapturedPayment(
          current,
          payment.id
        );

        if (result.success) {
          return res.json({
            message: result.created
              ? "Enrollment recovered"
              : "Already enrolled",
            enrollment: result.enrollment,
          });
        }

        return sendError(
          res,
          409,
          "Payment needs reconciliation"
        );
      }

      if (["expired", "failed"].includes(current.status)) {
        const refund = await requestRefund(
          current,
          payment.id,
          "Payment captured after reservation expired"
        );

        return sendError(res, 409, refund.message, {
          paymentStatus: refund.status,
          refundId: refund.refundId || null,
        });
      }
    }

    if (
      current.status !== "created" ||
      current.slotReserved !== true ||
      !current.reservationExpiresAt ||
      current.reservationExpiresAt <= new Date()
    ) {
      return sendError(
        res,
        409,
        "Reservation is no longer available",
        { paymentStatus: current.status }
      );
    }

    // 6. Atomic claim: verifyPayment aur webhook mein sirf
    // ek request created -> paid transition jeet sakti hai.
    const claimedOrder = await PaymentOrder.findOneAndUpdate(
      {
        _id: current._id,
        status: "created",
        slotReserved: true,
        reservationExpiresAt: { $gt: new Date() },
      },
      {
        $set: {
          status: "paid",
          slotReserved: false,
          razorpayPaymentId: payment.id,
          lastProcessingError: null,
        },
      },
      { new: true }
    );

    if (!claimedOrder) {
      // Doosri request jeet chuki ho sakti hai.
      const latest = await PaymentOrder.findById(current._id);

      if (latest?.status === "paid") {
        const result = await ensureEnrollmentForCapturedPayment(
          latest,
          payment.id
        );

        if (result.success) {
          return res.json({
            message: result.created
              ? "Enrollment recovered"
              : "Already enrolled",
            enrollment: result.enrollment,
          });
        }

        return sendError(
          res,
          409,
          "Payment needs reconciliation because another enrollment exists"
        );
      }

      if (latest && ["expired", "failed"].includes(latest.status)) {
        const refund = await requestRefund(
          latest,
          payment.id,
          "Reservation expired during payment verification"
        );

        return sendError(res, 409, refund.message, {
          paymentStatus: refund.status,
          refundId: refund.refundId || null,
        });
      }

      return sendError(
        res,
        409,
        "Payment is being processed or reservation is unavailable"
      );
    }

    // 7. Order paid hai. Enrollment creation fail hui toh
    // order paid hi rahega; retry/reconciliation use recover karegi.
    try {
      const result = await ensureEnrollmentForCapturedPayment(
        claimedOrder,
        payment.id
      );

      if (!result.success) {
        await PaymentOrder.updateOne(
          { _id: claimedOrder._id, status: "paid" },
          {
            $set: {
              lastProcessingError:
                "Enrollment conflict after payment capture",
            },
          }
        );

        return sendError(
          res,
          409,
          "Payment captured, but enrollment needs reconciliation"
        );
      }

      return res.json({
        message: result.created
          ? "Payment verified and enrollment successful"
          : "Already enrolled",
        enrollment: result.enrollment,
      });
    } catch (error) {
      await PaymentOrder.updateOne(
        { _id: claimedOrder._id, status: "paid" },
        {
          $set: {
            lastProcessingError: String(error.message).slice(0, 1000),
          },
        }
      );

      console.error("Enrollment creation/recovery failed:", error);

      return sendError(
        res,
        500,
        "Payment captured, but enrollment needs recovery. Please retry."
      );
    }
  } catch (error) {
    console.error("Payment verification failed:", error);

    return sendError(res, 500, "Payment verification failed");
  }
};





const razorpayWebhook = async (req, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers["x-razorpay-signature"];

  if (!webhookSecret) {
    console.error("RAZORPAY_WEBHOOK_SECRET is not configured");
    return res.status(500).send("Webhook is not configured");
  }

  if (!Buffer.isBuffer(req.body)) {
    console.error("Webhook raw body missing");
    return res.status(400).send("Invalid webhook body");
  }

  if (typeof signature !== "string") {
    return res.status(400).send("Missing webhook signature");
  }

  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(req.body)
    .digest("hex");

  const suppliedBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");

  if (
    !/^[a-f0-9]{64}$/i.test(signature) ||
    suppliedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return res.status(400).send("Invalid webhook signature");
  }

  let event;

  try {
    event = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.status(400).send("Invalid webhook JSON");
  }

  if (event.event !== "payment.captured") {
    return res.status(200).json({
      received: true,
      ignored: true,
    });
  }

  const eventPayment = event.payload?.payment?.entity;
  const orderId = eventPayment?.order_id;
  const paymentId = eventPayment?.id;

  if (!orderId || !paymentId) {
    return res.status(400).send("Missing payment details");
  }

  try {
    // Razorpay API se payment independently verify karo.
    const payment = await razorpay.payments.fetch(paymentId);

    if (
      payment.id !== paymentId ||
      payment.order_id !== orderId ||
      payment.status !== "captured"
    ) {
      console.error("Captured payment validation failed", {
        orderId,
        paymentId,
        paymentStatus: payment.status,
      });

      // Invalid/inconsistent payload ko acknowledge karne ke bajaye
      // retryable error dena zaroori ho sakta hai. Yahan 400 use kar rahe hain.
      return res.status(400).send("Payment validation failed");
    }

    const current = await PaymentOrder.findOne({
      razorpayOrderId: orderId,
    });

    if (!current) {
      console.error("PaymentOrder not found; reconciliation required", {
        orderId,
        paymentId,
      });

      // Is event ko log/reconciliation process se recover karna hoga.
      // Repeated retry se missing local order khud create nahi hoga.
      return res.status(200).json({
        received: true,
        reconciliationRequired: true,
      });
    }

    if (
      payment.amount !== current.amount ||
      payment.currency !== current.currency
    ) {
      await PaymentOrder.updateOne(
        { _id: current._id },
        {
          $set: {
            lastProcessingError:
              "Webhook payment amount/currency mismatch",
          },
        }
      );

      console.error("Webhook amount/currency mismatch", {
        orderId,
        paymentId,
      });

      return res.status(200).json({
        received: true,
        reconciliationRequired: true,
      });
    }

    // Paid order par enrollment missing ho toh recover karo.
    if (current.status === "paid") {
      const result = await ensureEnrollmentForCapturedPayment(
        current,
        payment.id
      );

      if (result.success) {
        return res.status(200).json({
          received: true,
          alreadyProcessed: !result.created,
          enrollmentRecovered: result.created,
        });
      }

      await PaymentOrder.updateOne(
        { _id: current._id, status: "paid" },
        {
          $set: {
            lastProcessingError:
              "Captured payment conflicts with existing enrollment",
          },
        }
      );

      console.error("Webhook enrollment conflict", {
        orderId,
        paymentId,
      });

      // Manual reconciliation chahiye; blind retries se conflict solve nahi hoga.
      return res.status(200).json({
        received: true,
        reconciliationRequired: true,
      });
    }

    if (
      current.status === "refund_pending" ||
      current.status === "refunded"
    ) {
      return res.status(200).json({
        received: true,
        paymentStatus: current.status,
      });
    }

    if (["expired", "failed"].includes(current.status)) {
      const refund = await requestRefund(
        current,
        payment.id,
        "Captured payment found after reservation was released"
      );

      if (refund.status === "refund_pending") {
        // Refund provider/database processing incomplete ho sakta hai.
        // Retry/reconciliation zaroori hai.
        return res.status(500).json({
          received: true,
          refundPending: true,
        });
      }

      return res.status(200).json({
        received: true,
        paymentStatus: refund.status,
      });
    }

    // Reservation valid honi chahiye.
    if (
      current.status !== "created" ||
      current.slotReserved !== true ||
      !current.reservationExpiresAt ||
      current.reservationExpiresAt <= new Date()
    ) {
      if (current.status === "created") {
        await releaseReservation(current._id, "expired");
      }

      const latest = await PaymentOrder.findById(current._id);

      // Concurrent verifyPayment request order paid kar chuki ho sakti hai.
      if (latest?.status === "paid") {
        const result = await ensureEnrollmentForCapturedPayment(
          latest,
          payment.id
        );

        if (result.success) {
          return res.status(200).json({
            received: true,
            alreadyProcessed: !result.created,
            enrollmentRecovered: result.created,
          });
        }

        await PaymentOrder.updateOne(
          { _id: latest._id, status: "paid" },
          {
            $set: {
              lastProcessingError:
                "Captured payment enrollment conflict during recovery",
            },
          }
        );

        return res.status(200).json({
          received: true,
          reconciliationRequired: true,
        });
      }

      if (latest && ["expired", "failed"].includes(latest.status)) {
        const refund = await requestRefund(
          latest,
          payment.id,
          "Payment captured after reservation expired"
        );

        if (refund.status === "refund_pending") {
          return res.status(500).json({
            received: true,
            refundPending: true,
          });
        }

        return res.status(200).json({
          received: true,
          paymentStatus: refund.status,
        });
      }

      return res.status(200).json({
        received: true,
        reconciliationRequired: true,
      });
    }

    // Atomically claim reservation.
    const claimedOrder = await PaymentOrder.findOneAndUpdate(
      {
        _id: current._id,
        status: "created",
        slotReserved: true,
        reservationExpiresAt: { $gt: new Date() },
      },
      {
        $set: {
          status: "paid",
          slotReserved: false,
          razorpayPaymentId: payment.id,
          lastProcessingError: null,
        },
      },
      { new: true }
    );

    if (!claimedOrder) {
      // Kisi concurrent request ne order change kar diya.
      const latest = await PaymentOrder.findById(current._id);

      if (latest?.status === "paid") {
        const result = await ensureEnrollmentForCapturedPayment(
          latest,
          payment.id
        );

        if (result.success) {
          return res.status(200).json({
            received: true,
            alreadyProcessed: !result.created,
            enrollmentRecovered: result.created,
          });
        }

        await PaymentOrder.updateOne(
          { _id: latest._id, status: "paid" },
          {
            $set: {
              lastProcessingError:
                "Enrollment conflict after concurrent payment processing",
            },
          }
        );

        return res.status(200).json({
          received: true,
          reconciliationRequired: true,
        });
      }

      if (latest && ["expired", "failed"].includes(latest.status)) {
        const refund = await requestRefund(
          latest,
          payment.id,
          "Reservation expired during webhook processing"
        );

        if (refund.status === "refund_pending") {
          return res.status(500).json({
            received: true,
            refundPending: true,
          });
        }

        return res.status(200).json({
          received: true,
          paymentStatus: refund.status,
        });
      }

      // State abhi settle nahi hui: retry ke liye 500.
      return res.status(500).json({
        received: true,
        retryable: true,
      });
    }

    // Order paid hai; enrollment create/recover karo.
    try {
      const result = await ensureEnrollmentForCapturedPayment(
        claimedOrder,
        payment.id
      );

      if (!result.success) {
        await PaymentOrder.updateOne(
          { _id: claimedOrder._id, status: "paid" },
          {
            $set: {
              lastProcessingError:
                "Enrollment conflict after webhook capture",
            },
          }
        );

        console.error("Webhook enrollment conflict after claim", {
          orderId,
          paymentId,
        });

        // Manual reconciliation; duplicate enrollment create nahi karna.
        return res.status(200).json({
          received: true,
          reconciliationRequired: true,
        });
      }

      return res.status(200).json({
        received: true,
        enrollmentCreated: result.created,
        alreadyProcessed: !result.created,
      });
    } catch (error) {
      await PaymentOrder.updateOne(
        { _id: claimedOrder._id, status: "paid" },
        {
          $set: {
            lastProcessingError: String(error.message).slice(0, 1000),
          },
        }
      );

      console.error("Webhook enrollment creation/recovery failed:", error);

      // Transient DB failure par webhook retry karne do.
      return res.status(500).send("Webhook processing failed");
    }
  } catch (error) {
    console.error("Razorpay webhook processing failed:", error);

    return res.status(500).send("Webhook processing failed");
  }
};

// --------------------------------------------------
// Reconcile participant counter.
// --------------------------------------------------


const reconcileContestReservations = async (contestId) => {
  // Step 1: Expired reservations ko safely process karo.
  // Existing function Razorpay payments check karta hai,
  // isliye captured payment ko blindly release nahi karna.
  await expirePendingOrders();

  const now = new Date();

  // Step 2: Sirf paid enrollments count karo.
  const paidEnrollments = await Enrollment.countDocuments({
    contestId,
    status: "paid",
  });

  // Step 3: Sirf active aur unexpired reservations count karo.
  const activeReservations = await PaymentOrder.countDocuments({
    contestId,
    status: "created",
    slotReserved: true,
    reservationExpiresAt: { $gt: now },
  });

  // Step 4: Actual expected counter calculate karo.
  const expectedReservedParticipants =
    paidEnrollments + activeReservations;

  // Step 5: Contest ka counter repair karo.
  const contest = await Contest.findByIdAndUpdate(
    contestId,
    {
      $set: {
        reservedParticipants: expectedReservedParticipants,
      },
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!contest) {
    throw new Error(
      `Contest not found during reservation reconciliation: ${contestId}`
    );
  }

  console.log("Contest reservation reconciliation completed", {
    contestId: String(contestId),
    paidEnrollments,
    activeReservations,
    reservedParticipants: contest.reservedParticipants,
  });

  return {
    contestId: String(contestId),
    paidEnrollments,
    activeReservations,
    reservedParticipants: contest.reservedParticipants,
  };
};


module.exports = {
  createOrder,
  verifyPayment,
  razorpayWebhook,
  expirePendingOrders,
  releaseReservation,
  reconcileContestReservations,
  reconcilePendingRefunds,
};