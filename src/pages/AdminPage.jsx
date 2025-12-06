import { useState, useEffect } from 'react';
import { auth } from '../firebase';
import { Activity, Key, Zap, Plus, Trash2, RefreshCw, Check, X, Shield, Eye, Copy } from 'lucide-react';
import StatCard from '../components/ui/StatCard';
import { formatDollars, getUsagePercent } from '../utils/format';

export default function AdminPage() {
  const [adminData, setAdminData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [keyUsage, setKeyUsage] = useState(null);
  const [error, setError] = useState(null);
  const [systemUsage, setSystemUsage] = useState(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState({});
  const [viewingKey, setViewingKey] = useState(null);
  const [fullKey, setFullKey] = useState('');

  useEffect(() => { loadAdminData(); }, []);

  const viewKey = async (keyIndex) => {
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getFullKey', keyIndex })
      });
      const data = await res.json();
      if (data.key) {
        setFullKey(data.key);
        setViewingKey(keyIndex);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const copyFullKey = () => {
    navigator.clipboard.writeText(fullKey);
  };

  const loadAdminData = async () => {
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/admin', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.error) setError(data.error);
      else setAdminData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const checkKey = async () => {
    if (!newKey.trim()) return;
    setChecking(true);
    setTestResult({ testing: true, message: 'Checking...' });
    setKeyUsage(null);
    
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'checkKey', key: newKey.trim() })
      });
      const data = await res.json();
      if (data.error) {
        setTestResult({ valid: false, message: data.error });
      } else {
        const alreadyAddedMsg = data.isAlreadyAdded ? ' (Already added)' : '';
        setTestResult({ 
          valid: true, 
          message: (data.message || 'Key is valid!') + alreadyAddedMsg,
          isAlreadyAdded: data.isAlreadyAdded
        });
        if (data.usage) setKeyUsage(data.usage);
      }
    } catch (err) {
      setTestResult({ valid: false, message: err.message });
    } finally {
      setChecking(false);
    }
  };

  const addSystemKey = async () => {
    if (!newKey.trim()) return;
    setSaving(true);
    setError(null);
    setTestResult({ testing: true, message: 'Adding...' });
    
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addSystemKey', key: newKey.trim() })
      });
      const data = await res.json();
      if (data.error) {
        setTestResult({ valid: false, message: data.error });
        setError(data.error);
      } else {
        setTestResult({ valid: true, message: 'Added!' });
        setNewKey('');
        setKeyUsage(null);
        loadAdminData();
        setTimeout(() => setTestResult(null), 2000);
      }
    } catch (err) {
      setTestResult({ valid: false, message: err.message });
    } finally {
      setSaving(false);
    }
  };

  const removeSystemKey = async (keyIndex) => {
    if (!confirm('Remove key?')) return;
    try {
      const token = await auth.currentUser.getIdToken();
      await fetch('/api/admin', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyIndex })
      });
      loadAdminData();
      setSystemUsage(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadSystemUsage = async () => {
    setLoadingUsage(true);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getSystemKeysUsage' })
      });
      const data = await res.json();
      if (!data.error) setSystemUsage(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingUsage(false);
    }
  };

  const toggleExpand = (idx) => setExpandedKeys(prev => ({ ...prev, [idx]: !prev[idx] }));

  if (loading) return <div className="tab-content"><p>Loading...</p></div>;
  if (error && !adminData) return <div className="tab-content"><p className="error">Error: {error}</p></div>;

  return (
    <div className="tab-content">
      <h1>Admin Panel</h1>
      
      {error && <div className="card error-card"><p>{error}</p></div>}
      
      <div className="stats-grid">
        <StatCard icon={<Activity />} value={adminData?.totalUsers || 0} label="Total Users" />
        <StatCard icon={<Key />} value={adminData?.systemKeysCount || 0} label="System Keys" />
        <StatCard icon={<Zap />} value={adminData?.dailyFreeLimit || 15} label="Daily Limit" />
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h3>System Puter Keys</h3>
            <p className="card-desc">Keys for free tier users</p>
          </div>
        </div>
        
        <div className="add-key-section">
          <div className="add-key-form">
            <input 
              type="password" 
              placeholder="Enter Puter API key"
              value={newKey}
              onChange={(e) => { setNewKey(e.target.value); setTestResult(null); setKeyUsage(null); }}
              disabled={saving || checking}
            />
            <button className="btn btn-secondary" onClick={checkKey} disabled={saving || checking || !newKey.trim()}>
              {checking ? 'Checking...' : 'Check Key'}
            </button>
            <button className="btn btn-primary" onClick={addSystemKey} disabled={saving || checking || !newKey.trim()}>
              <Plus size={16} /> {saving ? 'Adding...' : 'Add'}
            </button>
          </div>
          
          {testResult && (
            <div className={`test-result ${testResult.testing ? 'testing' : (testResult.valid ? (testResult.isAlreadyAdded ? 'warning' : 'success') : 'error')}`}>
              {testResult.testing ? <RefreshCw size={16} className="spin" /> : (testResult.valid ? <Check size={16} /> : <X size={16} />)}
              <span>{testResult.message}</span>
            </div>
          )}
          
          {keyUsage && (
            <div className="key-usage-info">
              <div className="key-usage-row">
                <span>{keyUsage.isTemp ? '⚠️ Temp User' : '✓ ' + keyUsage.username}</span>
              </div>
              <div className="key-usage-stats">
                <div className="key-usage-stat">
                  <span className="label">Used</span>
                  <span className="value">{formatDollars(keyUsage.used)}</span>
                </div>
                <div className="key-usage-stat">
                  <span className="label">Allowance</span>
                  <span className="value">{formatDollars(keyUsage.allowance)}</span>
                </div>
                <div className="key-usage-stat">
                  <span className="label">Remaining</span>
                  <span className={`value ${keyUsage.remaining <= 0 ? 'exhausted' : ''}`}>{formatDollars(keyUsage.remaining)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
        
        {adminData?.systemKeys?.length > 0 ? (
          <div className="system-keys-list">
            {adminData.systemKeys.map((key, index) => (
              <div key={index} className="system-key-item">
                <code>{viewingKey === key.id ? fullKey : key.preview}</code>
                <span className="key-date">{key.addedAt ? new Date(key.addedAt).toLocaleDateString() : ''}</span>
                <button className="btn-icon" onClick={() => viewingKey === key.id ? setViewingKey(null) : viewKey(key.id)} title={viewingKey === key.id ? 'Hide' : 'View'}>
                  <Eye size={16} />
                </button>
                {viewingKey === key.id && (
                  <button className="btn-icon" onClick={copyFullKey} title="Copy">
                    <Copy size={16} />
                  </button>
                )}
                <button className="btn-icon" onClick={() => removeSystemKey(key.id)} title="Remove">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="card-desc">No keys configured.</p>
        )}
      </div>

      {/* System Keys Usage */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3>System Keys Usage</h3>
            <p className="card-desc">Monitor usage of all system Puter keys</p>
          </div>
          <button className="btn btn-primary" onClick={loadSystemUsage} disabled={loadingUsage}>
            <RefreshCw size={16} className={loadingUsage ? 'spin' : ''} />
            {loadingUsage ? 'Loading...' : 'Load Usage'}
          </button>
        </div>

        {!systemUsage && !loadingUsage && (
          <p className="card-desc" style={{ textAlign: 'center', padding: '2rem' }}>
            Click "Load Usage" to fetch usage data
          </p>
        )}

        {systemUsage?.totals && (
          <>
            <div className="stats-grid" style={{ marginTop: '1rem' }}>
              <StatCard icon={<Zap />} value={formatDollars(systemUsage.totals.used)} label="Total Used" />
              <StatCard icon={<Shield />} value={formatDollars(systemUsage.totals.allowance)} label="Total Allowance" />
              <StatCard 
                icon={<Activity />} 
                value={formatDollars(systemUsage.totals.remaining)} 
                label="Total Remaining"
                iconBg={systemUsage.totals.remaining > 0 ? 'var(--success)' : 'var(--error)'}
              />
            </div>

            <div className="keys-usage-list" style={{ marginTop: '1rem' }}>
              {systemUsage.keys.map((keyData, idx) => {
                const isExpanded = expandedKeys[idx];
                const used = keyData.usage?.used || 0;
                const allowance = keyData.usage?.allowance || 0;
                const remaining = keyData.usage?.remaining || 0;
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
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
