
const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const cors = require("cors");

const connectDB = require("./config/db");

const {
  expirePendingOrders,
  razorpayWebhook,
} = require("./controllers/paymentController");
const {
  startAttemptExpiryJob,
} = require("./utils/expireAttempts");

const app = express();


app.use(cors());

// Razorpay webhook: raw body must be preserved for signature verification.
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  razorpayWebhook
);

// Normal API requests can use JSON parsing.
app.use(express.json());

// Existing routes
const authRoutes = require("./routes/authRoutes");
const contestRoutes = require("./routes/contestRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const attemptRoutes = require("./routes/attemptRoutes");
const adminAuthRoutes = require("./routes/adminAuthRoutes");

// Additional routes
const adminRoutes = require("./routes/adminRoutes");
const profileRoutes = require("./routes/profileRoutes");
const announcementRoutes = require("./routes/announcementRoutes");

// Register routes
app.use("/api/auth", authRoutes);
app.use("/api/contests", contestRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/attempts", attemptRoutes);

app.use("/api/admin", adminRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/announcements", announcementRoutes);
app.use("/api/admin-auth", adminAuthRoutes);

// Home route
app.get("/", (req, res) => {
  res.status(200).json({
    message: "Contest API is running",
  });
});

// Start server only after database connection
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();

    // Clean up expired payment reservations once at startup.
    await expirePendingOrders();

     startAttemptExpiryJob();

    // Periodically release expired reservations.
    const expiryWorker = setInterval(async () => {
      try {
        await expirePendingOrders();
      } catch (error) {
        console.error(
          "Reservation expiry worker failed:",
          error.message
        );
      }
    }, 30 * 1000);

    if (typeof expiryWorker.unref === "function") {
      expiryWorker.unref();
    }

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error(
      "Server startup failed:",
      error.message
    );

    process.exit(1);
  }
};

startServer();
