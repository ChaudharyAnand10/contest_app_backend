
const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");

const {
  createContest,
  updateContest,
  deleteContest,
  createQuestion,
  getQuestions,
  updateQuestion,
  deleteQuestion,
  getContestEnrollments,
  removeContestEnrollment,
  getAdminUserProfile,
} = require("../controllers/adminController");

// Protect all admin routes
router.use(authMiddleware, adminMiddleware);

// Contest management
router.post("/contests", createContest);
router.put("/contests/:id", updateContest);
router.delete("/contests/:id", deleteContest);

// Enrollment management
router.get(
  "/contests/:contestId/enrollments",
  getContestEnrollments
);

router.delete(
  "/contests/:contestId/enrollments/:userId",
  removeContestEnrollment
);

// User profile
router.get("/users/:userId", getAdminUserProfile);

// Question management
router.get("/questions", getQuestions);
router.post("/questions", createQuestion);
router.put("/questions/:id", updateQuestion);
router.delete("/questions/:id", deleteQuestion);

module.exports = router;
