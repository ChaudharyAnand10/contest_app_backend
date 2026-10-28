
const express = require("express");

const {
  startAttempt,
  trackBackgroundEvent,
  submitAttempt,
  getContestSchedule,
} = require("../controllers/attemptController");

const {
  getAttemptResult,
} = require("../controllers/resultController");

const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.post(
  "/start/:contestId",
  authMiddleware,
  startAttempt
);

router.post(
  "/:attemptId/background",
  authMiddleware,
  trackBackgroundEvent
);

router.get(
  "/:attemptId/result",
  authMiddleware,
  getAttemptResult
);


router.get(
  "/contest/:contestId/schedule",
  authMiddleware,
  getContestSchedule
);

router.post(
  "/submit",
  authMiddleware,
  submitAttempt
);

module.exports = router;
