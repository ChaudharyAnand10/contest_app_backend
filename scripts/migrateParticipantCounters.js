
require("dotenv").config();

const connectDB = require("../config/db");
const Contest = require("../models/Contest");
const Enrollment = require("../models/Enrollment");
const PaymentOrder = require("../models/PaymentOrder");

const migrate = async () => {
  try {
    await connectDB();

    const contests = await Contest.find().select("_id");

    for (const contest of contests) {
      const paidCount = await Enrollment.countDocuments({
        contestId: contest._id,
        status: "paid",
      });

      const activeReservationCount =
        await PaymentOrder.countDocuments({
          contestId: contest._id,
          status: "created",
          slotReserved: true,
          reservationExpiresAt: { $gt: new Date() },
        });

      const occupiedSlots =
        paidCount + activeReservationCount;

      await Contest.updateOne(
        { _id: contest._id },
        {
          $set: {
            reservedParticipants: occupiedSlots,
          },
        }
      );

      console.log({
        contestId: contest._id.toString(),
        paidParticipants: paidCount,
        pendingReservations: activeReservationCount,
        occupiedSlots,
      });
    }

    console.log("Participant counter migration completed.");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
};

migrate();