import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, doc, setDoc, collection, addDoc, serverTimestamp } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDv6tIXw2M_xtF8EvzwRwAbv59BxujhdI0",
  authDomain: "trading-82365.firebaseapp.com",
  projectId: "trading-82365",
  storageBucket: "trading-82365.firebasestorage.app",
  messagingSenderId: "323423148081",
  appId: "1:323423148081:web:aaf50bbaccc5354c1e5d10",
  measurementId: "G-1D80YBNZXF"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Helper function to store new user details into Firestore Database
export async function syncUserToFirebase(user: { id: string | number; email: string; firstName?: string; lastName?: string }) {
  try {
    const userRef = doc(db, "users", String(user.id));
    await setDoc(userRef, {
      email: user.email,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      createdAt: serverTimestamp(),
      balance: 0 // initial balance
    }, { merge: true });
    console.log("Firebase user synced!");
  } catch (err) {
    console.error("Firebase sync error:", err);
  }
}

// Helper function to store deposit or withdraw amount details
export async function recordTransactionToFirebase(userId: string | number, type: "deposit" | "withdraw", amount: number) {
  try {
    const transactionRef = collection(db, "users", String(userId), "transactions");
    await addDoc(transactionRef, {
      type,
      amount,
      timestamp: serverTimestamp()
    });
    console.log(`Firebase transaction (${type}) recorded!`);
  } catch (err) {
    console.error("Firebase transaction error:", err);
  }
}

export { app, auth, db };
