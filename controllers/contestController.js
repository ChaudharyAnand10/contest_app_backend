const Contest = require("../models/Contest");
const Enrollment = require("../models/Enrollment");

const withCapacity = (contest) => {
  const item =
    typeof contest.toObject === "function"
      ? contest.toObject()
      : { ...contest };

  const occupied = item.reservedParticipants || 0;
  const limit = item.maxParticipants ?? null;

  return {
    ...item,
    participantCount: occupied,
    availableParticipants:
      limit === null
        ? null
        : Math.max(0, limit - occupied),
    isFull: limit !== null && occupied >= limit,
  };
};

const getAllContests = async (req, res) => {
  try {
    const contests = await Contest.find().sort({
      createdAt: -1,
    });

    return res.json({
      contests: contests.map(withCapacity),
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch contests",
    });
  }
};

const getContestById = async (req, res) => {
  try {
    const contest = await Contest.findById(req.params.id);

    if (!contest) {
      return res.status(404).json({
        message: "Contest not found",
      });
    }

    return res.json({
      contest: withCapacity(contest),
    });
  } catch (error) {
    return res.status(400).json({
      message: "Invalid contest ID",
    });
  }
};

const getMyContests = async (req, res) => {
  try {
    const enrollments = await Enrollment.find({
      userId: req.user._id,
      status: "paid",
    })
      .populate("contestId")
      .sort({ createdAt: -1 });

    return res.json({
      contests: enrollments
        .filter((item) => item.contestId)
        .map((item) => ({
          ...withCapacity(item.contestId),
          enrollmentStatus: item.status,
          enrollmentId: item._id,
        })),
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch enrolled contests",
    });
  }
};

const getEnrollment = async (req, res) => {
  try {
    const enrollment = await Enrollment.findOne({
      userId: req.user._id,
      contestId: req.params.id,
      status: "paid",
    });

    return res.json({
      enrolled: Boolean(enrollment),
      enrollment: enrollment || null,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to check enrollment",
    });
  }
};

module.exports = {
  getAllContests,
  getContestById,
  getMyContests,
  getEnrollment,
};