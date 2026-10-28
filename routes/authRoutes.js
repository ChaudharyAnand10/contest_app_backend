const express = require("express");

const {
    signup,
    signin,
    logout,
    registerFcmToken,
} = require("../controllers/authController");

const authMiddleware =
    require("../middleware/authMiddleware");

const router =
    express.Router();


router.post(
    "/signup",
    signup
);


router.post(
    "/signin",
    signin
);


router.post(
    "/logout",
    authMiddleware,
    logout
);
router.post("/fcm-token", authMiddleware, registerFcmToken);


module.exports = router;