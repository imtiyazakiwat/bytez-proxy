import { useState, useEffect } from 'react';
import { auth } from '../firebase';
import { 
  Key, LogOut, Zap, Activity, Settings, 
  BarChart3, Code, BookOpen, Image, PieChart, UserPlus, Menu, X 
} from 'lucide-react';
import NavItem from './ui/NavItem';
import OverviewPage from '../pages/OverviewPage';
import KeysPage from '../pages/KeysPage';
import ModelsPage from '../pages/ModelsPage';
import PlaygroundPage from '../pages/PlaygroundPage';
import ImagesPage from '../pages/ImagesPage';
import UsagePage from '../pages/UsagePage';
import DocsPage from '../pages/DocsPage';
import AdminPage from '../pages/AdminPage';
import PuterAccountsPage from '../pages/PuterAccountsPage';
import './Dashboard.css';

const ADMIN_USER_IDS = ['7nMmX6NJHGX2mshNOeN7Zv97lrD2'];
const VALID_TABS = ['overview', 'keys', 'models', 'playground', 'images', 'usage', 'puter-accounts', 'docs', 'admin'];

const getTabFromHash = () => {
  const hash = window.location.hash.replace('#', '').replace('/', '');
  return VALID_TABS.includes(hash) ? hash : 'overview';
};

export default function Dashboard({ user, onSignOut }) {
  const [activeTab, setActiveTab] = useState(getTabFromHash);
  const [profile, setProfile] = useState(null);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isAdmin = ADMIN_USER_IDS.includes(user.uid);

  useEffect(() => {
    const handleHashChange = () => setActiveTab(getTabFromHash());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const changeTab = (tab) => {
    window.location.hash = tab;
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

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
      setProfile(await profileRes.json());
      const modelsData = await modelsRes.json();
      setModels(modelsData.models || []);
    } catch (e) {
      console.error('Load error:', e);
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
    if (!confirm('Regenerate API key? Old key will stop working.')) return;
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'regenerateApiKey' })
      });
      const data = await res.json();
      if (data.apiKey) setProfile(prev => ({ ...prev, apiKey: data.apiKey }));
    } catch (e) {
      console.error('Regenerate error:', e);
    }
  };

  if (loading) return <div className="dashboard-loading">Loading...</div>;

  return (
    <div className="dashboard">
      {/* Mobile Header */}
      <header className="mobile-header">
        <div className="mobile-header-left">
          <Zap size={20} />
          <span>UnifiedAI</span>
        </div>
        <button className="btn-icon" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </header>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && <div className="mobile-overlay" onClick={() => setMobileMenuOpen(false)} />}

      <aside className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <Zap size={24} />
          <span>UnifiedAI</span>
        </div>
        
        <nav className="sidebar-nav">
          <NavItem icon={<BarChart3 />} label="Overview" tab="overview" active={activeTab === 'overview'} onClick={() => changeTab('overview')} />
          <NavItem icon={<Key />} label="API Keys" tab="keys" active={activeTab === 'keys'} onClick={() => changeTab('keys')} />
          <NavItem icon={<Activity />} label="Models" tab="models" active={activeTab === 'models'} onClick={() => changeTab('models')} />
          <NavItem icon={<Code />} label="Playground" tab="playground" active={activeTab === 'playground'} onClick={() => changeTab('playground')} />
          <NavItem icon={<Image />} label="Images" tab="images" active={activeTab === 'images'} onClick={() => changeTab('images')} />
          <NavItem icon={<PieChart />} label="Key Usage" tab="usage" active={activeTab === 'usage'} onClick={() => changeTab('usage')} />
          <NavItem icon={<UserPlus />} label="Create Account" tab="puter-accounts" active={activeTab === 'puter-accounts'} onClick={() => changeTab('puter-accounts')} />
          <NavItem icon={<BookOpen />} label="Docs" tab="docs" active={activeTab === 'docs'} onClick={() => changeTab('docs')} />
          {isAdmin && <NavItem icon={<Settings />} label="Admin" tab="admin" active={activeTab === 'admin'} onClick={() => changeTab('admin')} />}
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
        {activeTab === 'overview' && <OverviewPage profile={profile} copyApiKey={copyApiKey} copied={copied} />}
        {activeTab === 'keys' && <KeysPage profile={profile} setProfile={setProfile} copyApiKey={copyApiKey} copied={copied} regenerateKey={regenerateKey} />}
        {activeTab === 'models' && <ModelsPage models={models} />}
        {activeTab === 'playground' && <PlaygroundPage profile={profile} models={models} />}
        {activeTab === 'images' && <ImagesPage profile={profile} />}
        {activeTab === 'usage' && <UsagePage />}
        {activeTab === 'puter-accounts' && <PuterAccountsPage profile={profile} setProfile={setProfile} />}
        {activeTab === 'docs' && <DocsPage profile={profile} />}
        {activeTab === 'admin' && isAdmin && <AdminPage />}
      </main>
    </div>
  );
}
