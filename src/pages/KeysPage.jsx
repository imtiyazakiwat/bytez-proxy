import { useState } from 'react';
import { auth } from '../firebase';
import { Copy, RefreshCw, Plus, Trash2, Check, X, Eye, ChevronLeft, ChevronRight, UserPlus } from 'lucide-react';
import { formatDollars } from '../utils/format';

const KEYS_PER_PAGE = 5;

export default function KeysPage({ profile, setProfile, copyApiKey, copied, regenerateKey }) {
  const [showAddKey, setShowAddKey] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [keyUsage, setKeyUsage] = useState(null);
  const [viewingKey, setViewingKey] = useState(null);
  const [fullKey, setFullKey] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const viewKey = async (keyIndex) => {
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/auth', {
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

  const resetForm = () => {
    setShowAddKey(false);
    setNewKey('');
    setTestResult(null);
    setKeyUsage(null);
  };

  const checkKey = async () => {
    if (!newKey.trim()) return;
    setChecking(true);
    setTestResult({ testing: true, message: 'Checking key...' });
    setKeyUsage(null);
    
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/auth', {
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

  const addKey = async () => {
    if (!newKey.trim()) return;
    setSaving(true);
    setTestResult({ testing: true, message: 'Adding key...' });
    
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addKey', provider: 'puter', key: newKey.trim() })
      });
      const data = await res.json();
      if (data.error) {
        setTestResult({ valid: false, message: data.error });
      } else {
        setTestResult({ valid: true, message: 'Key added!' });
        if (data.usage) setKeyUsage(data.usage);
        const profileRes = await fetch('/api/auth', { headers: { Authorization: `Bearer ${token}` } });
        setProfile(await profileRes.json());
        setNewKey('');
        setTimeout(resetForm, 2000);
      }
    } catch (err) {
      setTestResult({ valid: false, message: err.message });
    } finally {
      setSaving(false);
    }
  };

  const removeKey = async (keyIndex) => {
    if (!confirm('Remove this Puter key?')) return;
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'removeKey', keyIndex })
      });
      if (!(await res.json()).error) {
        const profileRes = await fetch('/api/auth', { headers: { Authorization: `Bearer ${token}` } });
        setProfile(await profileRes.json());
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="tab-content">
      <h1>API Keys</h1>
      
      <div className="card">
        <div className="card-header">
          <div>
            <h3>Your UnifiedAI Key</h3>
            <p className="card-desc">Personal API key for all requests</p>
          </div>
          <button className="btn btn-secondary" onClick={regenerateKey}>
            <RefreshCw size={16} /> Regenerate
          </button>
        </div>
        <div className="api-key-display">
          <code>{profile?.apiKey || 'Loading...'}</code>
          <button className="btn-icon" onClick={copyApiKey}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h3>Puter API Keys</h3>
            <p className="card-desc">Add your own keys for unlimited access</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowAddKey(true)}>
            <Plus size={16} /> Add Key
          </button>
        </div>
        
        {showAddKey && (
          <div className="add-key-section">
            <div className="add-key-form">
              <input 
                type="password" 
                placeholder="Enter your Puter API key"
                value={newKey}
                onChange={(e) => { setNewKey(e.target.value); setTestResult(null); setKeyUsage(null); }}
                disabled={saving || checking}
              />
              <button className="btn btn-secondary" onClick={checkKey} disabled={saving || checking || !newKey.trim()}>
                {checking ? 'Checking...' : 'Check Key'}
              </button>
              <button className="btn btn-primary" onClick={addKey} disabled={saving || checking || !newKey.trim()}>
                {saving ? 'Adding...' : 'Add Key'}
              </button>
              <button className="btn btn-ghost" onClick={resetForm} disabled={saving || checking}>
                Cancel
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
        )}
        
        {profile?.puterKeys?.length > 0 && (() => {
          const totalKeys = profile.puterKeys.length;
          const totalPages = Math.ceil(totalKeys / KEYS_PER_PAGE);
          const startIndex = (currentPage - 1) * KEYS_PER_PAGE;
          const paginatedKeys = profile.puterKeys.slice(startIndex, startIndex + KEYS_PER_PAGE);
          
          return (
            <div className="system-keys-list" style={{ marginTop: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <p className="card-desc" style={{ margin: 0 }}>Your keys ({totalKeys}):</p>
                {totalPages > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <button 
                      className="btn-icon" 
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      title="Previous"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {currentPage} / {totalPages}
                    </span>
                    <button 
                      className="btn-icon" 
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      title="Next"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                )}
              </div>
              {paginatedKeys.map((key) => (
                <div key={key.id} className="system-key-item">
                  <code className={viewingKey === key.id ? 'full-key' : ''}>{viewingKey === key.id ? fullKey : key.preview}</code>
                  <button className="btn-icon" onClick={() => viewingKey === key.id ? setViewingKey(null) : viewKey(key.id)} title={viewingKey === key.id ? 'Hide' : 'View'}>
                    <Eye size={16} />
                  </button>
                  {viewingKey === key.id && (
                    <button className="btn-icon" onClick={copyFullKey} title="Copy">
                      <Copy size={16} />
                    </button>
                  )}
                  <button className="btn-icon" onClick={() => removeKey(key.id)} title="Remove">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          );
        })()}
        
        <div className="keys-status" style={{ marginTop: '1rem' }}>
          <span className={`status-badge ${profile?.puterKeysCount > 0 ? 'active' : ''}`}>
            {profile?.puterKeysCount || 0} keys
          </span>
          {profile?.puterKeysCount > 0 && <span className="status-badge active">Unlimited</span>}
        </div>
        
        <p className="card-desc" style={{ marginTop: '1rem' }}>
          <a href="#puter-accounts" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: 'var(--accent)' }}>
            <UserPlus size={14} /> Create Account
          </a> to get new Puter keys
        </p>
      </div>
    </div>
  );
}
