
const mongoose = require("mongoose");

const paymentOrderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    contestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contest",
      required: true,
      index: true,
    },

    razorpayOrderId: {
      type: String,
      required: true,
      unique: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 100,
    },

    currency: {
      type: String,
      required: true,
      default: "INR",
    },

    status: {
      type: String,
      enum: [
        "created",
        "paid",
        "failed",
        "expired",
        "refund_pending",
        "refunded",
      ],
      default: "created",
      index: true,
    },

    razorpayPaymentId: {
      type: String,
      default: null,
    },

    razorpayRefundId: {
      type: String,
      default: null,
    },

    refundReason: {
      type: String,
      default: null,
    },

    refundInitiatedAt: {
      type: Date,
      default: null,
    },

    refundedAt: {
      type: Date,
      default: null,
    },

    lastProcessingError: {
      type: String,
      default: null,
    },

    slotReserved: {
      type: Boolean,
      default: false,
      index: true,
    },

    reservationExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

// One active reservation/order per user per contest.
paymentOrderSchema.index(
  { userId: 1, contestId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: "created",
      slotReserved: true,
    },
  }
);

// Prevent one Razorpay payment ID being assigned to
// multiple PaymentOrder documents.
paymentOrderSchema.index(
  { razorpayPaymentId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      razorpayPaymentId: { $type: "string" },
    },
  }
);

module.exports = mongoose.model("PaymentOrder", paymentOrderSchema);
