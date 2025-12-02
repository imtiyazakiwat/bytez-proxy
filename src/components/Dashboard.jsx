import React, { useState, useEffect } from 'react';
import { auth } from '../firebase';
import { 
  Key, Copy, RefreshCw, Plus, Trash2, LogOut, 
  Zap, Shield, Activity, ChevronDown, Check, X,
  Settings, BarChart3, Code, BookOpen, Image
} from 'lucide-react';
import './Dashboard.css';

// Admin user IDs
const ADMIN_USER_IDS = ['7nMmX6NJHGX2mshNOeN7Zv97lrD2'];

// Get API URL from env or fallback to window.location.origin
const API_URL = import.meta.env.VITE_API_URL || window.location.origin;

export default function Dashboard({ user, onSignOut }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [profile, setProfile] = useState(null);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const isAdmin = ADMIN_USER_IDS.includes(user.uid);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const token = await auth.currentUser.getIdToken();
      
      const [profileRes, modelsRes] = await Promise.all([
        fetch('/api/auth', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/models?format=extended')
      ]);
      
      const profileData = await profileRes.json();
      const modelsData = await modelsRes.json();
      
      setProfile(profileData);
      setModels(modelsData.models || []);
    } catch (error) {
      console.error('Load error:', error);
    } finally {
      setLoading(false);
    }
  };

  const copyApiKey = () => {
    navigator.clipboard.writeText(profile?.apiKey || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const regenerateKey = async () => {
    if (!confirm('Regenerate API key? Your old key will stop working.')) return;
    
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: 'regenerateApiKey' })
      });
      const data = await res.json();
      if (data.apiKey) {
        setProfile(prev => ({ ...prev, apiKey: data.apiKey }));
      }
    } catch (error) {
      console.error('Regenerate error:', error);
    }
  };

  if (loading) {
    return <div className="dashboard-loading">Loading...</div>;
  }

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="sidebar-header">
          <Zap size={24} />
          <span>UnifiedAI</span>
        </div>
        
        <nav className="sidebar-nav">
          <NavItem icon={<BarChart3 />} label="Overview" active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} />
          <NavItem icon={<Key />} label="API Keys" active={activeTab === 'keys'} onClick={() => setActiveTab('keys')} />
          <NavItem icon={<Activity />} label="Models" active={activeTab === 'models'} onClick={() => setActiveTab('models')} />
          <NavItem icon={<Code />} label="Playground" active={activeTab === 'playground'} onClick={() => setActiveTab('playground')} />
          <NavItem icon={<Image />} label="Images" active={activeTab === 'images'} onClick={() => setActiveTab('images')} />
          <NavItem icon={<BookOpen />} label="Docs" active={activeTab === 'docs'} onClick={() => setActiveTab('docs')} />
          {isAdmin && <NavItem icon={<Settings />} label="Admin" active={activeTab === 'admin'} onClick={() => setActiveTab('admin')} />}
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <img src={user.photoURL} alt="" className="user-avatar" />
            <div className="user-details">
              <span className="user-name">{user.displayName}</span>
              <span className="user-email">{user.email}</span>
            </div>
          </div>
          <button className="btn-icon" onClick={onSignOut} title="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="main-content">
        {activeTab === 'overview' && <OverviewTab profile={profile} copyApiKey={copyApiKey} copied={copied} />}
        {activeTab === 'keys' && <KeysTab profile={profile} setProfile={setProfile} copyApiKey={copyApiKey} copied={copied} regenerateKey={regenerateKey} />}
        {activeTab === 'models' && <ModelsTab models={models} profile={profile} />}
        {activeTab === 'playground' && <PlaygroundTab profile={profile} models={models} />}
        {activeTab === 'images' && <ImagesTab profile={profile} />}
        {activeTab === 'docs' && <DocsTab profile={profile} />}
        {activeTab === 'admin' && isAdmin && <AdminTab />}
      </main>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }) {
  return (
    <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function OverviewTab({ profile, copyApiKey, copied }) {
  const [usage, setUsage] = useState(null);
  const [loadingUsage, setLoadingUsage] = useState(true);
  const [usageError, setUsageError] = useState(null);

  useEffect(() => {
    loadUsage();
  }, []);

  const loadUsage = async () => {
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/usage', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.error) {
        setUsageError(data.error);
      } else {
        setUsage(data);
      }
    } catch (error) {
      console.error('Failed to load usage:', error);
      setUsageError(error.message);
    } finally {
      setLoadingUsage(false);
    }
  };

  // Use dailyRequestsUsed for daily limit tracking (15/day for free users)
  const dailyLimit = 15;
  const dailyUsed = usage?.dailyRequestsUsed || profile?.dailyRequestsUsed || 0;
  const dailyRemaining = Math.max(0, dailyLimit - dailyUsed);
  const dailyPercent = (dailyUsed / dailyLimit) * 100;

  const formatNumber = (num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num?.toString() || '0';
  };

  return (
    <div className="tab-content">
      <h1>Dashboard</h1>
      
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon"><Zap /></div>
          <div className="stat-info">
            <span className="stat-value">{profile?.puterKeysCount > 0 ? '∞' : dailyRemaining}</span>
            <span className="stat-label">{profile?.puterKeysCount > 0 ? 'Unlimited (Own Keys)' : `Daily Requests Left (${dailyUsed}/${dailyLimit})`}</span>
          </div>
          {!profile?.puterKeysCount && (
            <div className="stat-progress">
              <div className="progress-bar" style={{ width: `${dailyPercent}%` }} />
            </div>
          )}
        </div>
        
        <div className="stat-card">
          <div className="stat-icon" style={{ background: profile?.hasUnlimitedOpenAI ? 'var(--success)' : 'var(--bg-tertiary)' }}>
            <Shield />
          </div>
          <div className="stat-info">
            <span className="stat-value">{profile?.hasUnlimitedOpenAI ? 'Unlimited' : 'Limited'}</span>
            <span className="stat-label">OpenAI Access</span>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon" style={{ background: profile?.hasClaudeAccess ? 'var(--success)' : 'var(--bg-tertiary)' }}>
            <Activity />
          </div>
          <div className="stat-info">
            <span className="stat-value">{profile?.hasClaudeAccess ? 'Active' : 'Inactive'}</span>
            <span className="stat-label">Claude Access</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon"><BarChart3 /></div>
          <div className="stat-info">
            <span className="stat-value">{formatNumber(usage?.lifetimeTotals?.totalTokens || profile?.totalTokens || 0)}</span>
            <span className="stat-label">Total Tokens Used</span>
          </div>
        </div>
      </div>

      {/* Token Usage Stats */}
      <div className="card">
        <h3>Usage Statistics</h3>
        {loadingUsage ? (
          <p className="card-desc">Loading usage data...</p>
        ) : (
          <div className="usage-stats-grid">
            <div className="usage-stat">
              <span className="usage-stat-value">{usage?.stats?.last24h?.requests || 0}</span>
              <span className="usage-stat-label">Requests (24h)</span>
            </div>
            <div className="usage-stat">
              <span className="usage-stat-value">{formatNumber(usage?.stats?.last24h?.tokens || 0)}</span>
              <span className="usage-stat-label">Tokens (24h)</span>
            </div>
            <div className="usage-stat">
              <span className="usage-stat-value">{usage?.stats?.last7d?.requests || 0}</span>
              <span className="usage-stat-label">Requests (7d)</span>
            </div>
            <div className="usage-stat">
              <span className="usage-stat-value">{formatNumber(usage?.stats?.last7d?.tokens || 0)}</span>
              <span className="usage-stat-label">Tokens (7d)</span>
            </div>
            <div className="usage-stat">
              <span className="usage-stat-value">{usage?.lifetimeTotals?.requests || profile?.totalRequests || 0}</span>
              <span className="usage-stat-label">Total Requests</span>
            </div>
            <div className="usage-stat">
              <span className="usage-stat-value">{formatNumber(usage?.lifetimeTotals?.totalTokens || profile?.totalTokens || 0)}</span>
              <span className="usage-stat-label">Total Tokens</span>
            </div>
          </div>
        )}
      </div>

      {/* Recent Activity */}
      {usage?.recentLogs?.length > 0 && (
        <div className="card">
          <h3>Recent Activity</h3>
          <div className="recent-logs">
            {usage.recentLogs.slice(0, 10).map((log, i) => (
              <div key={log.id || i} className={`log-entry ${log.success ? 'success' : 'error'}`}>
                <div className="log-model">{log.model}</div>
                <div className="log-tokens">
                  {log.totalTokens > 0 ? `${formatNumber(log.totalTokens)} tokens` : log.errorMessage || 'No tokens'}
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
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`}
        </pre>
      </div>
    </div>
  );
}

function KeysTab({ profile, setProfile, copyApiKey, copied, regenerateKey }) {
  const [showAddKey, setShowAddKey] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState(null);

  // Auto-test and add key
  const addKey = async () => {
    if (!newKey.trim()) return;
    setSaving(true);
    setError(null);
    setTestResult({ testing: true, message: 'Testing key...' });
    
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: 'addKey', provider: 'puter', key: newKey.trim() })
      });
      
      const data = await res.json();
      if (data.error) {
        setTestResult({ valid: false, message: data.error });
        setError(data.error);
      } else {
        setTestResult({ valid: true, message: 'Key added successfully!' });
        // Reload profile to get updated keys list
        const profileRes = await fetch('/api/auth', { headers: { Authorization: `Bearer ${token}` } });
        const profileData = await profileRes.json();
        setProfile(profileData);
        setNewKey('');
        setTimeout(() => {
          setShowAddKey(false);
          setTestResult(null);
        }, 1500);
      }
    } catch (err) {
      setTestResult({ valid: false, message: err.message });
      setError(err.message);
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
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: 'removeKey', keyIndex })
      });
      
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        // Reload profile
        const profileRes = await fetch('/api/auth', { headers: { Authorization: `Bearer ${token}` } });
        const profileData = await profileRes.json();
        setProfile(profileData);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const resetForm = () => {
    setShowAddKey(false);
    setNewKey('');
    setTestResult(null);
    setError(null);
  };

  return (
    <div className="tab-content">
      <h1>API Keys</h1>
      
      <div className="card">
        <div className="card-header">
          <div>
            <h3>Your UnifiedAI Key</h3>
            <p className="card-desc">This is your personal API key for all requests</p>
          </div>
          <button className="btn btn-secondary" onClick={regenerateKey}>
            <RefreshCw size={16} />
            Regenerate
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
            <p className="card-desc">Add your own Puter keys for unlimited access to all models</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowAddKey(true)}>
            <Plus size={16} />
            Add Key
          </button>
        </div>
        
        {showAddKey && (
          <div className="add-key-section">
            <div className="add-key-form">
              <input 
                type="password" 
                placeholder="Enter your Puter API key"
                value={newKey}
                onChange={(e) => { setNewKey(e.target.value); setTestResult(null); setError(null); }}
                disabled={saving}
              />
              <button className="btn btn-primary" onClick={addKey} disabled={saving || !newKey.trim()}>
                {saving ? 'Testing & Adding...' : 'Add Key'}
              </button>
              <button className="btn btn-secondary" onClick={resetForm} disabled={saving}>
                Cancel
              </button>
            </div>
            {testResult && (
              <div className={`test-result ${testResult.testing ? 'testing' : (testResult.valid ? (testResult.warning ? 'warning' : 'success') : 'error')}`}>
                {testResult.testing ? <RefreshCw size={16} className="spin" /> : (testResult.valid ? <Check size={16} /> : <X size={16} />)}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>
        )}
        
        {/* Display user's keys */}
        {profile?.puterKeys?.length > 0 && (
          <div className="system-keys-list" style={{ marginTop: '1rem' }}>
            <p className="card-desc" style={{ marginBottom: '0.5rem' }}>Your added keys:</p>
            {profile.puterKeys.map((key) => (
              <div key={key.id} className="system-key-item">
                <code>{key.preview}</code>
                <button className="btn-icon" onClick={() => removeKey(key.id)} title="Remove key">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
        
        <div className="keys-status" style={{ marginTop: '1rem' }}>
          <span className={`status-badge ${profile?.puterKeysCount > 0 ? 'active' : ''}`}>
            {profile?.puterKeysCount || 0} keys added
          </span>
          {profile?.puterKeysCount > 0 && <span className="status-badge active">Unlimited Access</span>}
        </div>
        
        <p className="card-desc" style={{ marginTop: '1rem' }}>
          Get your Puter API key from <a href="https://puter.com" target="_blank" rel="noopener noreferrer">puter.com</a>
        </p>
      </div>
    </div>
  );
}

function ModelsTab({ models, profile }) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  
  // Get unique providers
  const providers = [...new Set(models.map(m => m.provider))];
  
  // Helper to get display name
  const getModelName = (id) => {
    if (id.startsWith('openrouter:')) {
      return id.replace('openrouter:', '').split('/').pop();
    }
    if (id.startsWith('togetherai:')) {
      return id.replace('togetherai:', '').split('/').pop();
    }
    return id;
  };
  
  const filteredModels = models.filter(m => {
    const matchesFilter = filter === 'all' || m.provider === filter;
    const matchesSearch = !search || m.id.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  return (
    <div className="tab-content">
      <h1>Available Models ({models.length})</h1>
      
      <div className="models-controls">
        <input 
          type="text" 
          placeholder="Search models..." 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="model-search"
        />
        <div className="filter-tabs">
          <button className={`filter-tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
            All ({models.length})
          </button>
          {providers.slice(0, 8).map(p => (
            <button 
              key={p}
              className={`filter-tab ${filter === p ? 'active' : ''}`} 
              onClick={() => setFilter(p)}
            >
              {p} ({models.filter(m => m.provider === p).length})
            </button>
          ))}
        </div>
      </div>

      <div className="models-table">
        <div className="table-header">
          <span>Model</span>
          <span>Provider</span>
          <span>Tier</span>
          <span>Via</span>
        </div>
        {filteredModels.slice(0, 100).map(model => (
          <div key={model.id} className="table-row">
            <div className="model-cell">
              <span className="model-name">{getModelName(model.id)}</span>
              <span className="model-id">{model.id}</span>
            </div>
            <span className={`provider-badge ${model.provider}`}>{model.provider}</span>
            <span className={`tier-badge ${model.tier}`}>{model.tier}</span>
            <span className="via-badge">{model.via}</span>
          </div>
        ))}
        {filteredModels.length > 100 && (
          <div className="table-row more-models">
            <span>... and {filteredModels.length - 100} more models</span>
          </div>
        )}
      </div>
    </div>
  );
}

function PlaygroundTab({ profile, models }) {
  // Models from API are already filtered to OpenRouter only
  const openRouterModels = models.filter(m => m.id.startsWith('openrouter:'));
  
  // Default to a reliable model
  const defaultModel = openRouterModels.find(m => m.id === 'openrouter:openai/gpt-4o')?.id 
    || openRouterModels.find(m => m.id.includes('gpt-4o'))?.id
    || openRouterModels[0]?.id 
    || 'openrouter:openai/gpt-4o';
  
  const [model, setModel] = useState(defaultModel);
  const [message, setMessage] = useState('');
  const [content, setContent] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingCollapsed, setThinkingCollapsed] = useState(false);
  const [rawJson, setRawJson] = useState('');
  const [loading, setLoading] = useState(false);
  const [stream, setStream] = useState(true);
  const [showFullJson, setShowFullJson] = useState(false);
  const [filter, setFilter] = useState('');

  // Helper to get display name from model id
  const getModelName = (id) => {
    if (id.startsWith('openrouter:')) {
      const path = id.replace('openrouter:', '');
      const parts = path.split('/');
      return parts.length > 1 ? `${parts[1]} (${parts[0]})` : path;
    }
    return id;
  };

  // Filter OpenRouter models based on search
  const filteredModels = openRouterModels.filter(m => 
    !filter || m.id.toLowerCase().includes(filter.toLowerCase())
  );

  // Popular models - specific reliable ones (including thinking models)
  const popularModelIds = [
    'openrouter:openai/gpt-4o',
    'openrouter:openai/gpt-4o-mini',
    'openrouter:anthropic/claude-3.5-sonnet',
    'openrouter:deepseek/deepseek-r1',
    'openrouter:moonshotai/kimi-k2-thinking',
    'openrouter:qwen/qwq-32b',
    'openrouter:meta-llama/llama-3.3-70b-instruct',
    'openrouter:deepseek/deepseek-chat',
  ];
  const popularModels = openRouterModels.filter(m => popularModelIds.includes(m.id));
  const otherModels = filteredModels.filter(m => !popularModelIds.includes(m.id));
  
  // Auto-select first filtered model when filter changes and current model not in results
  useEffect(() => {
    if (filter && filteredModels.length > 0 && !filteredModels.find(m => m.id === model)) {
      setModel(filteredModels[0].id);
    }
  }, [filter, filteredModels, model]);

  const sendRequest = async () => {
    if (!message.trim()) return;
    setLoading(true);
    setContent('');
    setReasoning('');
    setRawJson('');
    setIsThinking(false);
    setThinkingCollapsed(false);

    try {
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${profile?.apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: message }],
          stream
        })
      });

      if (stream) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let fullReasoning = '';
        let allChunks = [];
        let hasStartedContent = false;
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
              try {
                const data = JSON.parse(trimmedLine.slice(6));
                allChunks.push(data);
                
                // Handle error in stream
                if (data.error) {
                  setContent(`Error: ${data.error.message || data.error}`);
                  setRawJson(JSON.stringify(allChunks, null, 2));
                  return; // Exit the streaming loop
                }
                
                // Handle reasoning content (thinking)
                if (data.choices?.[0]?.delta?.reasoning_content) {
                  fullReasoning += data.choices[0].delta.reasoning_content;
                  setReasoning(fullReasoning);
                  setIsThinking(true);
                }
                
                // Handle main content
                if (data.choices?.[0]?.delta?.content) {
                  // When content starts, collapse thinking
                  if (!hasStartedContent && fullReasoning) {
                    setThinkingCollapsed(true);
                    setIsThinking(false);
                  }
                  hasStartedContent = true;
                  fullContent += data.choices[0].delta.content;
                  setContent(fullContent);
                }
                
                // Update raw JSON
                setRawJson(JSON.stringify(allChunks, null, 2));
              } catch (e) {
                console.log('Parse error:', e, 'Line:', trimmedLine);
              }
            }
          }
        }
        
        // Final state - collapse thinking if we have content
        if (fullContent && fullReasoning) {
          setThinkingCollapsed(true);
          setIsThinking(false);
        }
      } else {
        const data = await res.json();
        setRawJson(JSON.stringify(data, null, 2));
        
        // Extract content and reasoning
        const respContent = data.choices?.[0]?.message?.content || '';
        const respReasoning = data.choices?.[0]?.message?.reasoning_content;
        
        setContent(respContent || JSON.stringify(data, null, 2));
        if (respReasoning) {
          setReasoning(respReasoning);
          setThinkingCollapsed(true); // Auto-collapse for non-stream
        }
      }
    } catch (error) {
      setContent(`Error: ${error.message}`);
    } finally {
      setLoading(false);
      setIsThinking(false);
    }
  };

  return (
    <div className="tab-content">
      <h1>Playground</h1>
      
      <div className="playground-grid">
        <div className="card">
          <h3>Request</h3>
          <div className="form-group">
            <label>Model</label>
            <input 
              type="text" 
              placeholder="Search models..." 
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="model-search"
            />
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {!filter && popularModels.length > 0 && (
                <optgroup label="Popular">
                  {popularModels.map(m => (
                    <option key={m.id} value={m.id}>{getModelName(m.id)} ({m.provider})</option>
                  ))}
                </optgroup>
              )}
              <optgroup label={filter ? 'Search Results' : 'All Models'}>
                {(filter ? filteredModels : otherModels).slice(0, 100).map(m => (
                  <option key={m.id} value={m.id}>{getModelName(m.id)} ({m.provider})</option>
                ))}
              </optgroup>
            </select>
            <span className="model-count">{openRouterModels.length} OpenRouter models available</span>
          </div>
          <div className="form-group">
            <label>Message</label>
            <textarea 
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter your message..."
              rows={6}
            />
          </div>
          <div className="form-group checkbox">
            <input 
              type="checkbox" 
              id="stream" 
              checked={stream}
              onChange={(e) => setStream(e.target.checked)}
            />
            <label htmlFor="stream">Stream response</label>
          </div>
          <div className="form-group checkbox">
            <input 
              type="checkbox" 
              id="showFullJson" 
              checked={showFullJson}
              onChange={(e) => setShowFullJson(e.target.checked)}
            />
            <label htmlFor="showFullJson">Show full JSON response</label>
          </div>
          <button className="btn btn-primary" onClick={sendRequest} disabled={loading}>
            {loading ? 'Sending...' : 'Send Request'}
          </button>
        </div>

        <div className="card">
          <h3>Response {showFullJson ? '(Full JSON)' : ''}</h3>
          
          {showFullJson ? (
            <pre className="response-box">{rawJson || 'Response will appear here...'}</pre>
          ) : (
            <div className="response-container">
              {/* Thinking/Reasoning Section */}
              {(reasoning || isThinking) && (
                <div className={`thinking-section ${thinkingCollapsed ? 'collapsed' : ''}`}>
                  <div 
                    className="thinking-header" 
                    onClick={() => setThinkingCollapsed(!thinkingCollapsed)}
                  >
                    <span className="thinking-icon">{isThinking ? '⏳' : '🧠'}</span>
                    <span className="thinking-title">
                      {isThinking ? 'Thinking...' : 'Thought process'}
                    </span>
                    <span className="thinking-toggle">{thinkingCollapsed ? '▶' : '▼'}</span>
                  </div>
                  {!thinkingCollapsed && (
                    <pre className="thinking-content">{reasoning}</pre>
                  )}
                </div>
              )}
              
              {/* Main Response Content */}
              <pre className="response-box">{content || (!reasoning && !isThinking ? 'Response will appear here...' : '')}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ImagesTab({ profile }) {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('flux-schnell-free');
  const [size, setSize] = useState('1024x1024');
  const [loading, setLoading] = useState(false);
  const [generatedImage, setGeneratedImage] = useState(null);
  const [error, setError] = useState(null);
  const [inputImage, setInputImage] = useState(null);
  const [inputImagePreview, setInputImagePreview] = useState(null);
  const [imageModels, setImageModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [filter, setFilter] = useState('');

  // Fetch image models dynamically
  useEffect(() => {
    fetch('/api/images')
      .then(res => res.json())
      .then(data => {
        // Combine aliases with fetched models
        const aliases = data.aliases || [];
        const models = data.models || [];
        const combined = [...aliases, ...models.map(id => ({ 
          id, 
          name: id.split('/').pop().replace(/-/g, ' '),
          supportsEdit: id.toLowerCase().includes('gemini') && id.toLowerCase().includes('image')
        }))];
        setImageModels(combined);
      })
      .catch(console.error)
      .finally(() => setLoadingModels(false));
  }, []);

  const selectedModel = imageModels.find(m => m.id === model);
  const filteredModels = filter 
    ? imageModels.filter(m => m.id.toLowerCase().includes(filter.toLowerCase()) || m.name?.toLowerCase().includes(filter.toLowerCase()))
    : imageModels;

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setInputImage(event.target.result);
        setInputImagePreview(event.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const clearInputImage = () => {
    setInputImage(null);
    setInputImagePreview(null);
  };

  const generateImage = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setGeneratedImage(null);

    try {
      const body = { prompt, model, size };
      if (inputImage && selectedModel?.supportsEdit) {
        body.image = inputImage;
      }

      const res = await fetch('/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${profile?.apiKey}`
        },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      
      if (data.error) {
        setError(data.error.message || 'Generation failed');
      } else if (data.data && data.data[0]) {
        const imgData = data.data[0];
        if (imgData.b64_json) {
          setGeneratedImage(`data:image/png;base64,${imgData.b64_json}`);
        } else if (imgData.url) {
          setGeneratedImage(imgData.url);
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const downloadImage = () => {
    if (!generatedImage) return;
    const link = document.createElement('a');
    link.href = generatedImage;
    link.download = `generated-${Date.now()}.png`;
    link.click();
  };

  return (
    <div className="tab-content">
      <h1>Image Generation</h1>
      
      <div className="playground-grid">
        <div className="card">
          <h3>Generate Image</h3>
          
          <div className="form-group">
            <label>Model ({imageModels.length} available)</label>
            <input 
              type="text" 
              placeholder="Search models..." 
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="model-search"
            />
            <select value={model} onChange={(e) => setModel(e.target.value)} disabled={loadingModels}>
              {loadingModels ? (
                <option>Loading models...</option>
              ) : (
                filteredModels.map(m => (
                  <option key={m.id} value={m.id}>{m.name || m.id} {m.supportsEdit ? '(img2img)' : ''}</option>
                ))
              )}
            </select>
          </div>

          <div className="form-group">
            <label>Prompt</label>
            <textarea 
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the image you want to generate..."
              rows={4}
            />
          </div>

          <div className="form-group">
            <label>Size</label>
            <select value={size} onChange={(e) => setSize(e.target.value)}>
              <option value="1024x1024">1024x1024</option>
              <option value="1024x1792">1024x1792 (Portrait)</option>
              <option value="1792x1024">1792x1024 (Landscape)</option>
              <option value="512x512">512x512</option>
            </select>
          </div>

          {selectedModel?.supportsEdit && (
            <div className="form-group">
              <label>Input Image (Optional - for editing)</label>
              <div className="image-upload-area">
                {inputImagePreview ? (
                  <div className="input-image-preview">
                    <img src={inputImagePreview} alt="Input" />
                    <button className="btn btn-secondary btn-sm" onClick={clearInputImage}>
                      <X size={14} /> Remove
                    </button>
                  </div>
                ) : (
                  <label className="upload-label">
                    <input type="file" accept="image/*" onChange={handleImageUpload} hidden />
                    <span>Click to upload an image for editing</span>
                  </label>
                )}
              </div>
            </div>
          )}

          <button className="btn btn-primary" onClick={generateImage} disabled={loading || !prompt.trim()}>
            {loading ? 'Generating...' : 'Generate Image'}
          </button>
        </div>

        <div className="card">
          <h3>Result</h3>
          {error && <div className="error-message">{error}</div>}
          {loading && <div className="loading-spinner">Generating your image...</div>}
          {generatedImage && (
            <div className="generated-image-container">
              <img src={generatedImage} alt="Generated" className="generated-image" />
              <button className="btn btn-secondary" onClick={downloadImage}>
                Download Image
              </button>
            </div>
          )}
          {!generatedImage && !loading && !error && (
            <p className="placeholder-text">Your generated image will appear here</p>
          )}
        </div>
      </div>

      <div className="card">
        <h3>API Usage</h3>
        <pre className="code-block">
{`curl -X POST "${API_URL}/v1/images/generations" \\
  -H "Authorization: Bearer ${profile?.apiKey || 'YOUR_API_KEY'}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-1",
    "prompt": "A cute cat wearing a space helmet",
    "size": "1024x1024"
  }'`}
        </pre>
      </div>
    </div>
  );
}

function DocsTab({ profile }) {
  return (
    <div className="tab-content">
      <h1>Documentation</h1>
      
      <div className="card">
        <h3>API Endpoint</h3>
        <code className="endpoint">{API_URL}/v1/chat/completions</code>
      </div>

      <div className="card">
        <h3>Authentication</h3>
        <p>Include your API key in the Authorization header:</p>
        <pre className="code-block">Authorization: Bearer {profile?.apiKey || 'YOUR_API_KEY'}</pre>
      </div>

      <div className="card">
        <h3>Python Example</h3>
        <pre className="code-block">
{`from openai import OpenAI

client = OpenAI(
    api_key="${profile?.apiKey || 'YOUR_API_KEY'}",
    base_url="${API_URL}/v1"
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)

print(response.choices[0].message.content)`}
        </pre>
      </div>

      <div className="card">
        <h3>JavaScript Example</h3>
        <pre className="code-block">
{`import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: '${profile?.apiKey || 'YOUR_API_KEY'}',
  baseURL: '${API_URL}/v1'
});

const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }]
});

console.log(response.choices[0].message.content);`}
        </pre>
      </div>

      <div className="card">
        <h3>Available Chat Models</h3>
        <div className="docs-models">
          <div>
            <h4>OpenAI Models</h4>
            <ul>
              <li>gpt-4.1, gpt-4o, gpt-4o-mini</li>
              <li>o1, o1-mini, o3, o3-mini</li>
            </ul>
          </div>
          <div>
            <h4>Anthropic Models</h4>
            <ul>
              <li>claude-sonnet-4</li>
              <li>claude-3-5-sonnet, claude-3-7-sonnet</li>
              <li>claude-3-haiku</li>
            </ul>
          </div>
          <div>
            <h4>Other Models</h4>
            <ul>
              <li>deepseek-chat, deepseek-reasoner</li>
              <li>mistral-large, mistral-small</li>
              <li>gemini-*, grok-* (via OpenRouter)</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Image Generation Models</h3>
        <pre className="code-block">
{`# Image Generation API
POST ${API_URL}/v1/images/generations

{
  "model": "gpt-image-1",  // or dall-e-3, nano-banana, seedream-4, flux-schnell, etc.
  "prompt": "A beautiful sunset over mountains",
  "size": "1024x1024"
}`}
        </pre>
        <div className="docs-models" style={{ marginTop: '1rem' }}>
          <div>
            <h4>OpenAI</h4>
            <ul>
              <li>gpt-image-1, dall-e-3, dall-e-2</li>
            </ul>
          </div>
          <div>
            <h4>Google (Nano Banana)</h4>
            <ul>
              <li>nano-banana (Gemini 2.5 Flash)</li>
              <li>nano-banana-pro (Gemini 3 Pro)</li>
            </ul>
          </div>
          <div>
            <h4>Other</h4>
            <ul>
              <li>seedream-3, seedream-4 (ByteDance)</li>
              <li>flux-schnell, flux-kontext</li>
              <li>stable-diffusion-3, sdxl</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Vision (Image Input)</h3>
        <pre className="code-block">
{`# Send images to vision-capable models
POST ${API_URL}/v1/chat/completions

{
  "model": "gpt-4o",
  "messages": [{
    "role": "user",
    "content": [
      {"type": "text", "text": "What's in this image?"},
      {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
    ]
  }]
}`}
        </pre>
        <p className="note" style={{ marginTop: '0.5rem' }}>Vision works with GPT-4o, Claude, Gemini, and other multimodal models.</p>
      </div>

      <p className="note" style={{ marginTop: '1rem' }}>15 free requests/day. Add your own Puter key for unlimited access.</p>
    </div>
  );
}

function AdminTab() {
  const [adminData, setAdminData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadAdminData();
  }, []);

  const loadAdminData = async () => {
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/admin', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setAdminData(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Auto-test and add key
  const addSystemKey = async () => {
    if (!newKey.trim()) return;
    setSaving(true);
    setError(null);
    setTestResult({ testing: true, message: 'Testing key...' });
    
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: 'addSystemKey', key: newKey.trim() })
      });
      
      const data = await res.json();
      if (data.error) {
        setTestResult({ valid: false, message: data.error });
        setError(data.error);
      } else {
        setTestResult({ valid: true, message: data.warning ? 'Key added (with usage limits)' : 'Key added successfully!' });
        setNewKey('');
        loadAdminData();
        setTimeout(() => setTestResult(null), 2000);
      }
    } catch (err) {
      setTestResult({ valid: false, message: err.message });
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const removeSystemKey = async (keyIndex) => {
    if (!confirm('Remove this system key?')) return;
    
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/admin', {
        method: 'DELETE',
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ keyIndex })
      });
      
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        loadAdminData();
      }
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) {
    return <div className="tab-content"><p>Loading admin data...</p></div>;
  }

  if (error && !adminData) {
    return <div className="tab-content"><p className="error">Error: {error}</p></div>;
  }

  return (
    <div className="tab-content">
      <h1>Admin Panel</h1>
      
      {error && <div className="card error-card"><p>{error}</p></div>}
      
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon"><Activity /></div>
          <div className="stat-info">
            <span className="stat-value">{adminData?.totalUsers || 0}</span>
            <span className="stat-label">Total Users</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><Key /></div>
          <div className="stat-info">
            <span className="stat-value">{adminData?.systemKeysCount || 0}</span>
            <span className="stat-label">System Puter Keys</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><Zap /></div>
          <div className="stat-info">
            <span className="stat-value">{adminData?.dailyFreeLimit || 15}</span>
            <span className="stat-label">Daily Free Limit</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h3>System Puter API Keys</h3>
            <p className="card-desc">These keys are used for free tier users. Add multiple keys for rotation.</p>
          </div>
        </div>
        
        <div className="add-key-section">
          <div className="add-key-form">
            <input 
              type="password" 
              placeholder="Enter new Puter API key"
              value={newKey}
              onChange={(e) => { setNewKey(e.target.value); setTestResult(null); setError(null); }}
              disabled={saving}
            />
            <button className="btn btn-primary" onClick={addSystemKey} disabled={saving || !newKey.trim()}>
              <Plus size={16} />
              {saving ? 'Testing & Adding...' : 'Add Key'}
            </button>
          </div>
          {testResult && (
            <div className={`test-result ${testResult.testing ? 'testing' : (testResult.valid ? (testResult.warning ? 'warning' : 'success') : 'error')}`}>
              {testResult.testing ? <RefreshCw size={16} className="spin" /> : (testResult.valid ? <Check size={16} /> : <X size={16} />)}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>
        
        {adminData?.systemKeys?.length > 0 ? (
          <div className="system-keys-list">
            {adminData.systemKeys.map((key, index) => (
              <div key={index} className="system-key-item">
                <code>{key.preview}</code>
                <span className="key-date">{key.addedAt ? new Date(key.addedAt).toLocaleDateString() : 'Unknown'}</span>
                <button className="btn-icon" onClick={() => removeSystemKey(key.id)} title="Remove key">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="card-desc">No system keys configured. Add keys to enable free tier.</p>
        )}
      </div>
    </div>
  );
}
