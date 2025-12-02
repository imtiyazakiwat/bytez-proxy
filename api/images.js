import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createHash } from 'crypto';

// Initialize Firebase Admin
if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (serviceAccount.project_id) {
    initializeApp({ credential: cert(serviceAccount) });
  }
}

const db = getApps().length ? getFirestore() : null;

const PUTER_BASE_URL = 'https://api.puter.com/drivers/call';
const FREE_DAILY_LIMIT = 15;

// ============== O(1) Key Pool Manager for Images ==============
class ImageKeyPoolManager {
  constructor() {
    this.blockedKeys = new Map();
    this.dailyBlockedHashes = new Set();
    this.currentDate = null;
    this.SHORT_COOLDOWN_MS = 5 * 60 * 1000; // 5 min
  }

  hashKey(key) {
    return createHash('sha256').update(key).digest('hex').substring(0, 16);
  }

  checkDateReset() {
    const today = new Date().toISOString().split('T')[0];
    if (this.currentDate !== today) {
      this.dailyBlockedHashes.clear();
      this.currentDate = today;
    }
  }

  markTempFailed(key) {
    const hash = this.hashKey(key);
    this.blockedKeys.set(hash, { until: Date.now() + this.SHORT_COOLDOWN_MS });
    console.log(`[ImageKeyPool] Temp blocked: ${hash.substring(0, 8)}...`);
  }

  markDailyLimited(key) {
    this.checkDateReset();
    const hash = this.hashKey(key);
    this.dailyBlockedHashes.add(hash);
    console.log(`[ImageKeyPool] Daily blocked: ${hash.substring(0, 8)}...`);
  }

  isKeyAvailable(key) {
    this.checkDateReset();
    const hash = this.hashKey(key);
    if (this.dailyBlockedHashes.has(hash)) return false;
    const block = this.blockedKeys.get(hash);
    if (block) {
      if (Date.now() < block.until) return false;
      this.blockedKeys.delete(hash);
    }
    return true;
  }

  getAvailableKey(keys, startIndex = 0) {
    if (!keys || keys.length === 0) return null;
    for (let i = 0; i < keys.length; i++) {
      const idx = (startIndex + i) % keys.length;
      if (this.isKeyAvailable(keys[idx])) {
        return { key: keys[idx], index: idx };
      }
    }
    return null;
  }
}

const imageKeyPool = new ImageKeyPoolManager();

// Dynamic driver detection based on model name
function getDriverForModel(model) {
  const modelLower = model.toLowerCase();
  
  // OpenAI models
  if (modelLower.includes('gpt-image') || modelLower.includes('dall-e') || modelLower.includes('dalle')) {
    return 'openai-image-generation';
  }
  
  // Gemini/Google models (Nano Banana)
  if (modelLower.includes('gemini') && modelLower.includes('image')) {
    return 'gemini-image-generation';
  }
  if (modelLower.includes('imagen')) {
    return 'together-image-generation'; // Google Imagen via Together
  }
  if (modelLower.includes('flash-image')) {
    return 'together-image-generation';
  }
  
  // Together AI models (FLUX, Stable Diffusion, Seedream, etc.)
  const togetherPrefixes = [
    'black-forest-labs/', 'stabilityai/', 'bytedance', 'flux', 
    'stable-diffusion', 'sdxl', 'sd3', 'seedream', 'hidream',
    'juggernaut', 'rundiffusion', 'ideogram', 'qwen/qwen-image'
  ];
  if (togetherPrefixes.some(p => modelLower.includes(p))) {
    return 'together-image-generation';
  }
  
  // If model starts with togetherai: prefix
  if (model.startsWith('togetherai:')) {
    return 'together-image-generation';
  }
  
  // Default to together for unknown image models
  return 'together-image-generation';
}

