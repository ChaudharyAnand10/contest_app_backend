const adminMiddleware = (req, res, next) => {
  try {
    if (!req.user || !req.user.email) {
      return res.status(401).json({
        message: "Authentication required",
      });
    }

    const adminEmails = (
      process.env.ADMIN_EMAILS || ""
    )
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);

    if (
      !adminEmails.includes(
        req.user.email.toLowerCase()
      )
    ) {
      return res.status(403).json({
        message: "Admin access required",
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({
      message: "Admin authorization failed",
    });
  }
};

module.exports = adminMiddleware;