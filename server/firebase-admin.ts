import admin from "firebase-admin";

// In production, we should provide the path to the service account JSON
// or initialize via environment variables!
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      // CREDENTIALS_PATH should point to your downloaded service account key
      // credential: admin.credential.cert(process.env.GOOGLE_APPLICATION_CREDENTIALS),
      projectId: process.env.FIREBASE_PROJECT_ID || "YOUR_PROJECT_ID",
    });
    console.log("[Firebase] Admin SDK initialized successfully");
  } catch (error) {
    console.error("[Firebase] Admin SDK initialization failed:", error);
  }
}

export const firebaseAdmin = admin;
export default admin;
