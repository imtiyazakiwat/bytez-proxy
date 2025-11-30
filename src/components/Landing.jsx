import React, { useState, useEffect } from 'react';
import { Zap, Shield, Key, ArrowRight, Sparkles, Globe, Code } from 'lucide-react';
import './Landing.css';

export default function Landing({ onSignIn }) {
  const [models, setModels] = useState([]);

  useEffect(() => {
    fetch('/api/models?format=extended')
      .then(res => res.json())
      .then(data => setModels(data.models || []))
      .catch(() => {});
  }, []);

  return (
    <div className="landing">
      <nav className="nav">
        <div className="nav-content container">
          <div className="logo">
            <Sparkles size={24} />
            <span>UnifiedAI</span>
          </div>
          <button className="btn btn-primary" onClick={onSignIn}>
            Sign In
          </button>
        </div>
      </nav>

      <header className="hero">
        <div className="hero-bg" />
        <div className="container hero-content">
          <div className="badge">
            <Zap size={14} />
            <span>15 Free Requests/Day</span>
          </div>
          <h1>One API Key.<br />All AI Models.</h1>
          <p className="hero-subtitle">
            Access GPT-5, Claude Opus, and more through a single OpenAI-compatible endpoint.
            No complex setup. Just plug and play.
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary btn-lg" onClick={onSignIn}>
              Get Started Free
              <ArrowRight size={18} />
            </button>
            <a href="#models" className="btn btn-secondary btn-lg">
              View Models
            </a>
          </div>
          <div className="hero-stats">
            <div className="stat">
              <span className="stat-value">15+</span>
              <span className="stat-label">AI Models</span>
            </div>
            <div className="stat">
              <span className="stat-value">2</span>
              <span className="stat-label">Providers</span>
            </div>
            <div className="stat">
              <span className="stat-value">100%</span>
              <span className="stat-label">OpenAI Compatible</span>
            </div>
          </div>
        </div>
      </header>

      <section className="features">
        <div className="container">
          <h2>Why UnifiedAI?</h2>
          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">
                <Key />
              </div>
              <h3>Single API Key</h3>
              <p>One key to access all models. No juggling multiple providers or credentials.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">
                <Globe />
              </div>
              <h3>OpenAI Compatible</h3>
              <p>Drop-in replacement for OpenAI SDK. Works with any existing integration.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">
                <Shield />
              </div>
              <h3>Bring Your Keys</h3>
              <p>Add your own provider keys for unlimited access and better rate limits.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">
                <Code />
              </div>
              <h3>Smart Fallbacks</h3>
              <p>Automatic model fallback on rate limits. Your requests always succeed.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="models" className="models-section">
        <div className="container">
          <h2>Available Models</h2>
          <p className="section-subtitle">Access the latest AI models from leading providers</p>
          
          <div className="provider-tabs">
            <div className="provider-group">
              <h3>
                <span className="provider-dot openai" />
                OpenAI Models
                <span className="provider-badge">15 Free/Day</span>
              </h3>
              <div className="models-grid">
                {models.filter(m => m.provider === 'openai').map(model => (
                  <ModelCard key={model.id} model={model} />
                ))}
              </div>
            </div>
            
            <div className="provider-group">
              <h3>
                <span className="provider-dot anthropic" />
                Anthropic Models
                <span className="provider-badge">15 Free/Day</span>
              </h3>
              <div className="models-grid">
                {models.filter(m => m.provider === 'anthropic').map(model => (
                  <ModelCard key={model.id} model={model} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="cta">
        <div className="container">
          <div className="cta-card">
            <h2>Ready to get started?</h2>
            <p>Sign up now and get 15 free API requests per day.</p>
            <button className="btn btn-primary btn-lg" onClick={onSignIn}>
              Create Free Account
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="container">
          <p>© 2024 UnifiedAI. Built with ❤️</p>
        </div>
      </footer>
    </div>
  );
}

function ModelCard({ model }) {
  const tierColors = {
    premium: '#f59e0b',
    standard: '#6366f1',
    economy: '#22c55e',
    free: '#22c55e',
  };

  // Get display name from model id
  const getDisplayName = (id) => {
    if (id.startsWith('openrouter:')) {
      return id.replace('openrouter:', '').split('/').pop();
    }
    if (id.startsWith('togetherai:')) {
      return id.replace('togetherai:', '').split('/').pop();
    }
    return id;
  };

  // Estimate context length based on model
  const getContextLength = (id) => {
    if (id.includes('gpt-4o') || id.includes('gpt-5')) return 128;
    if (id.includes('claude-3') || id.includes('claude-sonnet') || id.includes('claude-opus')) return 200;
    if (id.includes('o1') || id.includes('o3')) return 128;
    if (id.includes('deepseek')) return 64;
    if (id.includes('mistral')) return 32;
    return 32;
  };

  const displayName = getDisplayName(model.id);
  const contextK = getContextLength(model.id);

  return (
    <div className="model-card">
      <div className="model-header">
        <span className="model-name">{displayName}</span>
        <span className="model-tier" style={{ background: tierColors[model.tier] || tierColors.standard }}>
          {model.tier}
        </span>
      </div>
      <div className="model-id">{model.id}</div>
      <div className="model-meta">
        <span>{contextK}K context</span>
        <span>via {model.via}</span>
      </div>
    </div>
  );
}
