
const {
  initializeApp,
  getApps,
  cert,
} = require("firebase-admin/app");

const {
  getMessaging,
} = require("firebase-admin/messaging");

const path = require("path");
const fs = require("fs");

// Firebase service account JSON file ka path
const serviceAccountPath = path.join(
  __dirname,
  "..",
  "private",
  "firebase-service-account.json"
);

console.log("Checking Firebase file:", serviceAccountPath);

// Check karo ki JSON file exist karti hai ya nahi
if (!fs.existsSync(serviceAccountPath)) {
  throw new Error(
    "Firebase service account JSON file not found. Please check backend/private/firebase-service-account.json"
  );
}

// Service account credentials load karo
const serviceAccount = require(serviceAccountPath);

// Firebase Admin app initialize karo
const app =
  getApps().length === 0
    ? initializeApp({
        credential: cert(serviceAccount),
      })
    : getApps()[0];

// Firebase Messaging initialize karo
const messaging = getMessaging(app);

console.log("Firebase Admin initialized successfully");

module.exports = {
  app,
  messaging,
};
