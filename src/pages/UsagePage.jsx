import { useState } from 'react';
import { auth } from '../firebase';
import { Zap, Shield, Activity, Key, RefreshCw } from 'lucide-react';
import StatCard from '../components/ui/StatCard';
import { formatDollars, getUsagePercent } from '../utils/format';

export default function UsagePage() {
  const [usageData, setUsageData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [keyFilter, setKeyFilter] = useState('all');
  const [expandedKeys, setExpandedKeys] = useState({});

  const loadUsage = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/puter-usage', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.error) setError(data.error);
      else setUsageData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (idx) => setExpandedKeys(prev => ({ ...prev, [idx]: !prev[idx] }));

  const filteredKeys = usageData?.keys?.filter(k => {
    if (keyFilter === 'active') return k.usage?.allowanceInfo?.remaining > 0;
    if (keyFilter === 'exhausted') return k.usage?.allowanceInfo?.remaining <= 0;
    return true;
  }) || [];

  const activeCount = usageData?.keys?.filter(k => k.usage?.allowanceInfo?.remaining > 0).length || 0;
  const exhaustedCount = usageData?.keys?.filter(k => k.usage?.allowanceInfo?.remaining <= 0).length || 0;

  return (
    <div className="tab-content">
      <div className="page-header">
        <h1>Puter Key Usage</h1>
        <button className="btn btn-primary" onClick={loadUsage} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          {loading ? 'Loading...' : 'Load Usage'}
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      {!usageData && !loading && !error && (
        <div className="card">
          <p className="card-desc" style={{ textAlign: 'center', padding: '3rem' }}>
            Click "Load Usage" to fetch usage data for your Puter keys
          </p>
        </div>
      )}

      {usageData?.message && !usageData.keys?.length && (
        <div className="card">
          <p className="card-desc" style={{ textAlign: 'center', padding: '3rem' }}>
            {usageData.message}. Add keys in "API Keys" tab.
          </p>
        </div>
      )}

      {usageData?.totals && usageData.keys?.length > 0 && (
        <>
          <div className="stats-grid">
            <StatCard icon={<Zap />} value={formatDollars(usageData.totals.used)} label="Total Used" />
            <StatCard icon={<Shield />} value={formatDollars(usageData.totals.allowance)} label="Total Allowance" />
            <StatCard 
              icon={<Activity />} 
              value={formatDollars(usageData.totals.remaining)} 
              label="Remaining"
              iconBg={usageData.totals.remaining > 0 ? 'var(--success)' : 'var(--error)'}
            />
            <StatCard icon={<Key />} value={usageData.keys.length} label="Total Keys" />
          </div>

          <div className="card">
            <div className="usage-filter-tabs">
              <button className={`filter-tab ${keyFilter === 'all' ? 'active' : ''}`} onClick={() => setKeyFilter('all')}>
                All ({usageData.keys.length})
              </button>
              <button className={`filter-tab ${keyFilter === 'active' ? 'active' : ''}`} onClick={() => setKeyFilter('active')}>
                <span className="dot green"></span> Active ({activeCount})
              </button>
              <button className={`filter-tab ${keyFilter === 'exhausted' ? 'active' : ''}`} onClick={() => setKeyFilter('exhausted')}>
                <span className="dot red"></span> Exhausted ({exhaustedCount})
              </button>
            </div>

            <div className="keys-usage-list">
              {filteredKeys.map((keyData, idx) => {
                const isExpanded = expandedKeys[idx];
                const used = keyData.usage?.usage?.total || 0;
                const allowance = keyData.usage?.allowanceInfo?.monthUsageAllowance || 0;
                const remaining = keyData.usage?.allowanceInfo?.remaining || 0;
                const percent = getUsagePercent(used, allowance);
                const isExhausted = remaining <= 0;

                return (
                  <div key={idx} className={`key-usage-item ${isExhausted ? 'exhausted' : ''}`}>
                    <div className="key-usage-header" onClick={() => toggleExpand(idx)}>
                      <div className="key-info">
                        <span className={`status-dot ${isExhausted ? 'red' : 'green'}`}></span>
                        <code className="key-preview">{keyData.preview}</code>
                        {keyData.error && <span className="error-badge">Error</span>}
                        {keyData.usage?.isTemp && <span className="warning-badge">Temp</span>}
                      </div>
                      <div className="key-stats">
                        <span className="key-used">{formatDollars(used)}</span>
                        <span className="key-separator">/</span>
                        <span className="key-allowance">{formatDollars(allowance)}</span>
                        <span className={`key-remaining ${isExhausted ? 'exhausted' : ''}`}>
                          ({formatDollars(remaining)} left)
                        </span>
                        <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
                      </div>
                    </div>
                    
                    <div className="key-progress">
                      <div className="key-progress-bar" style={{ width: `${percent}%`, background: isExhausted ? 'var(--error)' : 'var(--primary)' }} />
                    </div>

                    {isExpanded && keyData.usage?.usage && (
                      <div className="key-breakdown">
                        <div className="breakdown-header">Usage Breakdown</div>
                        <div className="breakdown-list">
                          {Object.entries(keyData.usage.usage)
                            .filter(([key]) => key !== 'total')
                            .sort((a, b) => (b[1].cost || 0) - (a[1].cost || 0))
                            .map(([service, data]) => (
                              <div key={service} className="breakdown-row">
                                <span className="breakdown-service">{service.replace(/_dot_/g, '.').replace(/:/g, ' › ')}</span>
                                <span className="breakdown-count">{data.count} calls</span>
                                <span className="breakdown-cost">{formatDollars(data.cost)}</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
