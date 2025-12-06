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

// Test if a Puter API key is valid
async function testPuterKey(key) {
  const origins = ['https://puter.com', 'https://g4f.dev', 'https://api.puter.com'];
  
  for (const origin of origins) {
    try {
      const response = await fetch(`${PUTER_API_BASE}/whoami`, {
        headers: { 'Authorization': `Bearer ${key}`, 'Origin': origin },
      });
      const data = await response.json();
      
      if (data.username || data.uuid) {
        const warning = data.is_temp ? 'Temp user account' : null;
        return { valid: true, message: warning ? `Key valid (${warning})` : 'Key is valid!', warning: !!warning };
      }
    } catch (e) {
      continue;
    }
  }
  
  return { valid: false, message: 'Invalid API key' };
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
      
      if (action === 'checkKey') {
        if (!key || !key.trim()) {
          return res.status(400).json({ error: 'Key is required' });
        }
        
        const testResult = await testPuterKey(key.trim());
        if (!testResult.valid) {
          return res.status(400).json({ error: `Invalid key: ${testResult.message}` });
        }
        
        // Check if already added
        const configDoc = await configRef.get();
        const config = configDoc.exists ? configDoc.data() : { systemPuterKeys: [] };
        const isAlreadyAdded = (config.systemPuterKeys || []).includes(key.trim());
        
        // Get usage info
        const usageInfo = await getPuterKeyUsage(key.trim());
        
        return res.json({
          valid: true,
          message: testResult.message,
          warning: testResult.warning,
          usage: usageInfo,
          isAlreadyAdded
        });
      }
      
      if (action === 'getSystemKeysUsage') {
        const configDoc = await configRef.get();
        const config = configDoc.exists ? configDoc.data() : { systemPuterKeys: [] };
        const keys = config.systemPuterKeys || [];
        
        // Fetch usage for all keys in parallel
        const usagePromises = keys.map(async (k, index) => {
          const usage = await getPuterKeyUsage(k);
          return {
            id: index,
            preview: k.substring(0, 20) + '...' + k.slice(-8),
            usage: usage,
            error: usage ? null : 'Failed to fetch'
          };
        });
        
        const keysUsage = await Promise.all(usagePromises);
        
        // Calculate totals
        let totalUsed = 0, totalAllowance = 0, totalRemaining = 0;
        keysUsage.forEach(k => {
          if (k.usage) {
            totalUsed += k.usage.used || 0;
            totalAllowance += k.usage.allowance || 0;
            totalRemaining += k.usage.remaining || 0;
          }
        });
        
        return res.json({
          keys: keysUsage,
          totals: { used: totalUsed, allowance: totalAllowance, remaining: totalRemaining }
        });
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
      
      if (action === 'getFullKey') {
        const { keyIndex } = req.body;
        if (keyIndex === undefined) {
          return res.status(400).json({ error: 'Key index is required' });
        }
        
        const configDoc = await configRef.get();
        const config = configDoc.exists ? configDoc.data() : { systemPuterKeys: [] };
        const keys = config.systemPuterKeys || [];
        
        if (keyIndex < 0 || keyIndex >= keys.length) {
          return res.status(400).json({ error: 'Invalid key index' });
        }
        
        return res.json({ key: keys[keyIndex] });
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
