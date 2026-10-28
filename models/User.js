const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 3,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
    },

    phone_number: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    // Only one active login/session.
    sessionId: {
      type: String,
      default: null,
    },

    // Firebase Cloud Messaging device token.
    fcmToken: {
      type: String,
      default: null,
      select: false,
    },

    fcmTokenUpdatedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);