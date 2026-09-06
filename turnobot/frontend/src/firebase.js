import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAr_XqzCCNvkVivrsOMd_vtm6lgZ5OSWqU",
  authDomain: "stalwart-coast-439901-d0.firebaseapp.com",
  projectId: "stalwart-coast-439901-d0",
  storageBucket: "stalwart-coast-439901-d0.firebasestorage.app",
  messagingSenderId: "850305350371",
  appId: "1:850305350371:web:39bb88e72d95ebdce2e3d6",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);
