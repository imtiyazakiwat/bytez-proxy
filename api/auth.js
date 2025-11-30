import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { v4 as uuidv4 } from 'uuid';

// Initialize Firebase Admin
let db = null;
let auth = null;

try {
  if (!getApps().length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (serviceAccount.project_id) {
      initializeApp({ credential: cert(serviceAccount) });
      db = getFirestore();
      auth = getAuth();
    }
  } else {
    db = getFirestore();
    auth = getAuth();
  }
} catch (e) {
  console.warn('Firebase not initialized:', e.message);
}

// Generate API key
function generateApiKey() {
  return `sk-${uuidv4().replace(/-/g, '')}`;
}

// Verify Firebase ID token
async function verifyToken(idToken) {
  if (!auth) return null;
  try {
    return await auth.verifyIdToken(idToken);
  } catch (error) {
    return null;
  }
}

// Get or create user
async function getOrCreateUser(uid, email) {
  if (!db) return null;
  const userRef = db.collection('users').doc(uid);
  const userDoc = await userRef.get();
  
  if (!userDoc.exists) {
    const apiKey = generateApiKey();
    const userData = {
      uid,
      email,
      apiKey,
      freeRequestsUsed: 0,
      freeRequestsLimit: 20,
      bytezKeys: [],
      puterKeys: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await userRef.set(userData);
    return userData;
  }
  
  return userDoc.data();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  
  if (!idToken) {
    return res.status(401).json({ error: 'Authorization required' });
  }

  const decoded = await verifyToken(idToken);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { uid, email } = decoded;

  try {
    // GET - Get user profile
    if (req.method === 'GET') {
      const user = await getOrCreateUser(uid, email);
      return res.json({
        uid: user.uid,
        email: user.email,
        apiKey: user.apiKey,
        freeRequestsUsed: user.freeRequestsUsed,
        freeRequestsLimit: user.freeRequestsLimit,
        bytezKeysCount: user.bytezKeys?.length || 0,
        puterKeysCount: user.puterKeys?.length || 0,
        hasUnlimitedOpenAI: (user.bytezKeys?.length || 0) > 0,
        hasClaudeAccess: (user.puterKeys?.length || 0) > 0,
      });
    }

    // POST - Add provider key
    if (req.method === 'POST') {
      const { action, provider, key } = req.body;
      const userRef = db.collection('users').doc(uid);
      
      if (action === 'addKey') {
        const field = provider === 'bytez' ? 'bytezKeys' : 'puterKeys';
        const userDoc = await userRef.get();
        const userData = userDoc.data();
        const keys = userData[field] || [];
        
        if (!keys.includes(key)) {
          keys.push(key);
          await userRef.update({ [field]: keys, updatedAt: new Date().toISOString() });
        }
        
        return res.json({ success: true, keysCount: keys.length });
      }
      
      if (action === 'removeKey') {
        const field = provider === 'bytez' ? 'bytezKeys' : 'puterKeys';
        const userDoc = await userRef.get();
        const userData = userDoc.data();
        let keys = userData[field] || [];
        keys = keys.filter(k => k !== key);
        await userRef.update({ [field]: keys, updatedAt: new Date().toISOString() });
        
        return res.json({ success: true, keysCount: keys.length });
      }
      
      if (action === 'regenerateApiKey') {
        const newApiKey = generateApiKey();
        await userRef.update({ apiKey: newApiKey, updatedAt: new Date().toISOString() });
        return res.json({ success: true, apiKey: newApiKey });
      }
    }

    return res.status(400).json({ error: 'Invalid request' });
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ error: error.message });
  }
}
