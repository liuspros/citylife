// src/lib/firebase.js
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';

const cfg = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// DIAGNOSTIC LOG: This will show you exactly what Next.js is passing to Firebase
console.log("DEBUG DATABASE URL:", JSON.stringify(cfg.databaseURL));

// 1. Establish app context safely
export const app = getApps().length > 0 ? getApp() : initializeApp(cfg);

// 2. Core initializations
export const auth = getAuth(app);
export const db = getFirestore(app);

// 3. Strict structural safeguard 
const hasValidUrl = cfg.databaseURL && 
                    cfg.databaseURL !== "undefined" && 
                    cfg.databaseURL !== "null" && 
                    cfg.databaseURL.startsWith('https://');

export const rtdb = hasValidUrl ? getDatabase(app, cfg.databaseURL) : null;