// Normalize model name (remove prefixes, handle aliases)
function normalizeModelName(model) {
  let normalized = model;
  
  // Remove provider prefixes
  if (normalized.startsWith('togetherai:')) {
    normalized = normalized.replace('togetherai:', '');
  }
  if (normalized.startsWith('openrouter:')) {
    normalized = normalized.replace('openrouter:', '');
  }
  
  // Map OpenRouter/Google model names to Puter-compatible names
  const modelMappings = {
    'google/gemini-2.5-flash-image': 'gemini-2.5-flash-image-preview',
    'google/gemini-2.5-flash-image-preview': 'gemini-2.5-flash-image-preview',
    'google/gemini-3-pro-image': 'gemini-3-pro-image-preview',
    'google/gemini-3-pro-image-preview': 'gemini-3-pro-image-preview',
  };
  
  if (modelMappings[normalized]) {
    normalized = modelMappings[normalized];
  }

  // Common aliases
  const aliases = {
    'nano-banana': 'gemini-2.5-flash-image-preview',
    'nano-banana-pro': 'gemini-3-pro-image-preview',
    'flux-schnell': 'black-forest-labs/FLUX.1-schnell',
    'flux-schnell-free': 'black-forest-labs/FLUX.1-schnell-Free',
    'flux-dev': 'black-forest-labs/FLUX.1-dev',
    'flux-pro': 'black-forest-labs/FLUX.1-pro',
    'flux-kontext': 'black-forest-labs/FLUX.1-kontext-dev',
    'sdxl': 'stabilityai/stable-diffusion-xl-base-1.0',
    'sd3': 'stabilityai/stable-diffusion-3-medium',
    'stable-diffusion-3': 'stabilityai/stable-diffusion-3-medium',
    'seedream-3': 'ByteDance-Seed/Seedream-3.0',
    'seedream-4': 'ByteDance-Seed/Seedream-4.0',
    'gpt-image-1': 'gpt-image-1',
    'dall-e-3': 'dall-e-3',
    'dall-e-2': 'dall-e-2',
    'imagen-4': 'google/imagen-4.0-preview',
    'imagen-4-fast': 'google/imagen-4.0-fast',
    'imagen-4-ultra': 'google/imagen-4.0-ultra',
  };
  
  return aliases[normalized.toLowerCase()] || normalized;
}

// Get system Puter keys from Firestore
async function getSystemKeys() {
  if (!db) return [];
  try {
    const configDoc = await db.collection('system').doc('config').get();
    if (!configDoc.exists) return [];
    const config = configDoc.data();
    return config.systemPuterKeys || [];
  } catch (error) {
    console.error('Failed to get system keys:', error.message);
    return [];
  }
}

