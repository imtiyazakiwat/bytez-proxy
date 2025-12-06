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

const PUTER_API_BASE = 'https://api.puter.com';

// Fetch Puter key usage info
async function getPuterKeyUsage(key) {
  const origins = ['https://puter.com', 'https://g4f.dev', 'https://api.puter.com'];
  
  for (const origin of origins) {
    try {
      const [whoamiRes, usageRes] = await Promise.all([
        fetch(`${PUTER_API_BASE}/whoami`, {
          headers: { 'Authorization': `Bearer ${key}`, 'Origin': origin }
        }),
        fetch(`${PUTER_API_BASE}/metering/usage`, {
          headers: { 'Authorization': `Bearer ${key}`, 'Origin': origin }
        })
      ]);
      
      const whoami = await whoamiRes.json();
      const usage = await usageRes.json();
      
      // If we got valid data, return it
      if (whoami.username || whoami.uuid) {
        return {
          username: whoami.username,
          isTemp: whoami.is_temp,
          used: usage.usage?.total || 0,
          allowance: usage.allowanceInfo?.monthUsageAllowance || 0,
          remaining: usage.allowanceInfo?.remaining || 0
        };
      }
    } catch (e) {
      continue;
    }
  }
  
  return null;
}

// Test if a Puter API key is valid using whoami endpoint
async function testPuterKey(key) {
  try {
    // Try with different origins as some keys are bound to specific origins
    const origins = ['https://puter.com', 'https://g4f.dev', 'https://api.puter.com'];
    
    for (const origin of origins) {
      try {
        const response = await fetch(`${PUTER_API_BASE}/whoami`, {
          headers: {
            'Authorization': `Bearer ${key}`,
            'Origin': origin,
          },
        });

        const data = await response.json();
        
        // If we get a username or uuid, the key is valid
        if (data.username || data.uuid) {
          const warning = data.is_temp ? 'Temp user account' : null;
          return { valid: true, message: warning ? `Key valid (${warning})` : 'Key is valid!', warning: !!warning };
        }
      } catch (e) {
        // Try next origin
        continue;
      }
    }
    
    // If all origins failed, try one more time and return the error
    const response = await fetch(`${PUTER_API_BASE}/whoami`, {
      headers: { 'Authorization': `Bearer ${key}` },
    });
    const data = await response.json();
    
    if (data.username || data.uuid) {
      return { valid: true, message: 'Key is valid!' };
    }
    
    return { valid: false, message: data.message || 'Invalid API key' };
  } catch (error) {
    return { valid: false, message: `Connection error: ${error.message}` };
  }
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
      const today = new Date().toISOString().split('T')[0];
      // Reset daily count if it's a new day
      const dailyUsed = user.lastRequestDate === today ? (user.dailyRequestsUsed || 0) : 0;
      
      // Mask keys for display (show first 15 and last 4 chars)
      const maskedKeys = (user.puterKeys || []).map((key, index) => ({
        id: index,
        preview: key.length > 25 ? `${key.substring(0, 15)}...${key.substring(key.length - 4)}` : key.substring(0, 20) + '...',
      }));
      
      return res.json({
        uid: user.uid,
        email: user.email,
        apiKey: user.apiKey,
        freeRequestsUsed: user.freeRequestsUsed,
        freeRequestsLimit: user.freeRequestsLimit,
        dailyRequestsUsed: dailyUsed,
        dailyLimit: 15,
        lastRequestDate: user.lastRequestDate,
        puterKeysCount: user.puterKeys?.length || 0,
        puterKeys: maskedKeys,
        hasUnlimitedOpenAI: (user.puterKeys?.length || 0) > 0,
        hasClaudeAccess: (user.puterKeys?.length || 0) > 0,
        // Lifetime stats
        totalRequests: user.totalRequests || 0,
        totalTokens: user.totalTokens || 0,
        totalPromptTokens: user.totalPromptTokens || 0,
        totalCompletionTokens: user.totalCompletionTokens || 0,
      });
    }

    // POST - Add provider key
    if (req.method === 'POST') {
      const { action, provider, key } = req.body;
      const userRef = db.collection('users').doc(uid);
      
      if (action === 'testKey') {
        if (!key || !key.trim()) {
          return res.status(400).json({ error: 'Key is required' });
        }
        const testResult = await testPuterKey(key.trim());
        return res.json(testResult);
      }
      
      if (action === 'checkKey') {
        if (!key || !key.trim()) {
          return res.status(400).json({ error: 'Key is required' });
        }
        
        // Test the key first
        const testResult = await testPuterKey(key.trim());
        if (!testResult.valid) {
          return res.status(400).json({ error: `Invalid key: ${testResult.message}` });
        }
        
        // Check if key is already added
        const userDoc = await userRef.get();
        const userData = userDoc.data();
        const existingKeys = userData?.puterKeys || [];
        const isAlreadyAdded = existingKeys.includes(key.trim());
        
        // Get usage info
        const usageInfo = await getPuterKeyUsage(key.trim());
        
        return res.json({ 
          valid: true, 
          message: testResult.warning ? 'Key valid (may have limits)' : 'Key is valid!',
          warning: testResult.warning,
          usage: usageInfo,
          isAlreadyAdded
        });
      }
      
      if (action === 'addKey') {
        if (!key || !key.trim()) {
          return res.status(400).json({ error: 'Key is required' });
        }
        
        // Test the key first
        const testResult = await testPuterKey(key.trim());
        if (!testResult.valid) {
          return res.status(400).json({ error: `Invalid key: ${testResult.message}` });
        }
        
        // Get usage info for the key
        const usageInfo = await getPuterKeyUsage(key.trim());
        
        const field = 'puterKeys';
        const userDoc = await userRef.get();
        const userData = userDoc.data();
        const keys = userData[field] || [];
        
        if (keys.includes(key.trim())) {
          return res.status(400).json({ error: 'Key already added' });
        }
        
        keys.push(key.trim());
        await userRef.update({ [field]: keys, updatedAt: new Date().toISOString() });
        
        return res.json({ 
          success: true, 
          keysCount: keys.length, 
          warning: testResult.warning,
          usage: usageInfo
        });
      }
      
      if (action === 'removeKey') {
        const { keyIndex } = req.body;
        if (keyIndex === undefined) {
          return res.status(400).json({ error: 'Key index is required' });
        }
        
        const userDoc = await userRef.get();
        const userData = userDoc.data();
        const keys = userData.puterKeys || [];
        
        if (keyIndex < 0 || keyIndex >= keys.length) {
          return res.status(400).json({ error: 'Invalid key index' });
        }
        
        keys.splice(keyIndex, 1);
        await userRef.update({ puterKeys: keys, updatedAt: new Date().toISOString() });
        
        return res.json({ success: true, keysCount: keys.length });
      }
      
      if (action === 'regenerateApiKey') {
        const newApiKey = generateApiKey();
        await userRef.update({ apiKey: newApiKey, updatedAt: new Date().toISOString() });
        return res.json({ success: true, apiKey: newApiKey });
      }
      
      if (action === 'getFullKey') {
        const { keyIndex } = req.body;
        if (keyIndex === undefined) {
          return res.status(400).json({ error: 'Key index is required' });
        }
        
        const userDoc = await userRef.get();
        const userData = userDoc.data();
        const keys = userData.puterKeys || [];
        
        if (keyIndex < 0 || keyIndex >= keys.length) {
          return res.status(400).json({ error: 'Invalid key index' });
        }
        
        return res.json({ key: keys[keyIndex] });
      }
    }

    return res.status(400).json({ error: `Invalid request: method=${req.method}, action=${req.body?.action || 'none'}` });
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ error: error.message });
  }
}
