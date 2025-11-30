import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

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

async function verifyToken(idToken) {
  if (!auth) return null;
  try {
    return await auth.verifyIdToken(idToken);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

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
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userDoc.data();
    
    // Get usage logs (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const logsSnapshot = await db.collection('usage_logs')
      .where('userId', '==', decoded.uid)
      .where('timestamp', '>=', thirtyDaysAgo.toISOString())
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();

    const logs = logsSnapshot.docs.map(doc => doc.data());
    
    // Calculate stats
    const stats = {
      totalRequests: logs.length,
      byModel: {},
      byProvider: { openai: 0, anthropic: 0 },
      last24h: 0,
      last7d: 0,
    };

    const now = new Date();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    logs.forEach(log => {
      const logDate = new Date(log.timestamp);
      stats.byModel[log.model] = (stats.byModel[log.model] || 0) + 1;
      stats.byProvider[log.provider] = (stats.byProvider[log.provider] || 0) + 1;
      if (logDate >= oneDayAgo) stats.last24h++;
      if (logDate >= sevenDaysAgo) stats.last7d++;
    });

    return res.json({
      freeRequestsUsed: user.freeRequestsUsed || 0,
      freeRequestsLimit: user.freeRequestsLimit || 20,
      freeRemaining: Math.max(0, (user.freeRequestsLimit || 20) - (user.freeRequestsUsed || 0)),
      hasUnlimitedOpenAI: (user.bytezKeys?.length || 0) > 0,
      hasClaudeAccess: (user.puterKeys?.length || 0) > 0,
      stats,
      recentLogs: logs.slice(0, 20),
    });
  } catch (error) {
    console.error('Usage error:', error);
    return res.status(500).json({ error: error.message });
  }
}
