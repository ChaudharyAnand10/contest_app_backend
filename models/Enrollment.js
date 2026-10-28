
const mongoose = require("mongoose");

const enrollmentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    contestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contest",
      required: true,
    },

    paymentId: {
      type: String,
      required: true,
    },

    orderId: {
      type: String,
      required: true,
    },

    status: {
      type: String,
      enum: ["paid", "cancelled"],
      default: "paid",
    },
  },
  { timestamps: true }
);

enrollmentSchema.index(
  { userId: 1, contestId: 1 },
  { unique: true }
);

module.exports = mongoose.model("Enrollment", enrollmentSchema);
