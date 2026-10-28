
const {
  messaging,
} = require("../config/firebaseAdmin");

const sendPushNotification = async ({
  fcmToken,
  title,
  body,
  data = {},
}) => {
  // FCM token nahi hai to notification skip karo
  if (!fcmToken) {
    console.log(
      "FCM token not found. Notification skipped."
    );

    return null;
  }

  try {
    // Firebase data payload ki values strings honi chahiye
    const formattedData = Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        String(value),
      ])
    );

    const message = {
      token: fcmToken,

      notification: {
        title,
        body,
      },

      data: formattedData,

      android: {
        priority: "high",

        notification: {
          channelId: "default",
          sound: "default",
        },
      },
    };

    // Firebase ke through push notification bhejo
    const messageId = await messaging.send(message);

    console.log(
      "Push notification sent successfully:",
      messageId
    );

    return messageId;
  } catch (error) {
    console.error(
      "Push notification failed:",
      error.message
    );

    return null;
  }
};

module.exports = sendPushNotification;
