import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDO-U2tUsx8k-wyo1aOQb9cnEDtNEtJgts",
  authDomain: "puterg4fapi.firebaseapp.com",
  projectId: "puterg4fapi",
  storageBucket: "puterg4fapi.firebasestorage.app",
  messagingSenderId: "183955580034",
  appId: "1:183955580034:web:0a160215f88b3728cfc09b",
  measurementId: "G-C7DQG640WV"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
