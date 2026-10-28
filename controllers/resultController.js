
const mongoose = require("mongoose");
const Attempt = require("../models/Attempt");
const Question = require("../models/Question");
const Contest = require("../models/Contest");
const User = require("../models/User");

// GET /api/attempts/:attemptId/result
const getAttemptResult = async (req, res) => {
  try {
    const { attemptId } = req.params;

    if (!mongoose.isValidObjectId(attemptId)) {
      return res.status(400).json({
        message: "Invalid attempt ID",
      });
    }

    const attempt = await Attempt.findById(attemptId).lean();

    if (!attempt) {
      return res.status(404).json({
        message: "Attempt not found",
      });
    }

    // User sirf apna result dekh sakta hai.
    const loggedInUserId = req.user._id || req.user.id;

    if (attempt.userId.toString() !== loggedInUserId.toString()) {
      return res.status(403).json({
        message: "You cannot access another user's result",
      });
    }

    // Result tabhi available hoga jab attempt finalize ho chuka ho.
    if (!["submitted", "expired"].includes(attempt.status)) {
      return res.status(409).json({
        message: "Result is not available until the attempt is completed",
      });
    }

    const questions = await Question.find({
      _id: { $in: attempt.questionIds },
    })
      .select("question options correctAnswer marks")
      .lean();

    // Attempt ke original question order ko preserve karo.
    const questionMap = new Map(
      questions.map((q) => [q._id.toString(), q])
    );

    const answerMap = new Map(
      (attempt.answers || []).map((item) => [
        item.questionId.toString(),
        item.answer,
      ])
    );

    let correctCount = 0;
    let incorrectCount = 0;
    let unansweredCount = 0;

    const answerReview = (attempt.questionIds || []).map((id) => {
      const question = questionMap.get(id.toString());

      if (!question) return null;

      const selectedAnswer = answerMap.get(id.toString());
      const hasAnswer =
        selectedAnswer !== undefined &&
        selectedAnswer !== null &&
        String(selectedAnswer).trim() !== "";

      const isCorrect =
        hasAnswer &&
        String(selectedAnswer).trim() ===
          String(question.correctAnswer).trim();

      if (!hasAnswer) {
        unansweredCount++;
      } else if (isCorrect) {
        correctCount++;
      } else {
        incorrectCount++;
      }

      return {
        questionId: question._id,
        question: question.question,
        options: question.options,
        selectedAnswer: hasAnswer ? selectedAnswer : null,
        correctAnswer: question.correctAnswer,
        isCorrect: hasAnswer ? isCorrect : false,
        marks: question.marks,
      };
    }).filter(Boolean);

    const startTime = attempt.startedAt
      ? new Date(attempt.startedAt).getTime()
      : null;

    // Expired attempt mein submittedAt absent ho toh expiresAt use karo.
    const endTime = attempt.submittedAt
      ? new Date(attempt.submittedAt).getTime()
      : attempt.expiresAt
        ? new Date(attempt.expiresAt).getTime()
        : null;

    const timeTakenSeconds =
      startTime !== null && endTime !== null
        ? Math.max(0, Math.floor((endTime - startTime) / 1000))
        : null;

    const totalSeconds = timeTakenSeconds || 0;

    const contest = await Contest.findById(attempt.contestId)
      .select("title")
      .lean();

    return res.status(200).json({
      message: "Attempt result fetched successfully",
      result: {
        attemptId: attempt._id,
        contestId: attempt.contestId,
        contestTitle: contest?.title || "Contest",
        dayNumber: attempt.dayNumber,
        status: attempt.status,
        totalQuestions: answerReview.length,
        correctAnswers: correctCount,
        incorrectAnswers: incorrectCount,
        unanswered: unansweredCount,
        score: attempt.score || 0,
        totalMarks: attempt.totalMarks || 0,
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt || null,
        expiresAt: attempt.expiresAt,
        timeTakenSeconds,
        timeTaken: `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`,
        answers: answerReview,
      },
    });
  } catch (error) {
    console.error("Get attempt result error:", error);

    return res.status(500).json({
      message: "Failed to fetch attempt result",
    });
  }
};


