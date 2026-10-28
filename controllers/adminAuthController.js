
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const getAllowedAdminEmails = () =>
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

// POST /api/admin-auth/signup
const adminSignup = async (req, res) => {
  try {
    const { name, email, password, username, phone_number } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Name, email and password are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!getAllowedAdminEmails().includes(normalizedEmail)) {
      return res.status(403).json({
        message: "This email is not authorized to create an admin account",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters",
      });
    }

    const existingUser = await User.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      return res.status(409).json({
        message: "Account already exists. Please sign in.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      username: username || normalizedEmail.split("@")[0],
      phone_number: phone_number || "",
      password: hashedPassword,
      sessionId: require("crypto").randomUUID(),
    });

    const token = jwt.sign(
      {
        userId: user._id,
        sessionId: user.sessionId,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.status(201).json({
      message: "Admin account created successfully",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Admin signup error:", error.message);

    return res.status(500).json({
      message: "Admin signup failed",
    });
  }
};

// POST /api/admin-auth/login
const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!getAllowedAdminEmails().includes(normalizedEmail)) {
      return res.status(403).json({
        message: "This email is not authorized for admin access",
      });
    }

    const user = await User.findOne({
      email: normalizedEmail,
    });

    if (!user) {
      return res.status(401).json({
        message: "Admin account not found. Please sign up first.",
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    // Invalidate the previous session, matching your auth middleware design.
    user.sessionId = require("crypto").randomUUID();
    await user.save();

    const token = jwt.sign(
      {
        userId: user._id,
        sessionId: user.sessionId,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.status(200).json({
      message: "Admin login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Admin login error:", error.message);

    return res.status(500).json({
      message: "Admin login failed",
    });
  }
};

module.exports = {
  adminSignup,
  adminLogin,
};