async function getUserByApiKey(apiKey) {
  if (!db) return null;
  const snapshot = await db.collection('users').where('apiKey', '==', apiKey).limit(1).get();
  if (snapshot.empty) return null;
  return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

async function incrementUsage(userId) {
  if (!db) return;
  const userRef = db.collection('users').doc(userId);
  const today = new Date().toISOString().split('T')[0];
  await userRef.update({ dailyRequestsUsed: FieldValue.increment(1), lastRequestDate: today });
}

async function getDailyUsage(user) {
  const today = new Date().toISOString().split('T')[0];
  if (user.lastRequestDate !== today) {
    if (db) {
      const userRef = db.collection('users').doc(user.id);
      await userRef.update({ dailyRequestsUsed: 0, lastRequestDate: today });
    }
    return 0;
  }
  return user.dailyRequestsUsed || 0;
}

async function logImageUsage(userId, model, type, success, errorMessage = null) {
  if (!db) return;
  try {
    await db.collection('usage_logs').add({
      userId, model, type, success, errorMessage,
      timestamp: new Date().toISOString(),
      date: new Date().toISOString().split('T')[0],
    });
    if (success) {
      const userRef = db.collection('users').doc(userId);
      await userRef.update({
        totalImageGenerations: FieldValue.increment(1),
        totalRequests: FieldValue.increment(1),
        lastRequestAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('Failed to log image usage:', error.message);
  }
}


// Convert pixel size to aspect ratio for Gemini/Imagen models
function sizeToRatio(size) {
  if (!size) return '1:1';
  // If already a ratio format, return as-is
  if (size.includes(':')) return size;
  
  // Parse pixel dimensions
  const match = size.match(/(\d+)x(\d+)/i);
  if (!match) return '1:1';
  
  const w = parseInt(match[1]);
  const h = parseInt(match[2]);
  const ratio = w / h;
  
  // Map to valid Gemini ratios: 1:1, 3:4, 4:3, 9:16, 16:9
  if (ratio > 1.6) return '16:9';      // Wide landscape
  if (ratio > 1.2) return '4:3';       // Landscape
  if (ratio > 0.9) return '1:1';       // Square
  if (ratio > 0.65) return '3:4';      // Portrait
  return '9:16';                        // Tall portrait
}

// Call OpenRouter for image generation via chat completion (fallback method)
async function callOpenRouterImageGeneration(prompt, model, puterToken, options = {}) {
  // Build message content
  let content = prompt;
  
  // For img2img, include the input image in the message
  if (options.input_image) {
    const mimeType = options.input_image_mime_type || 'image/png';
    content = [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${options.input_image}` } }
    ];
  }
  
  // Map model to OpenRouter format
  let openRouterModel = model;
  if (!openRouterModel.startsWith('openrouter:')) {
    // Map common models to OpenRouter equivalents
    const orMappings = {
      'nano-banana': 'openrouter:google/gemini-2.5-flash-image-preview',
      'nano-banana-pro': 'openrouter:google/gemini-3-pro-image-preview',
      'gemini-2.5-flash-image-preview': 'openrouter:google/gemini-2.5-flash-image-preview',
      'gemini-3-pro-image-preview': 'openrouter:google/gemini-3-pro-image-preview',
    };
    openRouterModel = orMappings[model] || `openrouter:${model}`;
  }
  
  console.log(`[OpenRouter Image] model: ${openRouterModel}, img2img: ${!!options.input_image}`);

  const response = await fetch(PUTER_BASE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${puterToken}`,
      'Content-Type': 'application/json',
      'Origin': 'https://puter.com',
    },
    body: JSON.stringify({
      interface: 'puter-chat-completion',
      driver: 'openrouter',
      method: 'complete',
      args: {
        model: openRouterModel,
        messages: [{ role: 'user', content }],
      },
    }),
  });

  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.error?.message || data.error || 'OpenRouter image generation error');
  }
  
  // Extract images from response
  const result = data.result;
  const images = result?.message?.images || [];
  
  if (images.length > 0) {
    return {
      success: true,
      data: images.map(img => {
        const url = img.image_url?.url || img.url || '';
        // Extract base64 from data URL
        const match = url.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          return { b64_json: match[2], mime_type: match[1], revised_prompt: prompt };
        }
        return { url, revised_prompt: prompt };
      })
    };
  }
  
  // If no images, return the text content (model might not support image generation)
  throw new Error('Model did not return any images');
}

