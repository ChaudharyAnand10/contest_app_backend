
const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");

const {
  createAnnouncement,
  getAdminAnnouncements,
  getAnnouncements,
  getAllStudentAnnouncements,
  updateAnnouncement,
  deleteAnnouncement,
} = require("../controllers/announcementController");

// Admin: fetch announcements from all contests
router.get(
  "/admin",
  authMiddleware,
  adminMiddleware,
  getAdminAnnouncements
);

// Student: fetch published announcements for one enrolled contest
router.get(
  "/:contestId",
  authMiddleware,
  getAnnouncements
);

// Admin: create announcement
router.post(
  "/",
  authMiddleware,
  adminMiddleware,
  createAnnouncement
);

// Admin: update announcement
router.put(
  "/:id",
  authMiddleware,
  adminMiddleware,
  updateAnnouncement
);

// Admin: delete announcement
router.delete(
  "/:id",
  authMiddleware,
  adminMiddleware,
  deleteAnnouncement
);

// Student: all announcements from paid contests
router.get(
  "/",
  authMiddleware,
  getAllStudentAnnouncements
);
module.exports = router;
