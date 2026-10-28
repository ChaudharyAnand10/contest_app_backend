const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema(
  {
    contestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contest",
      required: true,
    },

    dayNumber: {
      type: Number,
      required: true,
    },

    question: {
      type: String,
      required: true,
    },

    options: {
      type: [String],
      required: true,
    },

    correctAnswer: {
      type: String,
      required: true,
    },

    marks: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
  }
);

questionSchema.index(
  {
    contestId: 1,
    dayNumber: 1,
  }
);

module.exports = mongoose.model(
  "Question",
  questionSchema
);