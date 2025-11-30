import React, { useState, useEffect } from 'react';
import { auth } from '../firebase';
import { 
  Key, Copy, RefreshCw, Plus, Trash2, LogOut, 
  Zap, Shield, Activity, ChevronDown, Check, X,
  Settings, BarChart3, Code, BookOpen
} from 'lucide-react';
import './Dashboard.css';

export default function Dashboard({ user, onSignOut }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [profile, setProfile] = useState(null);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

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
          <NavItem icon={<BookOpen />} label="Docs" active={activeTab === 'docs'} onClick={() => setActiveTab('docs')} />
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
        {activeTab === 'docs' && <DocsTab profile={profile} />}
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
  const freeRemaining = (profile?.freeRequestsLimit || 20) - (profile?.freeRequestsUsed || 0);
  const freePercent = ((profile?.freeRequestsUsed || 0) / (profile?.freeRequestsLimit || 20)) * 100;

  return (
    <div className="tab-content">
      <h1>Dashboard</h1>
      
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon"><Zap /></div>
          <div className="stat-info">
            <span className="stat-value">{freeRemaining}</span>
            <span className="stat-label">Free Requests Left</span>
          </div>
          <div className="stat-progress">
            <div className="progress-bar" style={{ width: `${freePercent}%` }} />
          </div>
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
      </div>

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
{`curl -X POST "${window.location.origin}/v1/chat/completions" \\
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
  const [showAddKey, setShowAddKey] = useState(null);
  const [newKey, setNewKey] = useState('');
  const [saving, setSaving] = useState(false);

  const addKey = async (provider) => {
    if (!newKey.trim()) return;
    setSaving(true);
    
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: 'addKey', provider, key: newKey.trim() })
      });
      
      if (res.ok) {
        const field = provider === 'bytez' ? 'bytezKeysCount' : 'puterKeysCount';
        const unlimitedField = provider === 'bytez' ? 'hasUnlimitedOpenAI' : 'hasClaudeAccess';
        setProfile(prev => ({ 
          ...prev, 
          [field]: (prev[field] || 0) + 1,
          [unlimitedField]: true
        }));
        setNewKey('');
        setShowAddKey(null);
      }
    } catch (error) {
      console.error('Add key error:', error);
    } finally {
      setSaving(false);
    }
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
            <h3>Bytez API Keys</h3>
            <p className="card-desc">Add your Bytez keys for unlimited OpenAI model access</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowAddKey('bytez')}>
            <Plus size={16} />
            Add Key
          </button>
        </div>
        
        {showAddKey === 'bytez' && (
          <div className="add-key-form">
            <input 
              type="password" 
              placeholder="Enter your Bytez API key"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
            />
            <button className="btn btn-primary" onClick={() => addKey('bytez')} disabled={saving}>
              {saving ? 'Adding...' : 'Add'}
            </button>
            <button className="btn btn-secondary" onClick={() => { setShowAddKey(null); setNewKey(''); }}>
              Cancel
            </button>
          </div>
        )}
        
        <div className="keys-status">
          <span className={`status-badge ${profile?.bytezKeysCount > 0 ? 'active' : ''}`}>
            {profile?.bytezKeysCount || 0} keys added
          </span>
          {profile?.hasUnlimitedOpenAI && <span className="status-badge active">Unlimited Access</span>}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h3>Puter API Keys</h3>
            <p className="card-desc">Add your Puter keys to access Claude models</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowAddKey('puter')}>
            <Plus size={16} />
            Add Key
          </button>
        </div>
        
        {showAddKey === 'puter' && (
          <div className="add-key-form">
            <input 
              type="password" 
              placeholder="Enter your Puter API key"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
            />
            <button className="btn btn-primary" onClick={() => addKey('puter')} disabled={saving}>
              {saving ? 'Adding...' : 'Add'}
            </button>
            <button className="btn btn-secondary" onClick={() => { setShowAddKey(null); setNewKey(''); }}>
              Cancel
            </button>
          </div>
        )}
        
        <div className="keys-status">
          <span className={`status-badge ${profile?.puterKeysCount > 0 ? 'active' : ''}`}>
            {profile?.puterKeysCount || 0} keys added
          </span>
          {profile?.hasClaudeAccess && <span className="status-badge active">Claude Access Active</span>}
        </div>
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
  const [model, setModel] = useState('gpt-4o');
  const [message, setMessage] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [stream, setStream] = useState(true);
  const [filter, setFilter] = useState('');

  // Helper to get display name from model id
  const getModelName = (id) => {
    if (id.startsWith('openrouter:')) {
      return id.replace('openrouter:', '').split('/').pop();
    }
    if (id.startsWith('togetherai:')) {
      return id.replace('togetherai:', '').split('/').pop();
    }
    return id;
  };

  // Filter models based on search
  const filteredModels = models.filter(m => 
    !filter || m.id.toLowerCase().includes(filter.toLowerCase())
  );

  // Group popular models at top
  const popularIds = ['gpt-5.1', 'gpt-4o', 'claude-sonnet-4', 'gemini-2.5-flash', 'deepseek-chat', 'grok-3'];
  const popularModels = models.filter(m => popularIds.includes(m.id));
  const otherModels = filteredModels.filter(m => !popularIds.includes(m.id));

  const sendRequest = async () => {
    if (!message.trim()) return;
    setLoading(true);
    setResponse('');

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

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.choices?.[0]?.delta?.content) {
                  fullContent += data.choices[0].delta.content;
                  setResponse(fullContent);
                }
              } catch {}
            }
          }
        }
      } else {
        const data = await res.json();
        setResponse(JSON.stringify(data, null, 2));
      }
    } catch (error) {
      setResponse(`Error: ${error.message}`);
    } finally {
      setLoading(false);
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
            <span className="model-count">{models.length} models available</span>
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
          <button className="btn btn-primary" onClick={sendRequest} disabled={loading}>
            {loading ? 'Sending...' : 'Send Request'}
          </button>
        </div>

        <div className="card">
          <h3>Response</h3>
          <pre className="response-box">{response || 'Response will appear here...'}</pre>
        </div>
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
        <code className="endpoint">{window.location.origin}/v1/chat/completions</code>
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
    base_url="${window.location.origin}/v1"
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
  baseURL: '${window.location.origin}/v1'
});

const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }]
});

console.log(response.choices[0].message.content);`}
        </pre>
      </div>

      <div className="card">
        <h3>Available Models</h3>
        <div className="docs-models">
          <div>
            <h4>OpenAI (via Bytez)</h4>
            <ul>
              <li>gpt-5, gpt-5.1, gpt-4.1</li>
              <li>gpt-4o, gpt-4o-mini</li>
              <li>o1, o1-mini</li>
            </ul>
            <p className="note">20 free requests, then add Bytez key for unlimited</p>
          </div>
          <div>
            <h4>Anthropic (via Puter)</h4>
            <ul>
              <li>claude-opus-4-5, claude-sonnet-4-5</li>
              <li>claude-sonnet-4, claude-opus-4</li>
              <li>claude-haiku-4-5, claude-3-haiku</li>
            </ul>
            <p className="note">Requires Puter API key</p>
          </div>
        </div>
      </div>
    </div>
  );
}
