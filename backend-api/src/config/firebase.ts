import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import dotenv from 'dotenv';

dotenv.config();

const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;

if (!rawPrivateKey) {
  throw new Error('FIREBASE_PRIVATE_KEY no está configurada');
}

const privateKey = rawPrivateKey
  .replace(/^(['"])([\s\S]*)\1$/, '$2')
  .replace(/\\n/g, '\n');

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