const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const User = require("../models/User");


const signup = async (req, res) => {

  try {

    const {
      name,
      username,
      email,
      password,
      phone_number,
    } = req.body;


    if (
      !name ||
      !username ||
      !email ||
      !password ||
      !phone_number
    ) {

      return res.status(400).json({
        message: "All fields are required",
      });

    }


    const normalizedUsername =
      username.trim().toLowerCase();

    const normalizedEmail =
      email.trim().toLowerCase();


    const existingUsername =
      await User.findOne({
        username: normalizedUsername,
      });


    if (existingUsername) {

      return res.status(409).json({
        message: "Username already exists",
      });

    }


    const existingEmail =
      await User.findOne({
        email: normalizedEmail,
      });


    if (existingEmail) {

      return res.status(409).json({
        message: "Email already exists",
      });

    }


    const existingPhone =
      await User.findOne({
        phone_number,
      });


    if (existingPhone) {

      return res.status(409).json({
        message:
          "Phone number already exists",
      });

    }


    if (password.length < 6) {

      return res.status(400).json({
        message:
          "Password must contain at least 6 characters",
      });

    }


    const hashedPassword =
      await bcrypt.hash(
        password,
        12
      );


    const user =
      await User.create({

        name: name.trim(),

        username:
          normalizedUsername,

        email:
          normalizedEmail,

        password:
          hashedPassword,

        phone_number,

      });


    return res.status(201).json({

      message:
        "Signup successful",

      user: {
        id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone_number:
          user.phone_number,
      },

    });

  } catch (error) {

    // Handles MongoDB unique index race condition
    if (error.code === 11000) {

      const field =
        Object.keys(error.keyPattern)[0];

      return res.status(409).json({
        message:
          `${field} already exists`,
      });

    }


    return res.status(500).json({
      message: "Internal server error",
    });

  }
};


const signin = async (req, res) => {

  try {

    const {
      email,
      password,
    } = req.body;


    if (!email || !password) {

      return res.status(400).json({
        message:
          "Email and password are required",
      });

    }


    const normalizedEmail =
      email.trim().toLowerCase();


    const user =
      await User.findOne({
        email: normalizedEmail,
      });


    if (!user) {

      return res.status(401).json({
        message:
          "Invalid email or password",
      });

    }


    const passwordMatch =
      await bcrypt.compare(
        password,
        user.password
      );


    if (!passwordMatch) {

      return res.status(401).json({
        message:
          "Invalid email or password",
      });

    }


    // New login invalidates previous device

    const sessionId =
      crypto.randomUUID();


    user.sessionId =
      sessionId;


    await user.save();


    const token =
      jwt.sign(
        {
          userId: user._id.toString(),
          sessionId,
        },

        process.env.JWT_SECRET,

        {
          expiresIn: "5d",
        }
      );


    return res.json({

      message:
        "Signin successful",

      token,

      user: {
        id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone_number:
          user.phone_number,
      },

    });

  } catch (error) {

    return res.status(500).json({
      message: "Internal server error",
    });

  }
};


const logout = async (req, res) => {

  try {

    req.user.sessionId = null;

    await req.user.save();


    return res.json({
      message: "Logout successful",
    });

  } catch (error) {

    return res.status(500).json({
      message: "Logout failed",
    });

  }
};

const registerFcmToken = async (req, res) => {
  try {
    const { fcmToken } = req.body;

    if (
      typeof fcmToken !== "string" ||
      !fcmToken.trim() ||
      fcmToken.trim().length > 4096
    ) {
      return res.status(400).json({
        message: "A valid FCM token is required",
      });
    }

    req.user.fcmToken = fcmToken.trim();
    req.user.fcmTokenUpdatedAt = new Date();

    await req.user.save();

    return res.status(200).json({
      message: "FCM token registered successfully",
    });
  } catch (error) {
    console.error("Register FCM token error:", error.message);

    return res.status(500).json({
      message: "Unable to register FCM token",
    });
  }
};


module.exports = {
  signup,
  signin,
  logout,
  registerFcmToken,
};