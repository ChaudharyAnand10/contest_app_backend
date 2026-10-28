

const mongoose = require("mongoose");

const contestSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      required: true,
    },

    // Contest banner image URL
    imageUrl: {
      type: String,
      default: "",
      trim: true,
    },

    price: {
      type: Number,
      required: true,
      min: 0,
    },

    startDate: {
      type: Date,
      required: true,
    },

    totalDays: {
      type: Number,
      default: 7,
      min: 1,
    },

    dailyQuestionCount: {
      type: Number,
      default: 5,
      min: 1,
    },

    durationMinutes: {
      type: Number,
      default: 30,
      min: 1,
    },

    dailyStartHour: {
      type: Number,
      default: 20,
      min: 0,
      max: 23,
    },

    dailyStartMinute: {
      type: Number,
      default: 0,
      min: 0,
      max: 59,
    },

    maxParticipants: {
      type: Number,
      default: null,
      min: 1,
    },

    // Paid enrollments + temporary active reservations
    reservedParticipants: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Contest", contestSchema);