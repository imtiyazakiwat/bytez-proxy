import { useState, useEffect } from 'react';
import { auth } from '../firebase';
import { Zap, Shield, Activity, BarChart3, Copy, Check } from 'lucide-react';
import StatCard from '../components/ui/StatCard';
import { formatNumber, estimateCost } from '../utils/format';

const API_URL = import.meta.env.VITE_API_URL || window.location.origin;

export default function OverviewPage({ profile, copyApiKey, copied }) {
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUsage();
  }, []);

  const loadUsage = async () => {
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/usage', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!data.error) setUsage(data);
    } catch (e) {
      console.error('Failed to load usage:', e);
    } finally {
      setLoading(false);
    }
  };

  const dailyLimit = 15;
  const dailyUsed = usage?.dailyRequestsUsed || profile?.dailyRequestsUsed || 0;
  const dailyRemaining = Math.max(0, dailyLimit - dailyUsed);
  const dailyPercent = (dailyUsed / dailyLimit) * 100;

  return (
    <div className="tab-content">
      <h1>Dashboard</h1>
      
      <div className="stats-grid">
        <StatCard 
          icon={<Zap />}
          value={profile?.puterKeysCount > 0 ? '∞' : dailyRemaining}
          label={profile?.puterKeysCount > 0 ? 'Unlimited (Own Keys)' : `Daily Left (${dailyUsed}/${dailyLimit})`}
          progress={!profile?.puterKeysCount ? dailyPercent : undefined}
        />
        <StatCard 
          icon={<Shield />}
          value={profile?.hasUnlimitedOpenAI ? 'Unlimited' : 'Limited'}
          label="OpenAI Access"
          iconBg={profile?.hasUnlimitedOpenAI ? 'var(--success)' : undefined}
        />
        <StatCard 
          icon={<Activity />}
          value={profile?.hasClaudeAccess ? 'Active' : 'Inactive'}
          label="Claude Access"
          iconBg={profile?.hasClaudeAccess ? 'var(--success)' : undefined}
        />
        <StatCard 
          icon={<BarChart3 />}
          value={formatNumber(usage?.lifetimeTotals?.totalTokens || 0)}
          label="Total Tokens Used"
        />
      </div>

      <div className="card">
        <h3>Usage Statistics</h3>
        {loading ? (
          <p className="card-desc">Loading...</p>
        ) : (
          <div className="usage-stats-grid">
            <div className="usage-stat">
              <span className="usage-stat-value">{usage?.stats?.last24h?.requests || 0}</span>
              <span className="usage-stat-label">Requests (24h)</span>
            </div>
            <div className="usage-stat">
              <span className="usage-stat-value">{estimateCost(usage?.stats?.last24h?.tokens)}</span>
              <span className="usage-stat-label">Est. Cost (24h)</span>
            </div>
            <div className="usage-stat">
              <span className="usage-stat-value">{usage?.stats?.last7d?.requests || 0}</span>
              <span className="usage-stat-label">Requests (7d)</span>
            </div>
            <div className="usage-stat">
              <span className="usage-stat-value">{estimateCost(usage?.stats?.last7d?.tokens)}</span>
              <span className="usage-stat-label">Est. Cost (7d)</span>
            </div>
            <div className="usage-stat">
              <span className="usage-stat-value">{usage?.lifetimeTotals?.requests || 0}</span>
              <span className="usage-stat-label">Total Requests</span>
            </div>
            <div className="usage-stat">
              <span className="usage-stat-value">{estimateCost(usage?.lifetimeTotals?.totalTokens)}</span>
              <span className="usage-stat-label">Est. Total Cost</span>
            </div>
          </div>
        )}
      </div>

      {usage?.recentLogs?.length > 0 && (
        <div className="card">
          <h3>Recent Activity</h3>
          <div className="recent-logs">
            {usage.recentLogs.slice(0, 10).map((log, i) => (
              <div key={log.id || i} className={`log-entry ${log.success ? 'success' : 'error'}`}>
                <div className="log-model">{log.model}</div>
                <div className="log-tokens">
                  {log.totalTokens > 0 ? (
                    <><span className="token-count">{formatNumber(log.totalTokens)} tokens</span> <span className="token-cost">({estimateCost(log.totalTokens)})</span></>
                  ) : (log.errorMessage || 'No tokens')}
                </div>
                <div className="log-time">{new Date(log.timestamp).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h3>Your API Key</h3>
        <p className="card-desc">Use this key to authenticate your API requests</p>
        <div className="api-key-display">
          <code>{profile?.apiKey || 'Loading...'}</code>
          <button className="btn-icon" onClick={copyApiKey}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Quick Start</h3>
        <pre className="code-block">
{`curl -X POST "${API_URL}/v1/chat/completions" \\
  -H "Authorization: Bearer ${profile?.apiKey || 'YOUR_API_KEY'}" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "Hello!"}]}'`}
        </pre>
      </div>
    </div>
  );
}
