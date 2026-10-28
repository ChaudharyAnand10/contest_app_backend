const jwt = require("jsonwebtoken");
const User = require("../models/User");

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    const user = await User.findById(decoded.userId)
      .select("+sessionId");

    if (!user) {
      return res.status(401).json({
        code: "UNAUTHORIZED",
        message: "User not found",
      });
    }

    // Check whether this device still has the active session
    if (
      !user.sessionId ||
      user.sessionId !== decoded.sessionId
    ) {
      return res.status(401).json({
        code: "SESSION_REPLACED",
        message:
          "Your account is logged in on another device",
      });
    }

    req.user = user;
    req.userId = user._id.toString();

    next();
  } catch (error) {
    console.error("Auth middleware error:", error.message);

    return res.status(401).json({
      code: "UNAUTHORIZED",
      message: "Invalid or expired token",
    });
  }
};

module.exports = authMiddleware;
