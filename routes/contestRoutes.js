const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const {
  getContestLeaderboard,
} = require("../controllers/resultController");

const {
  getAllContests,
  getContestById,
  getMyContests,
  getEnrollment,
} = require("../controllers/contestController");

router.get("/", getAllContests);
router.get("/my", authMiddleware, getMyContests);
router.get("/:id/enrollment", authMiddleware, getEnrollment);
router.get("/:id", getContestById);
router.get(
  "/:contestId/leaderboard",
  authMiddleware,
  getContestLeaderboard
);

module.exports = router;