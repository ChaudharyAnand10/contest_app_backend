
const mongoose = require("mongoose");

const Announcement = require("../models/Announcement");
const Contest = require("../models/Contest");
const Enrollment = require("../models/Enrollment");

// --------------------------------------------------
// CREATE ANNOUNCEMENT
// POST /api/announcements
// Admin only
// --------------------------------------------------
const createAnnouncement = async (req, res) => {
  try {
    const { contestId, title, content, type, published } = req.body;

    if (
      !contestId ||
      !title?.trim() ||
      !content?.trim()
    ) {
      return res.status(400).json({
        message: "contestId, title and content are required",
      });
    }

    if (!mongoose.isValidObjectId(contestId)) {
      return res.status(400).json({
        message: "Invalid contest ID",
      });
    }

    const allowedTypes = ["notice", "homework", "instruction"];

    if (type && !allowedTypes.includes(type)) {
      return res.status(400).json({
        message: "Invalid announcement type",
      });
    }

    const contest = await Contest.findById(contestId).select("_id");

    if (!contest) {
      return res.status(404).json({
        message: "Contest not found",
      });
    }

    const announcement = await Announcement.create({
      contestId: contest._id,
      title: title.trim(),
      content: content.trim(),
      type: type || "notice",
      published: published ?? true,
      createdBy: req.user._id || req.user.id,
    });

    const populatedAnnouncement =
      await Announcement.findById(announcement._id)
        .populate("contestId", "title")
        .lean();

    return res.status(201).json({
      message: "Announcement created successfully",
      announcement: populatedAnnouncement,
    });
  } catch (error) {
    console.error("Create announcement error:", error);

    return res.status(500).json({
      message: "Failed to create announcement",
      error: error.message,
    });
  }
};

// --------------------------------------------------
// GET ALL ANNOUNCEMENTS FOR ADMIN
// GET /api/announcements/admin
// Admin only
// --------------------------------------------------
const getAdminAnnouncements = async (req, res) => {
  try {
    const announcements = await Announcement.find({})
      .populate("contestId", "title")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      count: announcements.length,
      announcements,
    });
  } catch (error) {
    console.error("Get admin announcements error:", error);

    return res.status(500).json({
      message: "Failed to fetch admin announcements",
      error: error.message,
    });
  }
};

// --------------------------------------------------
// GET ANNOUNCEMENTS FOR A STUDENT'S CONTEST
// GET /api/announcements/:contestId
// Authenticated, paid enrollment required
// --------------------------------------------------
const getAnnouncements = async (req, res) => {
  try {
    const { contestId } = req.params;

    if (!mongoose.isValidObjectId(contestId)) {
      return res.status(400).json({
        message: "Invalid contest ID",
      });
    }

    const userId = req.user._id || req.user.id;

    const enrollment = await Enrollment.findOne({
      userId,
      contestId,
      status: "paid",
    }).select("_id");

    if (!enrollment) {
      return res.status(403).json({
        message: "Paid contest enrollment required",
      });
    }

    const announcements = await Announcement.find({
      contestId,
      published: true,
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      count: announcements.length,
      announcements,
    });
  } catch (error) {
    console.error("Get announcements error:", error);

    return res.status(500).json({
      message: "Failed to fetch announcements",
      error: error.message,
    });
  }
};

// --------------------------------------------------
// UPDATE ANNOUNCEMENT
// PUT /api/announcements/:id
// Admin only
// --------------------------------------------------
const updateAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid announcement ID",
      });
    }

    const allowedFields = [
      "contestId",
      "title",
      "content",
      "type",
      "published",
    ];

    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (updates.contestId !== undefined) {
      if (!mongoose.isValidObjectId(updates.contestId)) {
        return res.status(400).json({
          message: "Invalid contest ID",
        });
      }

      const contest = await Contest.findById(
        updates.contestId
      ).select("_id");

      if (!contest) {
        return res.status(404).json({
          message: "Contest not found",
        });
      }

      updates.contestId = contest._id;
    }

    if (
      updates.title !== undefined &&
      (typeof updates.title !== "string" || !updates.title.trim())
    ) {
      return res.status(400).json({
        message: "Title cannot be empty",
      });
    }

    if (
      updates.content !== undefined &&
      (typeof updates.content !== "string" || !updates.content.trim())
    ) {
      return res.status(400).json({
        message: "Content cannot be empty",
      });
    }

    if (updates.title !== undefined) {
      updates.title = updates.title.trim();
    }

    if (updates.content !== undefined) {
      updates.content = updates.content.trim();
    }

    if (
      updates.type !== undefined &&
      !["notice", "homework", "instruction"].includes(updates.type)
    ) {
      return res.status(400).json({
        message: "Invalid announcement type",
      });
    }

    const announcement = await Announcement.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    )
      .populate("contestId", "title")
      .lean();

    if (!announcement) {
      return res.status(404).json({
        message: "Announcement not found",
      });
    }

    return res.status(200).json({
      message: "Announcement updated successfully",
      announcement,
    });
  } catch (error) {
    console.error("Update announcement error:", error);

    return res.status(500).json({
      message: "Failed to update announcement",
      error: error.message,
    });
  }
};

// --------------------------------------------------
// DELETE ANNOUNCEMENT
// DELETE /api/announcements/:id
// Admin only
// --------------------------------------------------
const deleteAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid announcement ID",
      });
    }

    const deleted = await Announcement.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        message: "Announcement not found",
      });
    }

    return res.status(200).json({
      message: "Announcement deleted successfully",
    });
  } catch (error) {
    console.error("Delete announcement error:", error);

    return res.status(500).json({
      message: "Failed to delete announcement",
      error: error.message,
    });
  }
};

// --------------------------------------------------
// GET ALL ANNOUNCEMENTS FOR LOGGED-IN STUDENT
// GET /api/announcements
// Authenticated student, paid enrollments required
// --------------------------------------------------
const getAllStudentAnnouncements = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;

    // Student ke paid contests nikalo.
    const contestIds = await Enrollment.distinct("contestId", {
      userId,
      status: "paid",
    });

    // Agar student kisi contest mein enrolled nahi hai.
    if (contestIds.length === 0) {
      return res.status(200).json({
        count: 0,
        announcements: [],
      });
    }

    // Un sabhi contests ke published announcements lao.
    const announcements = await Announcement.find({
      contestId: { $in: contestIds },
      published: true,
    })
      .populate("contestId", "title")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      count: announcements.length,
      announcements,
    });
  } catch (error) {
    console.error("Get all student announcements error:", error);

    return res.status(500).json({
      message: "Failed to fetch announcements",
    });
  }
};

module.exports = {
  createAnnouncement,
  getAdminAnnouncements,
  getAnnouncements,
  getAllStudentAnnouncements,
  updateAnnouncement,
  deleteAnnouncement,
};
