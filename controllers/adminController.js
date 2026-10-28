const mongoose = require("mongoose");
const Contest = require("../models/Contest");
const Question = require("../models/Question");
const Enrollment = require("../models/Enrollment");
const User = require("../models/User");

const allowedContestFields = [
  "title",
  "description",
  "imageUrl",
  "price",
  "startDate",
  "totalDays",
  "dailyQuestionCount",
  "durationMinutes",
  "dailyStartHour",
  "dailyStartMinute",
  "maxParticipants",
];

// --------------------------------------------------
// GET QUESTIONS
// --------------------------------------------------
const getQuestions = async (req, res) => {
  try {
    const { contestId } = req.query;
    const filter = {};

    if (contestId) {
      if (!mongoose.isValidObjectId(contestId)) {
        return res.status(400).json({
          message: "Invalid contest ID",
        });
      }

      filter.contestId = contestId;
    }

    const questions = await Question.find(filter)
      .populate("contestId", "title")
      .sort({
        contestId: 1,
        dayNumber: 1,
        createdAt: -1,
      })
      .lean();

    return res.status(200).json({
      count: questions.length,
      questions,
    });
  } catch (error) {
    console.error("Get questions error:", error);

    return res.status(500).json({
      message: "Failed to fetch questions",
    });
  }
};

// --------------------------------------------------
// CREATE CONTEST
// POST /api/admin/contests
// --------------------------------------------------
const createContest = async (req, res) => {
  try {
    const data = {};

    for (const field of allowedContestFields) {
      if (req.body[field] !== undefined) {
        data[field] = req.body[field];
      }
    }

    if (!data.title || data.price === undefined) {
      return res.status(400).json({
        message: "title and price are required",
      });
    }

    const contest = await Contest.create(data);

    return res.status(201).json({
      message: "Contest created successfully",
      contest,
    });
  } catch (error) {
    console.error("Create contest error:", error);

    return res.status(500).json({
      message: "Failed to create contest",
      error: error.message,
    });
  }
};

// --------------------------------------------------
// UPDATE CONTEST
// --------------------------------------------------
const updateContest = async (req, res) => {
  try {
    const updates = {};

    for (const field of allowedContestFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const contest = await Contest.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!contest) {
      return res.status(404).json({
        message: "Contest not found",
      });
    }

    return res.json({
      message: "Contest updated successfully",
      contest,
    });
  } catch (error) {
    console.error("Update contest error:", error);

    return res.status(400).json({
      message: "Failed to update contest",
      error: error.message,
    });
  }
};

// --------------------------------------------------
// DELETE CONTEST
// --------------------------------------------------
const deleteContest = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid contest ID",
      });
    }

    const contest = await Contest.findById(req.params.id);

    if (!contest) {
      return res.status(404).json({
        message: "Contest not found",
      });
    }

    const [enrollmentCount, questionCount] =
      await Promise.all([
        Enrollment.countDocuments({
          contestId: contest._id,
        }),
        Question.countDocuments({
          contestId: contest._id,
        }),
      ]);

    if (enrollmentCount > 0 || questionCount > 0) {
      return res.status(409).json({
        message:
          "Contest has enrollments or questions. Archive it instead of deleting it.",
      });
    }

    await contest.deleteOne();

    return res.json({
      message: "Contest deleted successfully",
    });
  } catch (error) {
    console.error("Delete contest error:", error);

    return res.status(500).json({
      message: "Failed to delete contest",
      error: error.message,
    });
  }
};

// --------------------------------------------------
// GET STUDENTS ENROLLED IN A CONTEST
// GET /api/admin/contests/:contestId/enrollments
// --------------------------------------------------
const getContestEnrollments = async (req, res) => {
  try {
    const { contestId } = req.params;

    if (!mongoose.isValidObjectId(contestId)) {
      return res.status(400).json({
        message: "Invalid contest ID",
      });
    }

    const contest = await Contest.findById(contestId).select(
      "title description imageUrl price startDate totalDays"
    );

    if (!contest) {
      return res.status(404).json({
        message: "Contest not found",
      });
    }

    // Only paid enrollments are treated as active.
    const enrollments = await Enrollment.find({
      contestId: contest._id,
      status: "paid",
    })
      .populate({
        path: "userId",
        select: "name username email phone_number createdAt",
      })
      .sort({ createdAt: -1 })
      .lean();

    const students = enrollments
      .filter((enrollment) => enrollment.userId)
      .map((enrollment) => ({
        _id: enrollment.userId._id,
        name: enrollment.userId.name,
        username: enrollment.userId.username,
        email: enrollment.userId.email,
        phone_number: enrollment.userId.phone_number,
        enrollmentId: enrollment._id,
        enrolledAt: enrollment.createdAt,
        status: enrollment.status,
      }));

    return res.json({
      contest,
      count: students.length,
      enrollments: students,
    });
  } catch (error) {
    console.error("Get contest enrollments error:", error);

    return res.status(500).json({
      message: "Failed to fetch contest enrollments",
    });
  }
};

