import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

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

// Hardcoded admin user IDs
const ADMIN_USER_IDS = ['7nMmX6NJHGX2mshNOeN7Zv97lrD2'];

const PUTER_BASE_URL = 'https://api.puter.com/drivers/call';

// Test if a Puter API key is valid by making a simple request
async function testPuterKey(key) {
  try {
    const response = await fetch(PUTER_BASE_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Origin': 'https://puter.com',
      },
      body: JSON.stringify({
        interface: 'puter-chat-completion',
        driver: 'openai-completion',
        method: 'complete',
        args: {
          messages: [{ role: 'user', content: 'Hi' }],
          model: 'gpt-4o-mini',
          max_tokens: 5,
        },
      }),
    });

    const data = await response.json();
    
    if (data.success) {
      return { valid: true, message: 'Key is valid and working' };
    }
    
    // Check for specific error types
    const errorMsg = data.error?.message || data.error || 'Unknown error';
    
    // These errors mean the key is valid but has usage limits
    if (errorMsg.includes('usage-limited') || errorMsg.includes('rate limit') || errorMsg.includes('quota')) {
      return { valid: true, message: 'Key is valid (but may have usage limits)', warning: true };
    }
    
    // Invalid key errors
    if (errorMsg.includes('invalid') || errorMsg.includes('unauthorized') || errorMsg.includes('authentication')) {
      return { valid: false, message: 'Invalid API key' };
    }
    
    return { valid: false, message: errorMsg };
  } catch (error) {
    return { valid: false, message: `Connection error: ${error.message}` };
  }
}

async function verifyToken(idToken) {
  if (!auth) return null;
  try {
    return await auth.verifyIdToken(idToken);
  } catch {
    return null;
  }
}

function isAdmin(uid) {
  return ADMIN_USER_IDS.includes(uid);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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

  // Check if user is admin
  if (!isAdmin(decoded.uid)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    // GET - Get system config and admin keys
    if (req.method === 'GET') {
      const configDoc = await db.collection('system').doc('config').get();
      const config = configDoc.exists ? configDoc.data() : { systemPuterKeys: [] };
      
      // Get some stats
      const usersSnapshot = await db.collection('users').get();
      const totalUsers = usersSnapshot.size;
      
      // Mask keys for display (show first 20 chars only)
      const maskedKeys = (config.systemPuterKeys || []).map((key, index) => ({
        id: index,
        preview: key.substring(0, 20) + '...',
        addedAt: config.keyAddedDates?.[index] || 'Unknown'
      }));

      return res.json({
        isAdmin: true,
        totalUsers,
        systemKeysCount: config.systemPuterKeys?.length || 0,
        systemKeys: maskedKeys,
        dailyFreeLimit: config.dailyFreeLimit || 15,
      });
    }

    // POST - Add system Puter key or update config
    if (req.method === 'POST') {
      const { action, key, dailyFreeLimit } = req.body;
      const configRef = db.collection('system').doc('config');
      
      if (action === 'testKey') {
        if (!key || !key.trim()) {
          return res.status(400).json({ error: 'Key is required' });
        }
        
        const testResult = await testPuterKey(key.trim());
        return res.json(testResult);
      }
      
      if (action === 'addSystemKey') {
        if (!key || !key.trim()) {
          return res.status(400).json({ error: 'Key is required' });
        }
        
        // Test the key first
        const testResult = await testPuterKey(key.trim());
        if (!testResult.valid) {
          return res.status(400).json({ error: `Invalid key: ${testResult.message}` });
        }
        
        const configDoc = await configRef.get();
        const config = configDoc.exists ? configDoc.data() : { systemPuterKeys: [], keyAddedDates: [] };
        const keys = config.systemPuterKeys || [];
        const dates = config.keyAddedDates || [];
        
        // Check if key already exists
        if (keys.includes(key.trim())) {
          return res.status(400).json({ error: 'Key already exists' });
        }
        
        keys.push(key.trim());
        dates.push(new Date().toISOString());
        
        await configRef.set({ 
          systemPuterKeys: keys, 
          keyAddedDates: dates,
          updatedAt: new Date().toISOString(),
          updatedBy: decoded.uid
        }, { merge: true });
        
        return res.json({ success: true, keysCount: keys.length, warning: testResult.warning });
      }
      
      if (action === 'updateConfig') {
        const updates = { updatedAt: new Date().toISOString(), updatedBy: decoded.uid };
        if (dailyFreeLimit !== undefined) {
          updates.dailyFreeLimit = parseInt(dailyFreeLimit) || 15;
        }
        await configRef.set(updates, { merge: true });
        return res.json({ success: true });
      }
      
      return res.status(400).json({ error: 'Invalid action' });
    }

    // DELETE - Remove system Puter key
    if (req.method === 'DELETE') {
      const { keyIndex } = req.body;
      
      if (keyIndex === undefined) {
        return res.status(400).json({ error: 'Key index is required' });
      }
      
      const configRef = db.collection('system').doc('config');
      const configDoc = await configRef.get();
      
      if (!configDoc.exists) {
        return res.status(404).json({ error: 'No config found' });
      }
      
      const config = configDoc.data();
      const keys = config.systemPuterKeys || [];
      const dates = config.keyAddedDates || [];
      
      if (keyIndex < 0 || keyIndex >= keys.length) {
        return res.status(400).json({ error: 'Invalid key index' });
      }
      
      keys.splice(keyIndex, 1);
      dates.splice(keyIndex, 1);
      
      await configRef.set({ 
        systemPuterKeys: keys, 
        keyAddedDates: dates,
        updatedAt: new Date().toISOString(),
        updatedBy: decoded.uid
      }, { merge: true });
      
      return res.json({ success: true, keysCount: keys.length });
    }

    return res.status(400).json({ error: 'Invalid request' });
  } catch (error) {
    console.error('Admin error:', error);
    return res.status(500).json({ error: error.message });
  }
}
