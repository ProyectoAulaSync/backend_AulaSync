import { getAuth } from 'firebase-admin/auth';
import './firebase'; // garantiza que Firebase Admin ya esté inicializado

export const auth = getAuth();