// --------------------------------------------------
// REMOVE A USER FROM ONE CONTEST
// DELETE /api/admin/contests/:contestId/enrollments/:userId
// --------------------------------------------------
const removeContestEnrollment = async (req, res) => {
  try {
    const { contestId, userId } = req.params;

    if (
      !mongoose.isValidObjectId(contestId) ||
      !mongoose.isValidObjectId(userId)
    ) {
      return res.status(400).json({
        message: "Invalid contest ID or user ID",
      });
    }

    const contest = await Contest.findById(contestId).select("_id");

    if (!contest) {
      return res.status(404).json({
        message: "Contest not found",
      });
    }

    const user = await User.findById(userId).select("_id");

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const enrollment = await Enrollment.findOneAndDelete({
      userId: user._id,
      contestId: contest._id,
    });

    if (!enrollment) {
      return res.status(404).json({
        message: "Enrollment not found for this contest",
      });
    }

    // Decrement the participant counter only for paid enrollment.
    if (enrollment.status === "paid") {
      await Contest.updateOne(
        {
          _id: contest._id,
          reservedParticipants: { $gt: 0 },
        },
        {
          $inc: { reservedParticipants: -1 },
        }
      );
    }

    return res.json({
      message: "Student removed from this contest successfully",
      contestId: contest._id,
      userId: user._id,
    });
  } catch (error) {
    console.error("Remove contest enrollment error:", error);

    return res.status(500).json({
      message: "Failed to remove student from contest",
    });
  }
};

// --------------------------------------------------
// GET USER PROFILE FOR ADMIN
// GET /api/admin/users/:userId
// --------------------------------------------------
const getAdminUserProfile = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({
        message: "Invalid user ID",
      });
    }

    // Never send the password or session ID to the frontend.
    const user = await User.findById(userId)
      .select("name username email phone_number createdAt")
      .lean();

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const enrollments = await Enrollment.find({
      userId: user._id,
      status: "paid",
    })
      .populate({
        path: "contestId",
        select:
          "title description imageUrl price startDate totalDays dailyQuestionCount",
      })
      .sort({ createdAt: -1 })
      .lean();

    const enrolledContests = enrollments
      .filter((enrollment) => enrollment.contestId)
      .map((enrollment) => ({
        ...enrollment.contestId,
        enrollmentId: enrollment._id,
        enrolledAt: enrollment.createdAt,
        enrollmentStatus: enrollment.status,
      }));

    return res.json({
      user: {
        ...user,
        enrolledContests,
      },
    });
  } catch (error) {
    console.error("Get admin user profile error:", error);

    return res.status(500).json({
      message: "Failed to fetch user profile",
    });
  }
};

// --------------------------------------------------
// CREATE QUESTION
// --------------------------------------------------
const createQuestion = async (req, res) => {
  try {
    const {
      contestId,
      dayNumber,
      question,
      options,
      correctAnswer,
      marks,
    } = req.body;

    if (
      !contestId ||
      dayNumber === undefined ||
      !question ||
      !Array.isArray(options) ||
      options.length < 2 ||
      correctAnswer === undefined
    ) {
      return res.status(400).json({
        message:
          "contestId, dayNumber, question, options and correctAnswer are required",
      });
    }

    if (!mongoose.isValidObjectId(contestId)) {
      return res.status(400).json({
        message: "Invalid contest ID",
      });
    }

    const contest = await Contest.findById(contestId);

    if (!contest) {
      return res.status(404).json({
        message: "Contest not found",
      });
    }

    if (
      !Number.isInteger(Number(dayNumber)) ||
      Number(dayNumber) < 1 ||
      Number(dayNumber) > contest.totalDays
    ) {
      return res.status(400).json({
        message: "Invalid dayNumber for this contest",
      });
    }

    const cleanedOptions = options.map((option) =>
      String(option).trim()
    );

    if (cleanedOptions.some((option) => !option)) {
      return res.status(400).json({
        message: "Options cannot be empty",
      });
    }

    const answer = String(correctAnswer).trim();

    const isValidIndex =
      /^\d+$/.test(answer) &&
      Number(answer) >= 0 &&
      Number(answer) < cleanedOptions.length;

    const isValidOption = cleanedOptions.some(
      (option) => option === answer
    );

    if (!isValidIndex && !isValidOption) {
      return res.status(400).json({
        message:
          "correctAnswer must be a valid option index or option text",
      });
    }

    const newQuestion = await Question.create({
      contestId,
      dayNumber: Number(dayNumber),
      question: question.trim(),
      options: cleanedOptions,
      correctAnswer: answer,
      marks: marks ?? 1,
    });

    return res.status(201).json({
      message: "Question created successfully",
      question: newQuestion,
    });
  } catch (error) {
    console.error("Create question error:", error);

    return res.status(400).json({
      message: "Failed to create question",
      error: error.message,
    });
  }
};

// --------------------------------------------------
// UPDATE QUESTION
// --------------------------------------------------
const updateQuestion = async (req, res) => {
  try {
    const allowedFields = [
      "dayNumber",
      "question",
      "options",
      "correctAnswer",
      "marks",
    ];

    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const updated = await Question.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({
        message: "Question not found",
      });
    }

    return res.json({
      message: "Question updated successfully",
      question: updated,
    });
  } catch (error) {
    console.error("Update question error:", error);

    return res.status(400).json({
      message: "Failed to update question",
      error: error.message,
    });
  }
};

// --------------------------------------------------
// DELETE QUESTION
// --------------------------------------------------
const deleteQuestion = async (req, res) => {
  try {
    const deleted = await Question.findByIdAndDelete(
      req.params.id
    );

    if (!deleted) {
      return res.status(404).json({
        message: "Question not found",
      });
    }

    return res.json({
      message: "Question deleted successfully",
    });
  } catch (error) {
    console.error("Delete question error:", error);

    return res.status(500).json({
      message: "Failed to delete question",
    });
  }
};

module.exports = {
  createContest,
  updateContest,
  deleteContest,
  getQuestions,
  getContestEnrollments,
  removeContestEnrollment,
  getAdminUserProfile,
  createQuestion,
  updateQuestion,
  deleteQuestion,
};