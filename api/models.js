// Cache for models list
let modelsCache = null;
let cacheTime = 0;
const CACHE_TTL = 3600000; // 1 hour

async function fetchPuterModels() {
  if (modelsCache && Date.now() - cacheTime < CACHE_TTL) {
    return modelsCache;
  }

  try {
    const response = await fetch('https://puter.com/puterai/chat/models');
    const data = await response.json();
    modelsCache = data.models || [];
    cacheTime = Date.now();
    return modelsCache;
  } catch (error) {
    console.error('Failed to fetch Puter models:', error);
    return modelsCache || [];
  }
}

function categorizeModel(modelId) {
  // Determine provider and tier from model ID
  if (modelId.startsWith('openrouter:')) {
    const parts = modelId.replace('openrouter:', '').split('/');
    const provider = parts[0];
    const isFree = modelId.includes(':free');
    return { provider, tier: isFree ? 'free' : 'standard', via: 'openrouter' };
  }
  
  if (modelId.startsWith('gpt-') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4')) {
    const tier = modelId.includes('5.1') || modelId.includes('o3') || modelId.includes('o1') ? 'premium' : 
                 modelId.includes('mini') ? 'economy' : 'standard';
    return { provider: 'openai', tier, via: 'direct' };
  }
  
  if (modelId.startsWith('claude')) {
    const tier = modelId.includes('opus') ? 'premium' : modelId.includes('haiku') ? 'economy' : 'standard';
    return { provider: 'anthropic', tier, via: 'direct' };
  }
  
  if (modelId.startsWith('deepseek')) return { provider: 'deepseek', tier: 'economy', via: 'direct' };
  if (modelId.startsWith('mistral')) return { provider: 'mistral', tier: 'standard', via: 'direct' };
  if (modelId.startsWith('gemini')) return { provider: 'google', tier: 'standard', via: 'direct' };
  if (modelId.startsWith('grok')) return { provider: 'xai', tier: 'premium', via: 'direct' };
  if (modelId.startsWith('togetherai:')) return { provider: 'together', tier: 'standard', via: 'together' };
  
  return { provider: 'unknown', tier: 'standard', via: 'unknown' };
}


export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { format, provider, tier, search, via } = req.query;

  try {
    const allModels = await fetchPuterModels();
    
    // Transform to enriched format
    let models = allModels.map(id => {
      const { provider, tier, via } = categorizeModel(id);
      return { id, provider, tier, via };
    });

    // Apply filters
    if (provider) {
      models = models.filter(m => m.provider === provider);
    }
    if (tier) {
      models = models.filter(m => m.tier === tier);
    }
    if (via) {
      models = models.filter(m => m.via === via);
    }
    if (search) {
      const s = search.toLowerCase();
      models = models.filter(m => m.id.toLowerCase().includes(s));
    }

    // OpenAI-compatible format
    if (format === 'openai' || !format) {
      return res.json({
        object: 'list',
        data: models.map(m => ({
          id: m.id,
          object: 'model',
          owned_by: m.provider,
          permission: [],
        })),
      });
    }

    // Extended format
    const providers = {};
    models.forEach(m => {
      if (!providers[m.provider]) {
        providers[m.provider] = { count: 0, via: m.via };
      }
      providers[m.provider].count++;
    });

    return res.json({
      total: models.length,
      models,
      providers,
      tiers: {
        free: models.filter(m => m.tier === 'free').length,
        economy: models.filter(m => m.tier === 'economy').length,
        standard: models.filter(m => m.tier === 'standard').length,
        premium: models.filter(m => m.tier === 'premium').length,
      },
      limits: {
        freeDaily: 15,
        unlimited: 'Add your own Puter API key'
      }
    });

  } catch (error) {
    console.error('Models error:', error);
    return res.status(500).json({ error: { message: error.message } });
  }
}
