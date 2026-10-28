

const mongoose = require("mongoose");
const Contest = require("../models/Contest");
const Question = require("../models/Question");
const Enrollment = require("../models/Enrollment");
const Attempt = require("../models/Attempt");

const {
  getContestDay,
  getDailyWindow,
} = require("../utils/contestTime");

// Keep only the 20 most recent background events in MongoDB.
const MAX_BACKGROUND_EVENTS = 20;

// --------------------------------------------------
// START ATTEMPT
// --------------------------------------------------
const startAttempt = async (req, res) => {
  try {
    const { contestId } = req.params;

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

    // User must have a paid enrollment.
    const enrollment = await Enrollment.findOne({
      userId: req.user._id,
      contestId,
      status: "paid",
    });

    if (!enrollment) {
      return res.status(403).json({
        message: "You are not enrolled in this contest",
      });
    }

    const dayNumber = getContestDay(contest.startDate);

    if (dayNumber < 1 || dayNumber > contest.totalDays) {
      return res.status(400).json({
        message: "Contest is not active today",
      });
    }

    const { start, end, now } = getDailyWindow(contest);

    if (now < start || now >= end) {
      return res.status(400).json({
        message:
          "Today's contest is available from 8:00 PM to 8:30 PM",
        windowStart: start.toISO(),
        windowEnd: end.toISO(),
      });
    }

    let attempt = await Attempt.findOne({
      userId: req.user._id,
      contestId,
      dayNumber,
    });

    // Already submitted.
    if (attempt && attempt.status === "submitted") {
      return res.json({
        status: "completed",
        message: "Today's test is already submitted",
        score: attempt.score,
        totalMarks: attempt.totalMarks,
      });
    }

    // Expire an unfinished attempt if its deadline has passed.
    if (
      attempt &&
      attempt.status === "started" &&
      attempt.expiresAt &&
      now.toJSDate() >= attempt.expiresAt
    ) {
      attempt.status = "expired";
      await attempt.save();

      return res.json({
        status: "expired",
        message: "Today's test has expired",
      });
    }

    // Resume the existing active attempt.
    if (attempt && attempt.status === "started") {
      const questions = await Question.find({
        _id: { $in: attempt.questionIds },
      }).select("-correctAnswer");

      return res.json({
        status: "started",
        attemptId: attempt._id,
        dayNumber,
        startedAt: attempt.startedAt,
        expiresAt: attempt.expiresAt,
        appBackgroundCount: attempt.appBackgroundCount || 0,
        questions,
      });
    }

    // Get today's configured question count.
    const questions = await Question.find({
      contestId,
      dayNumber,
    })
      .select("-correctAnswer")
      .limit(contest.dailyQuestionCount);


    if (questions.length !== contest.dailyQuestionCount) {
      
      return res.status(400).json({
        message: "Today's questions are not ready",
      });
    }

    const startedAt = now.toJSDate();
    const expiresAt = end.toJSDate();

    attempt = await Attempt.create({
      userId: req.user._id,
      contestId,
      dayNumber,
      questionIds: questions.map((question) => question._id),
      startedAt,
      expiresAt,
      status: "started",
      totalMarks: questions.reduce(
        (sum, question) => sum + question.marks,
        0
      ),
      appBackgroundCount: 0,
      appBackgroundEvents: [],
      lastAppBackgroundAt: null,
    });

    return res.status(201).json({
      status: "started",
      attemptId: attempt._id,
      dayNumber,
      startedAt,
      expiresAt,
      appBackgroundCount: 0,
      questions,
    });
  } catch (error) {
    console.error("Start attempt error:", error);

    return res.status(500).json({
      message: "Unable to start test",
    });
    
  }
};

