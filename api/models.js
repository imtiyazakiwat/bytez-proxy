// Cache for models list
let modelsCache = null;
let cacheTime = 0;
const CACHE_TTL = 3600000; // 1 hour

// Non-chat models to exclude (code models, embedding models, image models, etc.)
const NON_CHAT_MODEL_PATTERNS = [
  /codex/i,           // Code completion models
  /embed/i,           // Embedding models
  /whisper/i,         // Audio transcription
  /tts/i,             // Text-to-speech
  /dall-e/i,          // Image generation
  /-vl-/i,            // Vision-language models
  /-vl$/i,            // Vision-language models
  /vision/i,          // Vision-only models
  /realtime/i,        // Realtime models
  /audio/i,           // Audio models
  /moderation/i,      // Content moderation
  /guard/i,           // Safety/guard models
  /bert/i,            // BERT models (not chat)
  /image/i,           // Image models
  /multimodal/i,      // Multimodal models
];

function isChatModel(modelId) {
  // Only include openrouter: models for reliability
  if (!modelId.startsWith('openrouter:')) {
    return false;
  }
  
  // Exclude models matching non-chat patterns
  for (const pattern of NON_CHAT_MODEL_PATTERNS) {
    if (pattern.test(modelId)) {
      return false;
    }
  }
  return true;
}

async function fetchPuterModels() {
  if (modelsCache && Date.now() - cacheTime < CACHE_TTL) {
    return modelsCache;
  }

  try {
    const response = await fetch('https://puter.com/puterai/chat/models', {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'UnifiedAI/1.0',
      }
    });
    
    // Check if response is JSON
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      console.error('Puter models endpoint returned non-JSON:', contentType);
      return modelsCache || getDefaultModels();
    }
    
    const data = await response.json();
    // Filter to only include OpenRouter chat/text models
    modelsCache = (data.models || []).filter(isChatModel);
    cacheTime = Date.now();
    return modelsCache;
  } catch (error) {
    console.error('Failed to fetch Puter models:', error);
    return modelsCache || getDefaultModels();
  }
}

// Fallback models if Puter API is unavailable
function getDefaultModels() {
  return [
    'openrouter:openai/gpt-4o',
    'openrouter:openai/gpt-4o-mini',
    'openrouter:anthropic/claude-3.5-sonnet',
    'openrouter:anthropic/claude-3-haiku',
    'openrouter:google/gemini-2.0-flash-001',
    'openrouter:deepseek/deepseek-chat',
    'openrouter:meta-llama/llama-3.3-70b-instruct',
  ];
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


// Fetch image models dynamically from Puter
let imageModelsCache = null;
let imageCacheTime = 0;

async function fetchImageModels() {
  if (imageModelsCache && Date.now() - imageCacheTime < CACHE_TTL) {
    return imageModelsCache;
  }
  
  try {
    const response = await fetch('https://puter.com/puterai/chat/models', {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'UnifiedAI/1.0',
      }
    });
    
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      console.error('Puter models endpoint returned non-JSON for images');
      return imageModelsCache || getDefaultImageModels();
    }
    
    const data = await response.json();
    const allModels = data.models || [];
    
    // Filter for image-related models
    const imageKeywords = ['image', 'flux', 'dall-e', 'stable-diffusion', 'sdxl', 'sd3', 
      'imagen', 'seedream', 'hidream', 'juggernaut', 'ideogram', 'qwen-image'];
    
    const imageModels = allModels.filter(m => {
      const lower = m.toLowerCase();
      return imageKeywords.some(k => lower.includes(k));
    }).map(id => {
      const lower = id.toLowerCase();
      let provider = 'unknown', tier = 'standard', supportsEdit = false;
      
      if (lower.includes('flux')) provider = 'black-forest-labs';
      else if (lower.includes('stable') || lower.includes('sdxl')) provider = 'stability';
      else if (lower.includes('dall-e') || lower.includes('gpt-image')) provider = 'openai';
      else if (lower.includes('gemini') || lower.includes('imagen')) { provider = 'google'; supportsEdit = lower.includes('gemini'); }
      else if (lower.includes('seedream')) provider = 'bytedance';
      else if (lower.includes('ideogram')) provider = 'ideogram';
      
      if (lower.includes('free') || lower.includes('schnell')) tier = 'free';
      else if (lower.includes('pro') || lower.includes('ultra')) tier = 'premium';
      
      return { id, provider, tier, via: 'puter', type: 'image', supportsEdit };
    });
    
    // Add common aliases
    const aliases = [
      { id: 'nano-banana', provider: 'google', tier: 'standard', via: 'puter', type: 'image', supportsEdit: true },
      { id: 'nano-banana-pro', provider: 'google', tier: 'premium', via: 'puter', type: 'image', supportsEdit: true },
      { id: 'flux-schnell', provider: 'black-forest-labs', tier: 'free', via: 'puter', type: 'image', supportsEdit: false },
      { id: 'flux-schnell-free', provider: 'black-forest-labs', tier: 'free', via: 'puter', type: 'image', supportsEdit: false },
      { id: 'sdxl', provider: 'stability', tier: 'economy', via: 'puter', type: 'image', supportsEdit: false },
      { id: 'sd3', provider: 'stability', tier: 'standard', via: 'puter', type: 'image', supportsEdit: false },
    ];
    
    imageModelsCache = [...aliases, ...imageModels];
    imageCacheTime = Date.now();
    return imageModelsCache;
  } catch (error) {
    console.error('Failed to fetch image models:', error.message);
    return imageModelsCache || getDefaultImageModels();
  }
}

// Fallback image models
function getDefaultImageModels() {
  return [
    { id: 'nano-banana', provider: 'google', tier: 'standard', via: 'puter', type: 'image', supportsEdit: true },
    { id: 'nano-banana-pro', provider: 'google', tier: 'premium', via: 'puter', type: 'image', supportsEdit: true },
    { id: 'flux-schnell', provider: 'black-forest-labs', tier: 'free', via: 'puter', type: 'image', supportsEdit: false },
    { id: 'flux-schnell-free', provider: 'black-forest-labs', tier: 'free', via: 'puter', type: 'image', supportsEdit: false },
    { id: 'sdxl', provider: 'stability', tier: 'economy', via: 'puter', type: 'image', supportsEdit: false },
    { id: 'sd3', provider: 'stability', tier: 'standard', via: 'puter', type: 'image', supportsEdit: false },
    { id: 'seedream-4', provider: 'bytedance', tier: 'standard', via: 'puter', type: 'image', supportsEdit: false },
    { id: 'gpt-image-1', provider: 'openai', tier: 'premium', via: 'puter', type: 'image', supportsEdit: false },
  ];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { format, provider, tier, search, via, type } = req.query;

  try {
    // If requesting image models only
    if (type === 'image') {
      let imageModels = await fetchImageModels();
      if (provider) imageModels = imageModels.filter(m => m.provider === provider);
      if (tier) imageModels = imageModels.filter(m => m.tier === tier);
      if (search) {
        const s = search.toLowerCase();
        imageModels = imageModels.filter(m => m.id.toLowerCase().includes(s));
      }
      return res.json({ models: imageModels, total: imageModels.length, type: 'image' });
    }

    const allModels = await fetchPuterModels();
    
    // Transform to enriched format
    let models = allModels.map(id => {
      const { provider, tier, via } = categorizeModel(id);
      return { id, provider, tier, via, type: 'chat' };
    });

    // Include image models if type=all
    if (type === 'all') {
      const imageModels = await fetchImageModels();
      models = [...models, ...imageModels];
    }

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
