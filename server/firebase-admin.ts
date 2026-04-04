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
export const firestore = admin.apps.length ? admin.firestore() : null;

/**
 * Mirror local user data to Cloud Firestore for permanent visibility
 */
export async function syncUserToFirestore(localUser: any) {
  if (!firestore) return;
  try {
     const docRef = firestore.collection("users").doc(localUser.id);
     await docRef.set({
       ...localUser,
       lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
     }, { merge: true });
     console.log(`[Firestore Sync] User ${localUser.email} archived to cloud`);
  } catch (error) {
     console.error("[Firestore Sync] Failed to mirror user to cloud:", error);
  }
}

export default admin;