// --------------------------------------------------
// TRACK APP BACKGROUND EVENT
// POST /api/attempts/:attemptId/background
// --------------------------------------------------
const trackBackgroundEvent = async (req, res) => {
  try {
    const { attemptId } = req.params;
    const { eventId } = req.body;

    if (!mongoose.isValidObjectId(attemptId)) {
      return res.status(400).json({
        message: "Invalid attempt ID",
      });
    }

    if (
      typeof eventId !== "string" ||
      eventId.trim().length === 0 ||
      eventId.trim().length > 128
    ) {
      return res.status(400).json({
        message: "A valid eventId is required",
      });
    }

    const cleanEventId = eventId.trim();
    const now = new Date();

    // Atomic update:
    // 1. Attempt belongs to the authenticated user.
    // 2. Attempt is still active and not expired.
    // 3. This eventId has not already been recorded.
    const updatedAttempt = await Attempt.findOneAndUpdate(
      {
        _id: attemptId,
        userId: req.user._id,
        status: "started",
        expiresAt: { $gt: now },
        "appBackgroundEvents.eventId": {
          $ne: cleanEventId,
        },
      },
      {
        $inc: {
          appBackgroundCount: 1,
        },
        $push: {
          appBackgroundEvents: {
            $each: [
              {
                eventId: cleanEventId,
                backgroundAt: now,
              },
            ],
            $slice: -MAX_BACKGROUND_EVENTS,
          },
        },
        $set: {
          lastAppBackgroundAt: now,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    );

    if (updatedAttempt) {
      return res.json({
        message: "Background event recorded",
        duplicate: false,
        appBackgroundCount: updatedAttempt.appBackgroundCount,
        lastAppBackgroundAt: updatedAttempt.lastAppBackgroundAt,
      });
    }

    // Determine why the atomic update did not match.
    const attempt = await Attempt.findOne({
      _id: attemptId,
      userId: req.user._id,
    });

    if (!attempt) {
      return res.status(404).json({
        message: "Attempt not found",
      });
    }

    // A retry with the same eventId must not increase the count.
    const alreadyRecorded = attempt.appBackgroundEvents.some(
      (event) => event.eventId === cleanEventId
    );

    if (alreadyRecorded) {
      return res.json({
        message: "Background event already recorded",
        duplicate: true,
        appBackgroundCount: attempt.appBackgroundCount,
      });
    }

    if (attempt.status !== "started") {
      return res.status(409).json({
        message: "Attempt is no longer active",
        status: attempt.status,
      });
    }

    if (!attempt.expiresAt || attempt.expiresAt <= now) {
      attempt.status = "expired";
      await attempt.save();

      return res.status(409).json({
        message: "Attempt has expired",
        status: "expired",
      });
    }

    return res.status(409).json({
      message: "Background event could not be recorded",
    });
  } catch (error) {
    console.error("Track background event error:", error);

    return res.status(500).json({
      message: "Unable to record background event",
    });
  }
};

// --------------------------------------------------
// SUBMIT ATTEMPT
// --------------------------------------------------
const submitAttempt = async (req, res) => {
  try {
    const { attemptId, answers } = req.body;

    if (
      !attemptId ||
      !mongoose.isValidObjectId(attemptId) ||
      !Array.isArray(answers)
    ) {
      return res.status(400).json({
        message: "Invalid submission",
      });
    }

    const attempt = await Attempt.findOne({
      _id: attemptId,
      userId: req.user._id,
    });

    if (!attempt) {
      return res.status(404).json({
        message: "Attempt not found",
      });
    }

    if (attempt.status !== "started") {
      return res.status(400).json({
        message: "Attempt is already completed",
      });
    }

    const now = new Date();

    if (!attempt.expiresAt || now >= attempt.expiresAt) {
      attempt.status = "expired";
      await attempt.save();

      return res.status(400).json({
        message: "Time is over",
      });
    }

    const questions = await Question.find({
      _id: { $in: attempt.questionIds },
    });

    const questionMap = new Map(
      questions.map((question) => [
        question._id.toString(),
        question,
      ])
    );

    const submittedQuestionIds = new Set();
    const savedAnswers = [];
    let score = 0;












    for (const answerItem of answers) {
      if (
        !answerItem ||
        !mongoose.isValidObjectId(answerItem.questionId)
      ) {
        continue;
      }

      const questionId = answerItem.questionId.toString();
      const question = questionMap.get(questionId);

      // Ignore questions outside this attempt and duplicate answers.
      if (
        !question ||
        submittedQuestionIds.has(questionId) ||
        typeof answerItem.answer !== "string"
      ) {
        continue;
      }

      submittedQuestionIds.add(questionId);

      const userAnswer = answerItem.answer;


















      savedAnswers.push({
        questionId: question._id,
        answer: userAnswer,
      });





      const correctIndex = Number(question.correctAnswer);

const isValidCorrectIndex =
  Number.isInteger(correctIndex) &&
  correctIndex >= 0 &&
  correctIndex < question.options.length;

if (!isValidCorrectIndex) {
  console.error("Invalid correctAnswer index:", {
    questionId,
    correctAnswer: question.correctAnswer,
  });

  continue;
}

const correctOption = question.options[correctIndex];

if (userAnswer === correctOption) {
  score += question.marks;
}













      
    }

    attempt.answers = savedAnswers;
    attempt.score = score;
    attempt.submittedAt = now;
    attempt.status = "submitted";

    await attempt.save();

    return res.json({
      message: "Test submitted successfully",
      score: attempt.score,
      totalMarks: attempt.totalMarks,
      submittedAt: attempt.submittedAt,
      appBackgroundCount: attempt.appBackgroundCount || 0,
    });
  } catch (error) {
    console.error("Submit attempt error:", error);

    return res.status(500).json({
      message: "Submission failed",
    });
  }
};



const getContestSchedule = async (req, res) => {
  try {
    const { contestId } = req.params;
    const userId = req.user?._id;

    if (!mongoose.isValidObjectId(contestId)) {
      return res.status(400).json({
        message: "Invalid contest ID",
      });
    }

    const contest = await Contest.findById(contestId).lean();

    if (!contest) {
      return res.status(404).json({
        message: "Contest not found",
      });
    }

    const enrollment = await Enrollment.findOne({
      userId,
      contestId,
      status: "paid",
    }).lean();

    if (!enrollment) {
      return res.status(403).json({
        message: "You are not enrolled in this contest",
      });
    }

    const [attempts, window] = await Promise.all([
      Attempt.find({ userId, contestId })
        .select(
          "dayNumber status score totalMarks startedAt expiresAt submittedAt"
        )
        .lean(),

      Promise.resolve(getDailyWindow(contest)),
    ]);

    const now = window.now.toJSDate();
    const currentDay = getContestDay(contest.startDate);

    // Expire attempts whose deadline has passed.
    await Attempt.updateMany(
      {
        userId,
        contestId,
        status: "started",
        expiresAt: { $lte: now },
      },
      {
        $set: { status: "expired" },
      }
    );

    const refreshedAttempts = await Attempt.find({
      userId,
      contestId,
    })
      .select(
        "dayNumber status score totalMarks startedAt expiresAt submittedAt"
      )
      .lean();

    const attemptByDay = new Map(
      refreshedAttempts.map((attempt) => [
        attempt.dayNumber,
        attempt,
      ])
    );

    const days = [];

    for (let dayNumber = 1; dayNumber <= contest.totalDays; dayNumber++) {
      const attempt = attemptByDay.get(dayNumber);
      let status;

      if (attempt?.status === "submitted") {
        status = "completed";
      } else if (attempt?.status === "expired") {
        status = "expired";
      } else if (attempt?.status === "started") {
        status = "in_progress";
      } else if (dayNumber > currentDay) {
        status = "upcoming";
      } else if (dayNumber < currentDay) {
        status = "missed";
      } else if (currentDay < 1) {
        status = "upcoming";
      } else if (now < window.start.toJSDate()) {
        status = "not_started";
      } else if (now < window.end.toJSDate()) {
        status = "available";
      } else {
        status = "missed";
      }

      days.push({
        dayNumber,
        status,
        attemptId: attempt?._id || null,
        score: attempt?.score ?? null,
        totalMarks: attempt?.totalMarks ?? null,
        startedAt: attempt?.startedAt || null,
        expiresAt: attempt?.expiresAt || null,
        submittedAt: attempt?.submittedAt || null,
      });
    }

    return res.json({
      contestId,
      contestTitle: contest.title,
      totalDays: contest.totalDays,
      currentDay,
      dailyStartHour: contest.dailyStartHour,
      dailyStartMinute: contest.dailyStartMinute,
      windowStart: window.start.toISO(),
      windowEnd: window.end.toISO(),
      days,
    });
  } catch (error) {
    console.error("Get contest schedule error:", error);

    return res.status(500).json({
      message: "Unable to load contest schedule",
    });
  }
};


module.exports = {
  startAttempt,
  trackBackgroundEvent,
  submitAttempt,
  getContestSchedule,
};
