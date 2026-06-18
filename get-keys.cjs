require('dotenv').config();
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

(async () => {
    if (!getApps().length) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        initializeApp({ credential: cert(serviceAccount) });
    }

    const db = getFirestore();
    const auth = getAuth();

    const userRecord = await auth.getUserByEmail('imtiyazakiwat0@gmail.com');
    const userDoc = await db.collection('users').doc(userRecord.uid).get();
    const puterKeys = userDoc.data().puterKeys || [];

    console.log('Total keys:', puterKeys.length);
    puterKeys.forEach((k, i) => {
        const key = typeof k === 'string' ? k : k.key;
        console.log(`${i + 1}: ${key}`);
    });

    process.exit(0);
})();
