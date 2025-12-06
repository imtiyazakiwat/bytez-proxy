import { useState } from 'react';

export default function ModelsPage({ models }) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  
  const providers = [...new Set(models.map(m => m.provider))];
  
  const getModelName = (id) => {
    if (id.startsWith('openrouter:')) return id.replace('openrouter:', '').split('/').pop();
    if (id.startsWith('togetherai:')) return id.replace('togetherai:', '').split('/').pop();
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
            <button key={p} className={`filter-tab ${filter === p ? 'active' : ''}`} onClick={() => setFilter(p)}>
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
            <span>... and {filteredModels.length - 100} more</span>
          </div>
        )}
      </div>
    </div>
  );
}