// GET /api/contests/:contestId/leaderboard
// Optional query: ?dayNumber=1
const getContestLeaderboard = async (req, res) => {
  try {
    const { contestId } = req.params;
    const { dayNumber } = req.query;

    if (!mongoose.isValidObjectId(contestId)) {
      return res.status(400).json({
        message: "Invalid contest ID",
      });
    }

    if (
      dayNumber !== undefined &&
      (!Number.isInteger(Number(dayNumber)) || Number(dayNumber) < 1)
    ) {
      return res.status(400).json({
        message: "dayNumber must be a positive integer",
      });
    }

    const contest = await Contest.findById(contestId)
      .select("title totalDays")
      .lean();

    if (!contest) {
      return res.status(404).json({
        message: "Contest not found",
      });
    }

    if (
      dayNumber !== undefined &&
      Number(dayNumber) > contest.totalDays
    ) {
      return res.status(400).json({
        message: "dayNumber exceeds this contest's total days",
      });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 20)
    );

    const match = {
      contestId: new mongoose.Types.ObjectId(contestId),
      status: { $in: ["submitted", "expired"] },
    };

    if (dayNumber !== undefined) {
      match.dayNumber = Number(dayNumber);
    }

    const grouped = await Attempt.aggregate([
      { $match: match },

      {
        $addFields: {
          elapsedSeconds: {
            $cond: [
              {
                $and: [
                  { $ne: ["$startedAt", null] },
                  {
                    $ne: [
                      { $ifNull: ["$submittedAt", "$expiresAt"] },
                      null,
                    ],
                  },
                ],
              },
              {
                $max: [
                  0,
                  {
                    $divide: [
                      {
                        $subtract: [
                          { $ifNull: ["$submittedAt", "$expiresAt"] },
                          "$startedAt",
                        ],
                      },
                      1000,
                    ],
                  },
                ],
              },
              0,
            ],
          },
        },
      },

      {
        $group: {
          _id: "$userId",
          score: { $sum: { $ifNull: ["$score", 0] } },
          totalMarks: { $sum: { $ifNull: ["$totalMarks", 0] } },
          completedDays: { $sum: 1 },
          timeTakenSeconds: { $sum: "$elapsedSeconds" },
        },
      },
    ]);

    const userIds = grouped.map((item) => item._id);

    const users = await User.find({ _id: { $in: userIds } })
      .select("name username")
      .lean();

    const userMap = new Map(
      users.map((user) => [user._id.toString(), user])
    );

    const rankings = grouped
      .map((item) => {
        const user = userMap.get(item._id.toString());

        return {
          userId: item._id,
          name: user?.name || user?.username || "Participant",
          score: item.score,
          totalMarks: item.totalMarks,
          completedDays: item.completedDays,
          timeTakenSeconds: Math.floor(item.timeTakenSeconds || 0),
        };
      })
      // Highest score first; tie-breaker: lowest time.
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.timeTakenSeconds - b.timeTakenSeconds ||
          a.name.localeCompare(b.name)
      );

    const totalParticipants = rankings.length;
    const startIndex = (page - 1) * limit;

    const leaderboard = rankings
      .slice(startIndex, startIndex + limit)
      .map((item, index) => ({
        rank: startIndex + index + 1,
        ...item,
        timeTaken: `${Math.floor(item.timeTakenSeconds / 60)}m ${
          item.timeTakenSeconds % 60
        }s`,
      }));

    return res.status(200).json({
      message: "Leaderboard fetched successfully",
      contest: {
        id: contest._id,
        title: contest.title,
      },
      scope:
        dayNumber !== undefined
          ? `day-${Number(dayNumber)}`
          : "overall",
      dayNumber:
        dayNumber !== undefined ? Number(dayNumber) : null,
      totalParticipants,
      page,
      limit,
      totalPages: Math.ceil(totalParticipants / limit),
      leaderboard,
    });
  } catch (error) {
    console.error("Get contest leaderboard error:", error);

    return res.status(500).json({
      message: "Failed to fetch contest leaderboard",
    });
  }
};

module.exports = {
  getAttemptResult,
  getContestLeaderboard,
};