// Call Puter image generation API (supports txt2img and img2img)
async function callPuterImageGeneration(prompt, model, puterToken, options = {}) {
  const normalizedModel = normalizeModelName(model);
  const driver = getDriverForModel(normalizedModel);
  
  const args = { prompt, model: normalizedModel };
  
  // Handle size parameter - Gemini driver doesn't need ratio when using correct model names
  if (options.size && driver !== 'gemini-image-generation') {
    args.size = options.size;
  }
  // Note: Gemini models work without ratio when using gemini-X-image-preview format
  
  if (options.quality) args.quality = options.quality;
  if (options.n) args.n = options.n;
  if (options.style) args.style = options.style;
  
  // Disable safety checker for models that require it (Together AI models)
  if (driver === 'together-image-generation') {
    args.disable_safety_checker = true;
  }
  
  // Image-to-image support
  if (options.input_image) {
    args.input_image = options.input_image;
    args.input_image_mime_type = options.input_image_mime_type || 'image/png';
  }

  console.log(`[Puter Image] driver: ${driver}, model: ${normalizedModel}, img2img: ${!!options.input_image}`);

  const response = await fetch(PUTER_BASE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${puterToken}`,
      'Content-Type': 'application/json',
      'Origin': 'https://puter.com',
    },
    body: JSON.stringify({
      interface: 'puter-image-generation',
      driver,
      method: 'generate',
      args,
    }),
  });

  // Get response as buffer to detect binary vs JSON
  const responseBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(responseBuffer);
  
  // Check for image magic bytes
  const isPNG = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
  const isJPEG = bytes[0] === 0xFF && bytes[1] === 0xD8;
  
  if (isPNG || isJPEG) {
    const base64 = Buffer.from(responseBuffer).toString('base64');
    return {
      success: true,
      data: [{
        b64_json: base64,
        revised_prompt: prompt,
        mime_type: isPNG ? 'image/png' : 'image/jpeg',
      }]
    };
  }
  
  // Parse as JSON
  const jsonText = new TextDecoder().decode(responseBuffer);
  const data = JSON.parse(jsonText);
  
  if (!data.success && data.error) {
    throw new Error(data.error?.message || data.error || 'Image generation error');
  }
  
  // Handle various response formats
  if (data.result) {
    if (typeof data.result === 'string' && data.result.startsWith('http')) {
      return { success: true, data: [{ url: data.result, revised_prompt: prompt }] };
    }
    if (typeof data.result === 'string') {
      return { success: true, data: [{ b64_json: data.result, revised_prompt: prompt }] };
    }
    if (data.result.data) {
      return { success: true, data: data.result.data };
    }
  }
  
  return data;
}


// Fetch available image models from Puter
async function fetchImageModels() {
  try {
    const response = await fetch('https://puter.com/puterai/chat/models', {
      headers: { 'Accept': 'application/json', 'User-Agent': 'UnifiedAI/1.0' }
    });
    
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return getDefaultImageModelsList();
    }
    
    const data = await response.json();
    const models = data.models || [];
    
    // Filter for image-related models
    const imageKeywords = ['image', 'flux', 'dall', 'stable-diffusion', 'sdxl', 'sd3', 
      'imagen', 'seedream', 'hidream', 'juggernaut', 'ideogram', 'qwen-image'];
    
    const filtered = models.filter(m => {
      const lower = m.toLowerCase();
      return imageKeywords.some(k => lower.includes(k));
    });
    
    return filtered.length > 0 ? filtered : getDefaultImageModelsList();
  } catch (error) {
    console.error('Failed to fetch image models:', error.message);
    return getDefaultImageModelsList();
  }
}

function getDefaultImageModelsList() {
  return [
    'nano-banana', 'nano-banana-pro', 'flux-schnell', 'flux-schnell-free',
    'sdxl', 'sd3', 'seedream-4', 'gpt-image-1', 'dall-e-3'
  ];
}

// Main handler
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // GET - List available image models
  if (req.method === 'GET') {
    const models = await fetchImageModels();
    const categorized = {
      openai: models.filter(m => m.includes('gpt-image') || m.includes('dall-e')),
      gemini: models.filter(m => m.includes('gemini') && m.includes('image')),
      flux: models.filter(m => m.toLowerCase().includes('flux')),
      stability: models.filter(m => m.toLowerCase().includes('stable') || m.includes('sdxl')),
      google: models.filter(m => m.includes('imagen')),
      other: models.filter(m => 
        m.toLowerCase().includes('seedream') || 
        m.toLowerCase().includes('hidream') ||
        m.toLowerCase().includes('ideogram')
      ),
    };
    
    // Add common aliases
    const aliases = [
      { id: 'nano-banana', name: 'Nano Banana (Gemini 2.5 Flash Image)', supports_img2img: true },
      { id: 'nano-banana-pro', name: 'Nano Banana Pro (Gemini 3 Pro Image)', supports_img2img: true },
      { id: 'flux-schnell', name: 'FLUX.1 Schnell', supports_img2img: false },
      { id: 'flux-schnell-free', name: 'FLUX.1 Schnell Free', supports_img2img: false },
      { id: 'sdxl', name: 'Stable Diffusion XL', supports_img2img: false },
      { id: 'sd3', name: 'Stable Diffusion 3', supports_img2img: false },
      { id: 'gpt-image-1', name: 'GPT Image 1', supports_img2img: false },
      { id: 'dall-e-3', name: 'DALL-E 3', supports_img2img: false },
    ];
    
    return res.json({ 
      models, 
      categorized,
      aliases,
      total: models.length,
      note: 'Use any model ID directly, or use aliases like nano-banana, flux-schnell, etc.'
    });
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  let user = null;
  let model = null;

  try {
    const authHeader = req.headers.authorization || req.headers['x-api-key'] || '';
    const apiKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    
    if (!apiKey) {
      return res.status(401).json({ error: { message: 'API key required' } });
    }

    user = await getUserByApiKey(apiKey);
    if (!user) {
      return res.status(401).json({ error: { message: 'Invalid API key' } });
    }

    const { prompt, size, quality, n, style, response_format, image } = req.body;
    model = req.body.model || 'flux-schnell-free';

    if (!prompt) {
      return res.status(400).json({ error: { message: 'prompt is required' } });
    }

    const isImg2Img = !!image;
    console.log(`[Image] ${user.email}: ${model}, img2img: ${isImg2Img}, prompt: "${prompt.substring(0, 50)}..."`);

    // Check daily limits for free users
    const hasOwnKeys = user.puterKeys && user.puterKeys.length > 0;
    if (!hasOwnKeys) {
      const dailyUsed = await getDailyUsage(user);
      if (dailyUsed >= FREE_DAILY_LIMIT) {
        await logImageUsage(user.id, model, isImg2Img ? 'img2img' : 'txt2img', false, 'Daily limit exceeded');
        return res.status(403).json({ 
          error: { message: `Daily free limit (${FREE_DAILY_LIMIT}) reached.`, code: 'DAILY_LIMIT_EXCEEDED' } 
        });
      }
    }

    // Get API keys
    let systemKeys = await getSystemKeys();
    if (systemKeys.length === 0 && process.env.PUTER_API_KEY) {
      systemKeys = [process.env.PUTER_API_KEY];
    }
    const userKeys = hasOwnKeys ? user.puterKeys.map(k => k.key || k) : [];
    const allKeys = userKeys.length > 0 ? userKeys : systemKeys;

    if (allKeys.length === 0) {
      return res.status(500).json({ error: { message: 'No Puter API key configured' } });
    }

    if (!hasOwnKeys) await incrementUsage(user.id);

    // Build options
    const options = {};
    if (size) options.size = size;
    if (quality) options.quality = quality;
    if (n) options.n = n;
    if (style) options.style = style;
    
    // Handle input image for img2img
    if (image) {
      if (image.startsWith('data:')) {
        const matches = image.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          options.input_image = matches[2];
          options.input_image_mime_type = matches[1];
        }
      } else if (image.startsWith('http')) {
        const imgRes = await fetch(image);
        const imgBuf = await imgRes.arrayBuffer();
        options.input_image = Buffer.from(imgBuf).toString('base64');
        options.input_image_mime_type = imgRes.headers.get('content-type') || 'image/png';
      } else {
        options.input_image = image;
        options.input_image_mime_type = 'image/png';
      }
    }

    // Check if model should use OpenRouter directly (Gemini image models)
    const useOpenRouterDirectly = [
      'google/gemini-2.5-flash-image',
      'google/gemini-2.5-flash-image-preview', 
      'google/gemini-3-pro-image-preview',
      'gemini-2.5-flash-image-preview',
      'gemini-3-pro-image-preview',
      'nano-banana',
      'nano-banana-pro',
    ].some(m => model.toLowerCase().includes(m.toLowerCase()));

    // Try keys using KeyPoolManager for O(1) selection
    let lastError = null;
    let fundingError = false;
    let keyIndex = Math.floor(Math.random() * allKeys.length);
    let triedCount = 0;
    
    while (triedCount < allKeys.length) {
      const keyResult = imageKeyPool.getAvailableKey(allKeys, keyIndex);
      if (!keyResult) {
        console.log('[ImageKeyPool] No available keys in pool');
        break;
      }
      
      const key = keyResult.key;
      keyIndex = (keyResult.index + 1) % allKeys.length;
      triedCount++;
      
      try {
        let result;
        
        if (useOpenRouterDirectly) {
          // Use OpenRouter directly for Gemini image models
          result = await callOpenRouterImageGeneration(prompt, model, key, options);
        } else {
          // Use native Puter image generation for other models
          result = await callPuterImageGeneration(prompt, model, key, options);
        }
        
        await logImageUsage(user.id, model, isImg2Img ? 'img2img' : 'txt2img', true);
        
        const responseData = {
          created: Math.floor(Date.now() / 1000),
          data: result.data || [],
        };
        
        if (response_format === 'url' && responseData.data[0]?.b64_json) {
          responseData.data = responseData.data.map(d => ({
            url: `data:${d.mime_type || 'image/png'};base64,${d.b64_json}`,
            revised_prompt: d.revised_prompt,
          }));
        }
        
        return res.json(responseData);
      } catch (error) {
        lastError = error;
        const msg = error.message || '';
        console.error(`Image generation failed:`, msg);
        
        // Handle rate limit errors - mark key as temporarily blocked
        if (msg.includes('rate') || msg.includes('limit') || msg.includes('429') || msg.includes('too many')) {
          imageKeyPool.markTempFailed(key);
        }
        // Handle daily/usage limit errors - mark key as daily blocked
        else if (msg.includes('usage-limited') || msg.includes('daily') || msg.includes('quota')) {
          imageKeyPool.markDailyLimited(key);
        }
        // Handle funding errors
        else if (msg.includes('funding') || msg.includes('insufficient')) {
          fundingError = true;
          imageKeyPool.markDailyLimited(key);
        }
        continue;
      }
    }

    // If native image generation failed due to funding, try OpenRouter as fallback for non-Gemini models
    if (fundingError && !useOpenRouterDirectly) {
      console.log('[Image] Native generation failed due to funding, trying OpenRouter fallback...');
      
      keyIndex = 0;
      triedCount = 0;
      
      while (triedCount < allKeys.length) {
        const keyResult = imageKeyPool.getAvailableKey(allKeys, keyIndex);
        if (!keyResult) break;
        
        const key = keyResult.key;
        keyIndex = (keyResult.index + 1) % allKeys.length;
        triedCount++;
        
        try {
          const result = await callOpenRouterImageGeneration(prompt, model, key, options);
          await logImageUsage(user.id, model + ' (openrouter)', isImg2Img ? 'img2img' : 'txt2img', true);
          
          const responseData = {
            created: Math.floor(Date.now() / 1000),
            data: result.data || [],
          };
          
          if (response_format === 'url' && responseData.data[0]?.b64_json) {
            responseData.data = responseData.data.map(d => ({
              url: `data:${d.mime_type || 'image/png'};base64,${d.b64_json}`,
              revised_prompt: d.revised_prompt,
            }));
          }
          
          return res.json(responseData);
        } catch (orError) {
          const msg = orError.message || '';
          console.error('OpenRouter fallback failed:', msg);
          
          if (msg.includes('rate') || msg.includes('limit') || msg.includes('429')) {
            imageKeyPool.markTempFailed(key);
          } else if (msg.includes('usage-limited') || msg.includes('daily') || msg.includes('quota')) {
            imageKeyPool.markDailyLimited(key);
          }
          continue;
        }
      }
      
      return res.status(402).json({ 
        error: { 
          message: 'Insufficient credits for both native and OpenRouter image generation. Try flux-schnell-free or add new Puter API keys.',
          code: 'INSUFFICIENT_CREDITS'
        } 
      });
    }
    
    await logImageUsage(user.id, model, isImg2Img ? 'img2img' : 'txt2img', false, lastError?.message);
    return res.status(500).json({ error: { message: lastError?.message || 'Image generation failed' } });

  } catch (error) {
    console.error('Image API error:', error);
    if (user && model) await logImageUsage(user.id, model, 'error', false, error.message);
    return res.status(500).json({ error: { message: error.message } });
  }
}
