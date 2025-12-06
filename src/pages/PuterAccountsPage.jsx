import { useState, useEffect, useRef } from 'react';
import { auth } from '../firebase';
import { Plus, Copy, Check, RefreshCw, X, Trash2, AlertTriangle, Smartphone } from 'lucide-react';
import { formatDollars } from '../utils/format';

// Generate unique random string for email prefix
const generateUniquePrefix = () => {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 8);
  return `${timestamp}${randomPart}`;
};

export default function PuterAccountsPage({ profile, setProfile }) {
  const [generatedEmail, setGeneratedEmail] = useState('');
  const [signUpStatus, setSignUpStatus] = useState(null); // null, 'ready', 'signing', 'success', 'error'
  const [extractedToken, setExtractedToken] = useState('');
  const [extractedUsername, setExtractedUsername] = useState('');
  const [keyUsage, setKeyUsage] = useState(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const puterScriptLoaded = useRef(false);

  // Load Puter.js script
  useEffect(() => {
    if (!puterScriptLoaded.current && !window.puter) {
      const script = document.createElement('script');
      script.src = 'https://js.puter.com/v2/';
      script.async = true;
      script.onload = () => {
        puterScriptLoaded.current = true;
      };
      document.head.appendChild(script);
    } else {
      puterScriptLoaded.current = true;
    }
  }, []);

  const generateNewEmail = () => {
    const prefix = generateUniquePrefix();
    const email = `${prefix}@imtiyazakiwat.info`;
    setGeneratedEmail(email);
    setSignUpStatus('ready');
    setExtractedToken('');
    setExtractedUsername('');
    setKeyUsage(null);
    setTestResult(null);
  };

  const handlePuterSignUp = async () => {
    if (!window.puter) {
      setTestResult({ valid: false, message: 'Puter.js not loaded yet. Please wait and try again.' });
      return;
    }

    setSignUpStatus('signing');
    setTestResult({ testing: true, message: 'Opening Puter sign-up popup...' });

    try {
      const user = await window.puter.auth.signIn();
      
      // Extract token from the response
      if (user && user.token) {
        setExtractedToken(user.token);
        setExtractedUsername(user.username || 'Unknown');
        setSignUpStatus('success');
        setTestResult({ valid: true, message: `Account created! Username: ${user.username}` });
        
        // Auto-check the key usage
        await checkKeyUsage(user.token);
      } else {
        setSignUpStatus('error');
        setTestResult({ valid: false, message: 'Sign-up completed but no token received.' });
      }
    } catch (error) {
      setSignUpStatus('error');
      setTestResult({ valid: false, message: error.message || 'Sign-up failed or was cancelled.' });
    }
  };

  const checkKeyUsage = async (token) => {
    if (!token) return;
    setChecking(true);
    
    try {
      const authToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'checkKey', key: token })
      });
      const data = await res.json();
      if (data.usage) {
        setKeyUsage(data.usage);
      }
    } catch (err) {
      console.error('Error checking key:', err);
    } finally {
      setChecking(false);
    }
  };

  const addKeyToBudget = async () => {
    if (!extractedToken) return;
    setSaving(true);
    setTestResult({ testing: true, message: 'Adding key to your budget...' });
    
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addKey', provider: 'puter', key: extractedToken })
      });
      const data = await res.json();
      if (data.error) {
        setTestResult({ valid: false, message: data.error });
      } else {
        setTestResult({ valid: true, message: 'Key added to your budget!' });
        // Refresh profile
        const profileRes = await fetch('/api/auth', { headers: { Authorization: `Bearer ${token}` } });
        setProfile(await profileRes.json());
        // Reset form after success
        setTimeout(() => {
          setGeneratedEmail('');
          setExtractedToken('');
          setExtractedUsername('');
          setKeyUsage(null);
          setSignUpStatus(null);
          setTestResult(null);
        }, 2000);
      }
    } catch (err) {
      setTestResult({ valid: false, message: err.message });
    } finally {
      setSaving(false);
    }
  };

  const clearLocalStorage = () => {
    if (confirm('This will clear Puter localStorage data. Continue?')) {
      // Clear puter-related localStorage items
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('puter') || key.includes('Puter'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      setTestResult({ valid: true, message: `Cleared ${keysToRemove.length} Puter localStorage items.` });
      setTimeout(() => setTestResult(null), 3000);
    }
  };

  const copyToken = () => {
    navigator.clipboard.writeText(extractedToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const resetForm = () => {
    setGeneratedEmail('');
    setExtractedToken('');
    setExtractedUsername('');
    setKeyUsage(null);
    setSignUpStatus(null);
    setTestResult(null);
  };

  return (
    <div className="tab-content">
      <div className="page-header">
        <h1>Create Puter Account</h1>
        <button className="btn btn-secondary" onClick={clearLocalStorage}>
          <Trash2 size={16} /> Clear Puter Cache
        </button>
      </div>

      {/* Instructions Card */}
      <div className="card" style={{ background: 'rgba(245, 158, 11, 0.1)', borderColor: 'rgba(245, 158, 11, 0.3)' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
          <AlertTriangle size={20} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: '2px' }} />
          <div>
            <h3 style={{ marginBottom: '0.5rem', color: 'var(--warning)' }}>Important Instructions</h3>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6 }}>
              <li>If you get "Not allowed to sign up" error, switch to <strong>mobile data</strong></li>
              <li>Toggle <Smartphone size={14} style={{ verticalAlign: 'middle' }} /> <strong>Airplane mode ON and OFF</strong> to get a new IP</li>
              <li>Then try signing up again</li>
              <li>Use the "Clear Puter Cache" button if you face issues</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Create Account Card */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3>Generate New Account</h3>
            <p className="card-desc">Create a new Puter account with a unique email</p>
          </div>
          {!generatedEmail && (
            <button className="btn btn-primary" onClick={generateNewEmail}>
              <Plus size={16} /> Generate Email
            </button>
          )}
        </div>

        {generatedEmail && (
          <div className="add-key-section">
            {/* Generated Email Display */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', display: 'block' }}>
                Generated Email (use this to sign up):
              </label>
              <div className="api-key-display">
                <code>{generatedEmail}</code>
                <button className="btn-icon" onClick={() => { navigator.clipboard.writeText(generatedEmail); }}>
                  <Copy size={16} />
                </button>
              </div>
            </div>

            {/* Sign Up Button */}
            {signUpStatus !== 'success' && (
              <div className="add-key-form">
                <button 
                  className="btn btn-primary" 
                  onClick={handlePuterSignUp}
                  disabled={signUpStatus === 'signing'}
                  style={{ flex: 1 }}
                >
                  {signUpStatus === 'signing' ? (
                    <><RefreshCw size={16} className="spin" /> Signing up...</>
                  ) : (
                    <><Plus size={16} /> Sign Up with Puter</>
                  )}
                </button>
                <button className="btn btn-ghost" onClick={resetForm}>
                  Cancel
                </button>
              </div>
            )}

            {/* Test Result */}
            {testResult && (
              <div className={`test-result ${testResult.testing ? 'testing' : (testResult.valid ? 'success' : 'error')}`}>
                {testResult.testing ? <RefreshCw size={16} className="spin" /> : (testResult.valid ? <Check size={16} /> : <X size={16} />)}
                <span>{testResult.message}</span>
              </div>
            )}

            {/* Extracted Token Display */}
            {extractedToken && (
              <div style={{ marginTop: '1rem' }}>
                <label style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', display: 'block' }}>
                  Extracted Token:
                </label>
                <div className="api-key-display">
                  <code style={{ fontSize: '0.75rem' }}>{extractedToken.substring(0, 50)}...</code>
                  <button className="btn-icon" onClick={copyToken}>
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
              </div>
            )}

            {/* Key Usage Info */}
            {keyUsage && (
              <div className="key-usage-info">
                <div className="key-usage-row">
                  <span>{keyUsage.isTemp ? '⚠️ Temp User' : '✓ ' + (extractedUsername || keyUsage.username)}</span>
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
                    <span className={`value ${keyUsage.remaining <= 0 ? 'exhausted' : ''}`}>
                      {formatDollars(keyUsage.remaining)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Add to Budget Button */}
            {extractedToken && (
              <div style={{ marginTop: '1rem' }}>
                <button 
                  className="btn btn-primary" 
                  onClick={addKeyToBudget}
                  disabled={saving || checking}
                  style={{ width: '100%' }}
                >
                  {saving ? (
                    <><RefreshCw size={16} className="spin" /> Adding...</>
                  ) : (
                    <><Plus size={16} /> Add to My Budget</>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Current Keys Status */}
      <div className="card">
        <h3>Your Puter Keys</h3>
        <p className="card-desc">Keys currently added to your budget</p>
        <div className="keys-status" style={{ marginTop: '1rem' }}>
          <span className={`status-badge ${profile?.puterKeysCount > 0 ? 'active' : ''}`}>
            {profile?.puterKeysCount || 0} keys
          </span>
          {profile?.puterKeysCount > 0 && <span className="status-badge active">Unlimited Access</span>}
        </div>
      </div>
    </div>
  );
}
