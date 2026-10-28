const User = require("../models/User");
const Enrollment = require("../models/Enrollment");
const Attempt = require("../models/Attempt");

const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select("name username email phone_number createdAt");

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    return res.json({ user });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch profile",
    });
  }
};

const getParticipationHistory = async (req, res) => {
  try {
    const [enrollments, attempts] = await Promise.all([
      Enrollment.find({ userId: req.user._id })
        .populate("contestId", "title startDate totalDays price")
        .sort({ createdAt: -1 }),

      Attempt.find({ userId: req.user._id })
        .populate("contestId", "title")
        .select(
          "contestId dayNumber startedAt expiresAt submittedAt status score totalMarks"
        )
        .sort({ createdAt: -1 }),
    ]);

    return res.json({
      enrollments,
      attempts,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch participation history",
      error: error.message,
    });
  }
};

module.exports = {
  getProfile,
  getParticipationHistory,
};