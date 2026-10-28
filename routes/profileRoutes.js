const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");

const {
  getProfile,
  getParticipationHistory,
} = require("../controllers/profileController");

router.get("/", authMiddleware, getProfile);
router.get("/history", authMiddleware, getParticipationHistory);

module.exports = router;