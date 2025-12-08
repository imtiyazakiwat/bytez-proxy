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
    let logs = [];
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const logsSnapshot = await db.collection('usage_logs')
        .where('userId', '==', decoded.uid)
        .where('timestamp', '>=', thirtyDaysAgo.toISOString())
        .orderBy('timestamp', 'desc')
        .limit(500)
        .get();

      logs = logsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (indexError) {
      // Index might not exist yet - try simpler query
      console.warn('Usage logs query failed (index may be needed):', indexError.message);
      try {
        const logsSnapshot = await db.collection('usage_logs')
          .where('userId', '==', decoded.uid)
          .limit(100)
          .get();
        logs = logsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Sort manually
        logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      } catch (e) {
        console.warn('Fallback query also failed:', e.message);
      }
    }
    
    // Calculate comprehensive stats
    const stats = {
      totalRequests: logs.length,
      successfulRequests: logs.filter(l => l.success).length,
      failedRequests: logs.filter(l => !l.success).length,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      byModel: {},
      byProvider: {},
      byDate: {},
      last24h: { requests: 0, tokens: 0 },
      last7d: { requests: 0, tokens: 0 },
    };

    const now = new Date();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    logs.forEach(log => {
      const logDate = new Date(log.timestamp);
      const dateKey = log.date || log.timestamp?.split('T')[0];
      
      // Token totals
      const promptTokens = log.promptTokens || 0;
      const completionTokens = log.completionTokens || 0;
      const totalTokens = log.totalTokens || (promptTokens + completionTokens);
      
      stats.totalPromptTokens += promptTokens;
      stats.totalCompletionTokens += completionTokens;
      stats.totalTokens += totalTokens;
      
      // By model
      if (!stats.byModel[log.model]) {
        stats.byModel[log.model] = { requests: 0, tokens: 0, promptTokens: 0, completionTokens: 0 };
      }
      stats.byModel[log.model].requests++;
      stats.byModel[log.model].tokens += totalTokens;
      stats.byModel[log.model].promptTokens += promptTokens;
      stats.byModel[log.model].completionTokens += completionTokens;
      
      // By provider
      const provider = log.provider || 'unknown';
      if (!stats.byProvider[provider]) {
        stats.byProvider[provider] = { requests: 0, tokens: 0 };
      }
      stats.byProvider[provider].requests++;
      stats.byProvider[provider].tokens += totalTokens;
      
      // By date
      if (dateKey) {
        if (!stats.byDate[dateKey]) {
          stats.byDate[dateKey] = { requests: 0, tokens: 0, successful: 0, failed: 0 };
        }
        stats.byDate[dateKey].requests++;
        stats.byDate[dateKey].tokens += totalTokens;
        if (log.success) {
          stats.byDate[dateKey].successful++;
        } else {
          stats.byDate[dateKey].failed++;
        }
      }
      
      // Time-based stats
      if (logDate >= oneDayAgo) {
        stats.last24h.requests++;
        stats.last24h.tokens += totalTokens;
      }
      if (logDate >= sevenDaysAgo) {
        stats.last7d.requests++;
        stats.last7d.tokens += totalTokens;
      }
    });

    // Sort byDate for chart display
    const sortedDates = Object.keys(stats.byDate).sort();
    const dailyStats = sortedDates.map(date => ({
      date,
      ...stats.byDate[date]
    }));

    // Get top models by usage
    const topModels = Object.entries(stats.byModel)
      .sort((a, b) => b[1].requests - a[1].requests)
      .slice(0, 10)
      .map(([model, data]) => ({ model, ...data }));

    return res.json({
      // User limits
      freeRequestsUsed: user.freeRequestsUsed || 0,
      freeRequestsLimit: user.freeRequestsLimit || 20,
      freeRemaining: Math.max(0, (user.freeRequestsLimit || 20) - (user.freeRequestsUsed || 0)),
      dailyRequestsUsed: user.dailyRequestsUsed || 0,
      dailyLimit: 15,
      
      // Access status
      hasUnlimitedOpenAI: (user.bytezKeys?.length || 0) > 0,
      hasClaudeAccess: (user.puterKeys?.length || 0) > 0,
      puterKeysCount: user.puterKeys?.length || 0,
      
      // Lifetime totals from user doc
      lifetimeTotals: {
        requests: user.totalRequests || 0,
        promptTokens: user.totalPromptTokens || 0,
        completionTokens: user.totalCompletionTokens || 0,
        totalTokens: user.totalTokens || 0,
      },
      
      // Stats from logs
      stats: {
        ...stats,
        dailyStats,
        topModels,
      },
      
      // Recent logs for display
      recentLogs: logs.slice(0, 50).map(log => ({
        id: log.id,
        model: log.model,
        provider: log.provider,
        promptTokens: log.promptTokens || 0,
        completionTokens: log.completionTokens || 0,
        totalTokens: log.totalTokens || 0,
        promptCost: log.promptCost || 0,
        completionCost: log.completionCost || 0,
        totalCost: log.totalCost || 0,
        success: log.success,
        errorMessage: log.errorMessage,
        keyType: log.keyType,
        timestamp: log.timestamp,
      })),
    });
  } catch (error) {
    console.error('Usage error:', error);
    return res.status(500).json({ error: error.message });
  }
}
