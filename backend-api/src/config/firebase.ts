import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import dotenv from 'dotenv';

dotenv.config();

// Forzamos el tipo "as string" para que TypeScript no se queje de undefined
const privateKey = (process.env.FIREBASE_PRIVATE_KEY as string)?.replace(/\\n/g, '\n');

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID as string,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL as string,
      privateKey: privateKey,
    }),
  });
}

export const db = getFirestore();