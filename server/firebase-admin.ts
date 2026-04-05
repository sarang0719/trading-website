import admin from "firebase-admin";

// v42.1 INSTITUTIONAL LAZY FIREBASE ADMIN
// Optimized for Vercel Serverless to prevent initialization timeouts

let initialized = false;

function ensureInitialized() {
  if (initialized) return admin;
  if (admin.apps.length > 0) {
    initialized = true;
    return admin;
  }

  // Attempt to initialize with environment variables
  try {
     const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
     
     if (projectId && projectId !== "YOUR_PROJECT_ID") {
        console.log(`[Firebase] Initializing Admin SDK for Project: ${projectId}`);
        admin.initializeApp({
           projectId,
           // credential: admin.credential.applicationDefault(),
        });
        initialized = true;
     } else {
        console.warn("[Firebase] Skipping Admin SDK initialization (No Valid Project ID)");
     }
  } catch (error) {
     console.error("[Firebase] Admin SDK init error:", error);
  }
  return admin;
}

export const firebaseAdmin = {
  auth: () => ensureInitialized().auth(),
  firestore: () => ensureInitialized().firestore(),
  messaging: () => ensureInitialized().messaging(),
};

export const firestore = {
  collection: (path: string) => firebaseAdmin.firestore().collection(path)
} as any;

export async function syncUserToFirestore(localUser: any) {
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
