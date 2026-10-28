
// utils/expireAttempts.js

const Attempt = require("../models/Attempt");

const EXPIRE_CHECK_INTERVAL = 30 * 1000;

const expireAttempts = async () => {
  try {
    const now = new Date();

    const result = await Attempt.updateMany(
      {
        status: "started",
        expiresAt: { $lte: now },
      },
      {
        $set: {
          status: "expired",
        },
      }
    );

    if (result.modifiedCount > 0) {
      console.log(
        `Expired ${result.modifiedCount} attempt(s)`
      );
    }
  } catch (error) {
    console.error("Attempt expiry job error:", error);
  }
};

const startAttemptExpiryJob = () => {
  // Server start hote hi pending expired attempts check karo.
  void expireAttempts();

  // Uske baad har 30 seconds mein check karo.
  setInterval(() => {
    void expireAttempts();
  }, EXPIRE_CHECK_INTERVAL);

  console.log("Attempt expiry scheduler started");
};

module.exports = {
  startAttemptExpiryJob,
};
