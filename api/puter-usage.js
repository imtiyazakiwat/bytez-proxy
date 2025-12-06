import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// Initialize Firebase Admin
let db = null;
let auth = null;

try {
  if (!getApps().length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (serviceAccount.project_id) {
      initializeApp({ credential: cert(serviceAccount) });
    }
  }
  db = getFirestore();
  auth = getAuth();
} catch (e) {
  console.warn('Firebase not initialized:', e.message);
}

async function verifyToken(idToken) {
  if (!auth) return null;
  try {
    return await auth.verifyIdToken(idToken);
  } catch {
    return null;
  }
}

const PUTER_API_BASE = 'https://api.puter.com';

// Fetch usage from Puter API with whoami for isTemp
async function getPuterUsage(apiKey) {
  const origins = ['https://puter.com', 'https://g4f.dev', 'https://api.puter.com'];
  
  for (const origin of origins) {
    try {
      const [whoamiRes, usageRes] = await Promise.all([
        fetch(`${PUTER_API_BASE}/whoami`, {
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Origin': origin }
        }),
        fetch(`${PUTER_API_BASE}/metering/usage`, {
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Origin': origin }
        })
      ]);
      
      const whoami = await whoamiRes.json();
      const usage = await usageRes.json();
      
      if (whoami.username || whoami.uuid) {
        return { ...usage, isTemp: whoami.is_temp, username: whoami.username };
      }
    } catch (e) {
      continue;
    }
  }
  
  return { error: 'Failed to fetch usage' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

  try {
    // Get user's Puter keys
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    if (!userDoc.exists) {
      return res.json({ keys: [], totalUsage: null });
    }

    const userData = userDoc.data();
    const puterKeys = userData.puterKeys || [];

    if (puterKeys.length === 0) {
      return res.json({ keys: [], totalUsage: null, message: 'No Puter keys added' });
    }

    // Fetch usage for each key
    const usagePromises = puterKeys.map(async (keyData, index) => {
      const key = typeof keyData === 'string' ? keyData : keyData.key;
      const usage = await getPuterUsage(key);
      return {
        id: index,
        preview: key.substring(0, 20) + '...' + key.slice(-8),
        usage: usage.error ? null : usage,
        error: usage.error || null
      };
    });

    const keysUsage = await Promise.all(usagePromises);

    // Calculate totals
    let totalUsed = 0;
    let totalAllowance = 0;
    let totalRemaining = 0;

    keysUsage.forEach(k => {
      if (k.usage?.allowanceInfo) {
        totalAllowance += k.usage.allowanceInfo.monthUsageAllowance || 0;
        totalRemaining += k.usage.allowanceInfo.remaining || 0;
      }
      if (k.usage?.usage?.total) {
        totalUsed += k.usage.usage.total;
      }
    });

    return res.json({
      keys: keysUsage,
      totals: {
        used: totalUsed,
        allowance: totalAllowance,
        remaining: totalRemaining
      }
    });

  } catch (error) {
    console.error('Puter usage error:', error);
    return res.status(500).json({ error: error.message });
  }
}
