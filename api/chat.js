import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

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

import { createHash } from 'crypto';

// ============== O(1) Key Pool Manager ==============
// Instead of checking each key, maintain a ready pool of available keys
// and a blocked set for failed keys. All operations are O(1).

class KeyPoolManager {
  constructor() {
    this.blockedKeys = new Map(); // hash -> { until: timestamp, reason: string }
    this.dailyBlockedHashes = new Set(); // hashes blocked for the day
    this.currentDate = null;
    this.dbCacheLoaded = false;
    this.SHORT_COOLDOWN_MS = 5 * 60 * 1000; // 5 min for temp failures
  }

  // O(1) hash computation (cached per key instance via Map)
  hashKey(key) {
    return createHash('sha256').update(key).digest('hex').substring(0, 16);
  }

  // Reset daily blocks at midnight
  checkDateReset() {
    const today = new Date().toISOString().split('T')[0];
    if (this.currentDate !== today) {
      this.dailyBlockedHashes.clear();
      this.currentDate = today;
      this.dbCacheLoaded = false;
    }
  }

  // O(1) - Mark key as temporarily failed (short cooldown)
  markTempFailed(key) {
    const hash = this.hashKey(key);
    this.blockedKeys.set(hash, {
      until: Date.now() + this.SHORT_COOLDOWN_MS,
      reason: 'temp'
    });
    console.log(`[KeyPool] Temp blocked: ${hash} for ${this.SHORT_COOLDOWN_MS/1000}s`);
  }

  // O(1) - Mark key as usage-limited for the day
  async markDailyLimited(key) {
    this.checkDateReset();
    const hash = this.hashKey(key);
    this.dailyBlockedHashes.add(hash);
    console.log(`[KeyPool] Daily blocked: ${hash}`);

    // Persist to DB (fire and forget for speed)
    if (db) {
      const today = new Date().toISOString().split('T')[0];
      db.collection('failed_keys').doc(today).set({
        [hash]: { failedAt: new Date().toISOString(), reason: 'usage-limited' }
      }, { merge: true }).catch(e => console.error('DB persist error:', e.message));
    }
  }

  // O(1) - Check if a specific key is available
  isKeyAvailable(key) {
    this.checkDateReset();
    const hash = this.hashKey(key);

    // Check daily block
    if (this.dailyBlockedHashes.has(hash)) return false;

    // Check temp block
    const block = this.blockedKeys.get(hash);
    if (block) {
      if (Date.now() < block.until) return false;
      this.blockedKeys.delete(hash); // Expired, remove
    }

    return true;
  }

  // O(1) amortized - Get first available key from array (uses index rotation)
  getAvailableKey(keys, startIndex = 0) {
    if (!keys || keys.length === 0) return null;
    
    // Try from startIndex, wrap around once
    for (let i = 0; i < keys.length; i++) {
      const idx = (startIndex + i) % keys.length;
      if (this.isKeyAvailable(keys[idx])) {
        return { key: keys[idx], index: idx };
      }
    }
    return null;
  }

  // Load daily blocked keys from DB (called once per day per server instance)
  async loadDailyBlockedFromDB() {
    if (this.dbCacheLoaded || !db) return;
    
    this.checkDateReset();
    const today = new Date().toISOString().split('T')[0];
    
    try {
      const doc = await db.collection('failed_keys').doc(today).get();
      if (doc.exists) {
        const data = doc.data();
        Object.keys(data).forEach(hash => this.dailyBlockedHashes.add(hash));
        console.log(`[KeyPool] Loaded ${Object.keys(data).length} blocked keys from DB`);
      }
      this.dbCacheLoaded = true;
    } catch (e) {
      console.error('[KeyPool] Failed to load from DB:', e.message);
    }
  }
}

const keyPool = new KeyPoolManager();

// Verified working text/chat models - route through OpenRouter for reliability
// OpenRouter handles model availability and routing automatically
const OPENROUTER_MODEL_MAP = {
  // OpenAI models
  'gpt-4.1': 'openai/gpt-4.1',
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  'o3': 'openai/o3',
  'o3-mini': 'openai/o3-mini',
  'o1': 'openai/o1',
  'o1-mini': 'openai/o1-mini',
  // Claude models
  'claude-sonnet-4': 'anthropic/claude-sonnet-4',
  'claude-sonnet-4-5': 'anthropic/claude-sonnet-4.5',
  'claude-sonnet-4.5': 'anthropic/claude-sonnet-4.5',
  'claude-3-5-sonnet': 'anthropic/claude-3.5-sonnet',
  'claude-3.5-sonnet': 'anthropic/claude-3.5-sonnet',
  'claude-3-7-sonnet': 'anthropic/claude-3.7-sonnet',
  'claude-3.7-sonnet': 'anthropic/claude-3.7-sonnet',
  'claude-3-haiku': 'anthropic/claude-3-haiku',
  // DeepSeek models
  'deepseek-chat': 'deepseek/deepseek-chat',
  'deepseek-reasoner': 'deepseek/deepseek-reasoner',
  // Mistral models
  'mistral-large': 'mistralai/mistral-large',
  'mistral-small': 'mistralai/mistral-small',
  // Gemini models
  'gemini-2.0-flash': 'google/gemini-2.0-flash-001',
  'gemini-2.5-flash': 'google/gemini-2.5-flash-preview',
  'gemini-pro': 'google/gemini-pro',
  // Grok models
  'grok-3': 'x-ai/grok-3',
  'grok-2': 'x-ai/grok-2',
};

// Check if content array contains images
function hasImageContent(content) {
  if (!Array.isArray(content)) return false;
  return content.some(part => 
    part.type === 'image_url' || 
    part.type === 'image' ||
    (part.image_url && part.image_url.url)
  );
}

// Check if content array contains file attachments (PDF, Excel, etc.)
function hasFileContent(content) {
  if (!Array.isArray(content)) return false;
  return content.some(part => 
    part.type === 'file' ||
    (part.file && (part.file.file_data || part.file.url))
  );
}

// Normalize content - handle array format (Claude Code) vs string format
// preserveMultimodal: if true, keep image_url and file parts for multimodal models
function normalizeContent(content, preserveMultimodal = false) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // If preserving multimodal content (images, files), return the array with proper formatting
    if (preserveMultimodal && (hasImageContent(content) || hasFileContent(content))) {
      return content.map(part => {
        if (typeof part === 'string') return { type: 'text', text: part };
        if (part.type === 'text') return part;
        if (part.type === 'image_url') return part;
        if (part.type === 'image') {
          // Convert 'image' type to 'image_url' format
          return {
            type: 'image_url',
            image_url: { url: part.url || part.source?.url || part.data }
          };
        }
        // Preserve file attachments (PDF, Excel, etc.)
        if (part.type === 'file') return part;
        return null;
      }).filter(Boolean);
    }
    
    // Handle multimodal content array format: [{type: "text", text: "..."}, ...]
    return content
      .map(part => {
        if (typeof part === 'string') return part;
        if (part.type === 'text' && part.text) return part.text;
        if (part.type === 'tool_result' && part.content) {
          // Handle tool_result content which can also be an array
          return normalizeContent(part.content);
        }
        if (part.type === 'tool_use') {
          // Skip tool_use parts in content normalization
          return '';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return String(content);
}

function getDriverAndModel(modelId) {
  // Already prefixed with openrouter: - use as-is
  if (modelId.startsWith('openrouter:')) {
    return { driver: 'openrouter', model: modelId };
  }
  
  // TogetherAI models
  if (modelId.startsWith('togetherai:')) {
    return { driver: 'together-ai', model: modelId };
  }
  
  // Check if we have a known mapping for this model
  const openRouterModel = OPENROUTER_MODEL_MAP[modelId];
  if (openRouterModel) {
    return { driver: 'openrouter', model: `openrouter:${openRouterModel}` };
  }
  
  // For unknown models, try to route through OpenRouter with smart prefix detection
  // This handles models from the Puter models list that aren't in our map
  if (modelId.startsWith('gpt-') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4')) {
    return { driver: 'openrouter', model: `openrouter:openai/${modelId}` };
  }
  if (modelId.startsWith('claude')) {
    return { driver: 'openrouter', model: `openrouter:anthropic/${modelId}` };
  }
  if (modelId.startsWith('gemini')) {
    return { driver: 'openrouter', model: `openrouter:google/${modelId}` };
  }
  if (modelId.startsWith('grok')) {
    return { driver: 'openrouter', model: `openrouter:x-ai/${modelId}` };
  }
  if (modelId.startsWith('mistral')) {
    return { driver: 'openrouter', model: `openrouter:mistralai/${modelId}` };
  }
  if (modelId.startsWith('deepseek')) {
    return { driver: 'openrouter', model: `openrouter:deepseek/${modelId}` };
  }
  
  // Default: try OpenRouter with the model ID as-is (it may fail but gives better error)
  return { driver: 'openrouter', model: `openrouter:${modelId}` };
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

// Get available keys (excluding recently failed ones)
function getAvailableKeys(keys) {
  if (!keys || keys.length === 0) return [];
  const now = Date.now();
  return keys.filter(key => {
    const failedAt = failedKeys.get(key);
    if (!failedAt) return true;
    // Key is available again after cooldown
    if (now - failedAt > KEY_COOLDOWN_MS) {
      failedKeys.delete(key);
      return true;
    }
    return false;
  });
}

// Wrapper functions using the O(1) KeyPoolManager
function markKeyFailed(key) {
  keyPool.markTempFailed(key);
}

async function markKeyUsageLimited(key) {
  await keyPool.markDailyLimited(key);
}



// Log usage to Firestore
async function logUsage(userId, model, usage, provider, success, errorMessage = null, keyUsed = null) {
  if (!db) return;
  
  try {
    const logEntry = {
      userId,
      model,
      provider,
      promptTokens: usage?.prompt_tokens || 0,
      completionTokens: usage?.completion_tokens || 0,
      totalTokens: usage?.total_tokens || 0,
      success,
      errorMessage,
      keyType: keyUsed ? 'user' : 'system',
      timestamp: new Date().toISOString(),
      date: new Date().toISOString().split('T')[0],
    };
    
    await db.collection('usage_logs').add(logEntry);
    
    // Update user's total token counts
    if (success && usage?.total_tokens > 0) {
      const userRef = db.collection('users').doc(userId);
      await userRef.update({
        totalPromptTokens: FieldValue.increment(usage.prompt_tokens || 0),
        totalCompletionTokens: FieldValue.increment(usage.completion_tokens || 0),
        totalTokens: FieldValue.increment(usage.total_tokens || 0),
        totalRequests: FieldValue.increment(1),
        lastRequestAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('Failed to log usage:', error.message);
  }
}

// Check if error is a rate limit / usage limit error
function isRateLimitError(error) {
  const errorMsg = (error?.message || error || '').toLowerCase();
  return errorMsg.includes('rate limit') || 
         errorMsg.includes('usage limit') ||
         errorMsg.includes('usage-limited') ||
         errorMsg.includes('quota') ||
         errorMsg.includes('exceeded') ||
         errorMsg.includes('too many requests') ||
         errorMsg.includes('permission denied') ||
         errorMsg.includes('429');
}

// Check if error is specifically a daily usage limit (should be blocked for the day)
function isUsageLimitedError(errorMsg) {
  const msg = (errorMsg || '').toLowerCase();
  return msg.includes('usage-limited') || 
         msg.includes('usage limit') ||
         msg.includes('permission denied');
}

// Models that support extended thinking with :thinking variant on Puter/OpenRouter
// These models will be switched to their :thinking variant when thinking_budget is provided
const THINKING_MODEL_MAP = {
  'claude-3.7-sonnet': 'anthropic/claude-3.7-sonnet:thinking',
  'claude-3-7-sonnet': 'anthropic/claude-3.7-sonnet:thinking',
};

// Note: Claude 4.x models (sonnet-4, sonnet-4.5, opus-4, etc.) don't have :thinking 
// variants available on Puter/OpenRouter yet. They will use include_reasoning=true
// but won't return reasoning content until Puter adds support.

function supportsThinking(modelId) {
  // Check if model is in thinking map or already has :thinking suffix
  return modelId.includes(':thinking') || 
         Object.keys(THINKING_MODEL_MAP).some(m => modelId.includes(m));
}

function getThinkingModel(modelId) {
  // If already has :thinking suffix, return as-is
  if (modelId.includes(':thinking')) return modelId;
  
  // Check if we have a mapping for this model - use exact match first
  if (THINKING_MODEL_MAP[modelId]) {
    return THINKING_MODEL_MAP[modelId];
  }
  
  // Then try partial match (for prefixed models like openrouter:...)
  for (const [key, value] of Object.entries(THINKING_MODEL_MAP)) {
    if (modelId.includes(key)) {
      return value;
    }
  }
  return null;
}

// Timeout for API calls - thinking models need longer timeouts
const API_TIMEOUT_MS = 120000; // 120 seconds for thinking models

async function callPuter(messages, modelId, puterToken, options = {}) {
  const hasTools = !!(options.tools && options.tools.length > 0);
  let { driver, model } = getDriverAndModel(modelId, hasTools);
  
  // Check if thinking is requested and model supports it
  const wantsThinking = options.thinking_budget && options.thinking_budget > 0;
  const thinkingModel = wantsThinking ? getThinkingModel(modelId) : null;
  
  if (thinkingModel) {
    // Override to use the :thinking variant
    model = `openrouter:${thinkingModel}`;
    console.log(`[Puter] Using thinking model variant: ${model}`);
  }
  
  const args = { messages, model };
  if (options.max_tokens) args.max_tokens = options.max_tokens;
  if (options.temperature !== undefined) args.temperature = options.temperature;
  if (options.tools) args.tools = options.tools;
  if (options.tool_choice) args.tool_choice = options.tool_choice;
  
  // Always enable reasoning - non-thinking models will ignore it,
  // but thinking models will return reasoning_content regardless of name pattern
  args.include_reasoning = true;
  
  // Enable extended thinking for supported models
  if (thinkingModel || supportsThinking(modelId)) {
    // Use thinking budget from options, or default to 10000 tokens
    const thinkingBudget = options.thinking_budget || 10000;
    args.thinking = {
      type: 'enabled',
      budget_tokens: thinkingBudget
    };
    console.log(`[Puter] Extended thinking enabled for ${modelId} with budget: ${thinkingBudget}`);
  }

  console.log(`[Puter] Non-streaming request to ${driver} with model ${model}`);

  // Use AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(PUTER_BASE_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${puterToken}`,
        'Content-Type': 'application/json',
        'Origin': 'https://puter.com',
      },
      body: JSON.stringify({
        interface: 'puter-chat-completion',
        driver,
        method: 'complete',
        args,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await response.json();
    
    // DEBUG: Log raw Puter response to see reasoning structure
    console.log('[Puter DEBUG] Raw response:', JSON.stringify(data, null, 2).substring(0, 3000));
    
    if (!data.success) {
      const errorMsg = data.error?.message || data.error || 'Puter API error';
      const error = new Error(errorMsg);
      error.isRateLimit = isRateLimitError(errorMsg);
      throw error;
    }
    return data.result;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Request timeout after ${API_TIMEOUT_MS / 1000}s - thinking models may need more time`);
    }
    throw err;
  }
}

// Streaming version of callPuter - uses true streaming with readable stream
async function callPuterStream(messages, modelId, puterToken, options = {}, onChunk) {
  const hasTools = !!(options.tools && options.tools.length > 0);
  let { driver, model } = getDriverAndModel(modelId, hasTools);
  
  // Check if thinking is requested and model supports it
  const wantsThinking = options.thinking_budget && options.thinking_budget > 0;
  const thinkingModel = wantsThinking ? getThinkingModel(modelId) : null;
  
  if (thinkingModel) {
    // Override to use the :thinking variant
    model = `openrouter:${thinkingModel}`;
    console.log(`[Puter Stream] Using thinking model variant: ${model}`);
  }
  
  const args = { messages, model, stream: true };
  if (options.max_tokens) args.max_tokens = options.max_tokens;
  if (options.temperature !== undefined) args.temperature = options.temperature;
  if (options.tools) args.tools = options.tools;
  if (options.tool_choice) args.tool_choice = options.tool_choice;
  args.include_reasoning = true;
  
  // Enable extended thinking for supported models
  if (thinkingModel || supportsThinking(modelId)) {
    const thinkingBudget = options.thinking_budget || 10000;
    args.thinking = {
      type: 'enabled',
      budget_tokens: thinkingBudget
    };
    console.log(`[Puter Stream] Extended thinking enabled for ${modelId} with budget: ${thinkingBudget}`);
  }

  console.log(`[Puter] Streaming request to ${driver} with model ${model}`);

  // Use AbortController for timeout (longer for streaming)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS * 2); // 240s for streaming

  const response = await fetch(PUTER_BASE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${puterToken}`,
      'Content-Type': 'application/json',
      'Origin': 'https://puter.com',
    },
    body: JSON.stringify({
      interface: 'puter-chat-completion',
      driver,
      method: 'complete',
      args,
    }),
    signal: controller.signal,
  });
  clearTimeout(timeoutId); // Clear once we get initial response

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Puter API error: ${response.status} - ${errorText}`);
  }

  // Check content-type to determine if it's a streaming response
  const contentType = response.headers.get('content-type') || '';
  
  // If it's a JSON response (non-streaming fallback), handle it
  if (contentType.includes('application/json')) {
    const data = await response.json();
    if (data.success === false || data.error) {
      throw new Error(data.error?.message || data.error || 'Puter API error');
    }
    // Non-streaming response - extract and send as single chunk
    const content = extractContent(data.result || data);
    const reasoning = extractReasoning(data.result || data);
    if (reasoning) onChunk({ type: 'reasoning', text: reasoning });
    if (content) onChunk({ type: 'text', text: content });
    return;
  }

  // True streaming - read the response body as a stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      
      // Process complete lines from buffer
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === '%') continue;

        try {
          const data = JSON.parse(trimmed);
          
          // Check for error in stream
          if (data.success === false || data.error) {
            throw new Error(data.error?.message || data.error || 'Stream error');
          }
          
          // Handle streaming chunks
          if (data.type === 'text' && data.text) {
            onChunk({ type: 'text', text: data.text });
          } else if (data.type === 'reasoning' && (data.reasoning || data.text)) {
            onChunk({ type: 'reasoning', text: data.reasoning || data.text });
          } else if (data.type === 'tool_use') {
            // Handle tool call in stream
            onChunk({ 
              type: 'tool_use', 
              id: data.id,
              name: data.name,
              arguments: typeof data.input === 'string' ? data.input : JSON.stringify(data.input || {})
            });
          }
        } catch (parseError) {
          // Skip non-JSON lines
          if (parseError instanceof SyntaxError) continue;
          throw parseError;
        }
      }
    }

    // Process any remaining data in buffer
    if (buffer.trim() && buffer.trim() !== '%') {
      try {
        const data = JSON.parse(buffer.trim());
        if (data.type === 'text' && data.text) {
          onChunk({ type: 'text', text: data.text });
        } else if (data.type === 'reasoning' && (data.reasoning || data.text)) {
          onChunk({ type: 'reasoning', text: data.reasoning || data.text });
        } else if (data.type === 'tool_use') {
          onChunk({ 
            type: 'tool_use', 
            id: data.id,
            name: data.name,
            arguments: typeof data.input === 'string' ? data.input : JSON.stringify(data.input || {})
          });
        }
      } catch (e) {
        // Ignore parse errors for final buffer
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Call Puter with key rotation on rate limit errors - O(1) for successful requests
async function callPuterWithRotation(messages, modelId, userKeys, systemKeys, options = {}) {
  // User keys take priority, then system keys
  const allKeys = userKeys && userKeys.length > 0 ? [...userKeys] : [...(systemKeys || [])];
  if (allKeys.length === 0) {
    throw new Error('No API keys configured');
  }

  // Load daily blocked keys from DB once per day (amortized O(1))
  await keyPool.loadDailyBlockedFromDB();

  let lastError = null;
  let usedKey = null;
  let startIndex = 0;
  
  // O(1) per attempt - just get next available key
  for (let attempt = 0; attempt < allKeys.length; attempt++) {
    const result = keyPool.getAvailableKey(allKeys, startIndex);
    if (!result) {
      throw new Error('All API keys are temporarily unavailable due to rate limits. Please try again later.');
    }
    
    usedKey = result.key;
    startIndex = result.index + 1; // Start from next key on retry
    
    try {
      console.log(`[O(1)] Attempt ${attempt + 1}: Using key index ${result.index}`);
      const apiResult = await callPuter(messages, modelId, usedKey, options);
      return { result: apiResult, usedKey };
    } catch (error) {
      lastError = error;
      console.error(`Key index ${result.index} failed:`, error.message);
      
      if (error.isRateLimit) {
        markKeyFailed(usedKey);
        if (isUsageLimitedError(error.message)) {
          await markKeyUsageLimited(usedKey);
        }
        continue;
      }
      throw error;
    }
  }
  
  throw lastError || new Error('All API keys failed');
}

function extractContent(result) {
  // Check message.content
  if (result.message?.content != null) {
    if (typeof result.message.content === 'string') {
      return result.message.content;
    }
    if (Array.isArray(result.message.content)) {
      return result.message.content.map(c => c.text || '').join('');
    }
  }
  // Check choices[0].message.content
  if (result.choices?.[0]?.message?.content != null) {
    return result.choices[0].message.content;
  }
  if (typeof result === 'string') return result;
  return null;  // Return null instead of empty string for tool call compatibility
}

// Extract reasoning/thinking content from response
function extractReasoning(result) {
  // OpenRouter format: reasoning field in message or choices
  const reasoning = result.message?.reasoning 
    || result.choices?.[0]?.message?.reasoning
    || result.reasoning;
  
  if (reasoning) return reasoning;
  
  // DeepSeek native format: reasoning_content
  const reasoningContent = result.message?.reasoning_content 
    || result.choices?.[0]?.message?.reasoning_content
    || result.reasoning_content;
  
  if (reasoningContent) return reasoningContent;
  
  // Check reasoning_details array (OpenRouter extended thinking format)
  const reasoningDetails = result.message?.reasoning_details
    || result.choices?.[0]?.message?.reasoning_details;
  if (reasoningDetails && Array.isArray(reasoningDetails) && reasoningDetails.length > 0) {
    return reasoningDetails.map(d => d.text || '').join('\n');
  }
  
  // Check for thinking in content (some models wrap it in <think> tags)
  const content = extractContent(result);
  if (content && content.includes('<think>')) {
    const match = content.match(/<think>([\s\S]*?)<\/think>/);
    if (match) return match[1].trim();
  }
  
  return null;
}

// Remove <think> tags from content
function removeThinkTags(content) {
  if (!content || typeof content !== 'string') return content;
  return content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

// Add thinking system prompt for any model when thinking_budget is provided
function addThinkingSystemPrompt(messages, thinkingBudget) {
  if (!thinkingBudget || thinkingBudget <= 0) return messages;
  
  // Map thinking budget to qualitative guidance
  // This helps non-thinking models understand how much to think
  let thinkingGuidance = '';
  if (thinkingBudget < 2000) {
    thinkingGuidance = 'Keep your thinking concise and focused (around 100-200 words).';
  } else if (thinkingBudget < 5000) {
    thinkingGuidance = 'Think through the problem step-by-step with moderate detail (around 200-400 words).';
  } else if (thinkingBudget < 10000) {
    thinkingGuidance = 'Think deeply and thoroughly, exploring multiple angles (around 400-800 words).';
  } else {
    thinkingGuidance = 'Think extensively and comprehensively, considering all aspects in great detail (800+ words).';
  }
  
  const thinkingInstruction = `IMPORTANT: You have extended thinking enabled. When solving problems or answering questions, show your reasoning process by wrapping your step-by-step thoughts in <think></think> tags before providing your final answer. ${thinkingGuidance}`;
  
  // Check if there's already a system message
  const firstSystemIndex = messages.findIndex(m => m.role === 'system');
  
  if (firstSystemIndex !== -1) {
    // Merge with existing system prompt
    const updatedMessages = [...messages];
    updatedMessages[firstSystemIndex] = {
      ...updatedMessages[firstSystemIndex],
      content: `${updatedMessages[firstSystemIndex].content}\n\n${thinkingInstruction}`
    };
    return updatedMessages;
  } else {
    // Add new system message at the beginning
    return [{
      role: 'system',
      content: thinkingInstruction
    }, ...messages];
  }
}

function extractUsage(result) {
  const usage = result.usage;
  
  if (Array.isArray(usage)) {
    const prompt = usage.find(u => u.type === 'prompt')?.amount || 0;
    const completion = usage.find(u => u.type === 'completion')?.amount || 0;
    return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
  }
  
  if (usage?.input_tokens !== undefined) {
    return {
      prompt_tokens: usage.input_tokens || 0,
      completion_tokens: usage.output_tokens || 0,
      total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
    };
  }
  
  if (usage?.prompt_tokens !== undefined) {
    return {
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
    };
  }
  
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

function getProvider(modelId) {
  if (modelId.startsWith('gpt-') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4')) {
    return 'openai';
  }
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('deepseek')) return 'deepseek';
  if (modelId.startsWith('mistral')) return 'mistral';
  if (modelId.startsWith('gemini')) return 'google';
  if (modelId.startsWith('grok')) return 'xai';
  if (modelId.startsWith('openrouter:')) return 'openrouter';
  if (modelId.startsWith('togetherai:')) return 'together';
  return 'unknown';
}

function puterToOpenAI(puterResult, model) {
  let content = extractContent(puterResult);
  const reasoning = extractReasoning(puterResult);
  const finishReason = puterResult.finish_reason || puterResult.finishReason || 'stop';

  // Remove <think> tags from content (they're extracted to reasoning_content)
  if (content && typeof content === 'string') {
    content = removeThinkTags(content);
  }

  // Build the assistant message
  const message = { role: 'assistant', content: content || null };
  
  // Add reasoning/thinking content if present (OpenAI-compatible extension)
  if (reasoning) {
    message.reasoning_content = reasoning;
  }
  
  // Handle tool calls in response
  const rawToolCalls = puterResult.message?.tool_calls || 
                       puterResult.choices?.[0]?.message?.tool_calls ||
                       puterResult.tool_calls;
  if (rawToolCalls && rawToolCalls.length > 0) {
    // Normalize tool_calls to OpenAI format (remove 'index' field, ensure proper structure)
    message.tool_calls = rawToolCalls.map((tc, idx) => ({
      id: tc.id || `call_${Date.now()}_${idx}`,
      type: tc.type || 'function',
      function: {
        name: tc.function?.name || tc.name,
        arguments: typeof tc.function?.arguments === 'string' 
          ? tc.function.arguments 
          : JSON.stringify(tc.function?.arguments || tc.arguments || {})
      }
    }));
    message.content = message.content || null;  // Content can be null when there are tool calls
  }

  const hasToolCalls = message.tool_calls && message.tool_calls.length > 0;

  const response = {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message,
      finish_reason: hasToolCalls ? 'tool_calls' : finishReason,
    }],
    usage: extractUsage(puterResult),
  };
  
  return response;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Puter-Token');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Method not allowed' } });

  let user = null;
  let model = null;
  
  // Check for direct Puter token - if provided, use it directly without our auth
  const puterToken = req.headers['x-puter-token'];

  try {
    const authHeader = req.headers.authorization || req.headers['x-api-key'] || '';
    const apiKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    
    // If Puter token is provided, we can skip our API key auth
    if (!apiKey && !puterToken) {
      return res.status(401).json({ error: { message: 'API key required' } });
    }

    // If we have an API key, validate it; otherwise create a pseudo-user for Puter token
    if (apiKey) {
      user = await getUserByApiKey(apiKey);
      if (!user) {
        return res.status(401).json({ error: { message: 'Invalid API key' } });
      }
    } else if (puterToken) {
      // Pseudo-user for direct Puter token usage (no rate limiting, no logging to our DB)
      user = { id: 'puter-direct', email: 'puter-token-user', puterKeys: [] };
    }

    const { stream, temperature, max_tokens, tools, tool_choice, thinking_budget } = req.body;
    model = req.body.model;
    const provider = getProvider(model);

    // DEBUG: Log raw incoming request
    console.log('\n========== INCOMING REQUEST ==========');
    console.log('Model:', model);
    console.log('Stream:', stream);
    console.log('Tools:', tools ? JSON.stringify(tools, null, 2) : 'none');
    console.log('Tool Choice:', tool_choice);
    console.log('ALL BODY KEYS:', Object.keys(req.body));
    console.log('FULL BODY:', JSON.stringify(req.body, null, 2).substring(0, 5000));
    console.log('Raw Messages:', JSON.stringify(req.body.messages, null, 2));
    console.log('=======================================\n');

    // Validate and sanitize messages
    let messages = req.body.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: { message: 'messages array is required' } });
    }
    
    // Check if any message contains multimodal content (images or files)
    const hasImages = messages.some(msg => 
      Array.isArray(msg.content) && hasImageContent(msg.content)
    );
    const hasFiles = messages.some(msg => 
      Array.isArray(msg.content) && hasFileContent(msg.content)
    );
    const hasMultimodal = hasImages || hasFiles;
    
    // Sanitize messages while preserving tool call structure, images, and files
    messages = messages.map(msg => {
      const sanitized = { role: msg.role || 'user' };
      
      // Handle tool role messages (tool results)
      if (msg.role === 'tool') {
        // Tool messages must have non-empty content
        const toolContent = normalizeContent(msg.content);
        sanitized.content = toolContent || '(empty result)';
        if (msg.tool_call_id) sanitized.tool_call_id = msg.tool_call_id;
        if (msg.name) sanitized.name = msg.name;
        return sanitized;
      }
      
      // Handle assistant messages with tool_calls
      if (msg.role === 'assistant' && msg.tool_calls) {
        sanitized.tool_calls = msg.tool_calls;
        // Content must be null or non-empty string for assistant messages with tool_calls
        const normalizedContent = msg.content != null ? normalizeContent(msg.content) : null;
        sanitized.content = normalizedContent === '' ? null : normalizedContent;
        return sanitized;
      }
      
      // Handle system messages
      if (msg.role === 'system') {
        sanitized.content = normalizeContent(msg.content);
        if (msg.name) sanitized.name = msg.name;
        return sanitized;
      }
      
      // Regular messages - normalize content, preserve multimodal content (images, files)
      // If content is array with images or files, preserve the multimodal format
      if (hasMultimodal && Array.isArray(msg.content) && (hasImageContent(msg.content) || hasFileContent(msg.content))) {
        sanitized.content = normalizeContent(msg.content, true); // preserveMultimodal = true
      } else {
        sanitized.content = normalizeContent(msg.content);
      }
      
      // Preserve name field if present
      if (msg.name) sanitized.name = msg.name;
      
      return sanitized;
    }).filter(msg => {
      // Keep tool messages, assistant messages with tool_calls, or messages with content
      if (msg.role === 'tool') return true;
      if (msg.role === 'assistant' && msg.tool_calls) return true;
      if (msg.role === 'system') return msg.content !== '';
      // For multimodal content (array), check if it has any content
      if (Array.isArray(msg.content)) return msg.content.length > 0;
      return msg.content !== '';
    });
    
    if (messages.length === 0) {
      return res.status(400).json({ error: { message: 'At least one message with content is required' } });
    }
    
    // Add thinking system prompt when thinking_budget is provided
    if (thinking_budget && thinking_budget > 0) {
      messages = addThinkingSystemPrompt(messages, thinking_budget);
    }

    // DEBUG: Log sanitized messages
    console.log('\n========== SANITIZED MESSAGES ==========');
    console.log(JSON.stringify(messages, null, 2));
    console.log('=========================================\n');

    console.log(`Request from ${user.email}: ${model}, stream=${stream}`);

    // If Puter token provided, try using it directly first
    if (puterToken) {
      console.log(`[Puter Token] Direct token provided, attempting direct call for ${model}`);
      try {
        const requestOptions = { temperature, max_tokens, tools, tool_choice, thinking_budget };
        
        if (stream) {
          // For streaming with Puter token, we need special handling for fallback
          return handleStreamWithTokenAndFallback(res, messages, model, puterToken, requestOptions, user, provider);
        }
        
        const result = await callPuter(messages, model, puterToken, requestOptions);
        const openAIResponse = puterToOpenAI(result, model);
        
        // Log usage only if we have a real user
        if (user.id !== 'puter-direct') {
          await logUsage(user.id, model, openAIResponse.usage, provider, true, null, 'puter-token');
        }
        
        return res.json(openAIResponse);
      } catch (puterError) {
        console.error(`[Puter Token] Direct token failed: ${puterError.message}`);
        // Fall back to system keys for any error (invalid, rate limited, usage limited, etc.)
        console.log('[Puter Token] Falling back to system keys...');
        
        // Get system keys for fallback
        let systemKeys = await getSystemKeys();
        if (systemKeys.length === 0 && process.env.PUTER_API_KEY) {
          systemKeys = [process.env.PUTER_API_KEY];
        }
        
        if (systemKeys.length === 0) {
          return res.status(500).json({ error: { message: `Puter token error: ${puterError.message}. No system keys available for fallback.` } });
        }
        
        // Try with system keys
        try {
          const requestOptions = { temperature, max_tokens, tools, tool_choice, thinking_budget };
          
          if (stream) {
            return handleStream(res, messages, model, [], systemKeys, requestOptions, user, provider);
          }
          
          const { result } = await callPuterWithRotation(messages, model, [], systemKeys, requestOptions);
          const openAIResponse = puterToOpenAI(result, model);
          
          if (user.id !== 'puter-direct') {
            await logUsage(user.id, model, openAIResponse.usage, provider, true, null, 'system-fallback');
          }
          
          return res.json(openAIResponse);
        } catch (fallbackError) {
          console.error(`[Puter Token Fallback] System keys also failed: ${fallbackError.message}`);
          return res.status(500).json({ error: { message: `Both Puter token and system keys failed. Original: ${puterError.message}. Fallback: ${fallbackError.message}` } });
        }
      }
    }

    const hasOwnKeys = user.puterKeys && user.puterKeys.length > 0;
    
    if (!hasOwnKeys) {
      const dailyUsed = await getDailyUsage(user);
      if (dailyUsed >= FREE_DAILY_LIMIT) {
        await logUsage(user.id, model, null, provider, false, 'Daily limit exceeded');
        return res.status(403).json({ 
          error: { 
            message: `Daily free limit (${FREE_DAILY_LIMIT} requests) reached. Add your own Puter API key for unlimited access.`,
            code: 'DAILY_LIMIT_EXCEEDED',
            dailyUsed,
            dailyLimit: FREE_DAILY_LIMIT
          } 
        });
      }
    }

    // Get system keys from Firestore, fallback to env variable
    let systemKeys = await getSystemKeys();
    if (systemKeys.length === 0 && process.env.PUTER_API_KEY) {
      systemKeys = [process.env.PUTER_API_KEY];
    }
    const userKeys = hasOwnKeys ? user.puterKeys : [];

    if (systemKeys.length === 0 && userKeys.length === 0) {
      return res.status(500).json({ error: { message: 'No Puter API key configured' } });
    }

    if (!hasOwnKeys) {
      await incrementUsage(user.id);
    }

    const requestOptions = { temperature, max_tokens, tools, tool_choice, thinking_budget };

    if (stream) {
      return handleStream(res, messages, model, userKeys, systemKeys, requestOptions, user, provider);
    }

    // Non-streaming request with key rotation
    const { result, usedKey } = await callPuterWithRotation(messages, model, userKeys, systemKeys, requestOptions);
    const openAIResponse = puterToOpenAI(result, model);
    
    // Log successful usage
    await logUsage(user.id, model, openAIResponse.usage, provider, true, null, hasOwnKeys ? usedKey : null);
    
    return res.json(openAIResponse);

  } catch (error) {
    console.error('Chat error:', error);
    
    // Log failed usage
    if (user && model) {
      await logUsage(user.id, model, null, getProvider(model), false, error.message);
    }
    
    return res.status(500).json({ error: { message: error.message } });
  }
}

async function handleStream(res, messages, model, userKeys, systemKeys, options = {}, user, provider) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const id = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  
  // Get the keys to use - user keys take priority
  const hasUserKeys = userKeys && userKeys.length > 0;
  const allKeys = hasUserKeys ? [...userKeys] : [...(systemKeys || [])];
  
  if (allKeys.length === 0) {
    res.write(`data: ${JSON.stringify({ error: { message: 'No API keys configured' } })}\n\n`);
    res.end();
    return;
  }

  // Load daily blocked keys from DB once per day (amortized O(1))
  await keyPool.loadDailyBlockedFromDB();

  console.log(`[Stream] User has ${userKeys?.length || 0} personal keys, ${systemKeys?.length || 0} system keys. Using: ${hasUserKeys ? 'USER' : 'SYSTEM'} keys`);

  let totalContent = '';
  let totalReasoning = '';
  let lastError = null;
  let usedKey = null;
  let success = false;
  let startIndex = 0;

  // O(1) per attempt - just get next available key
  for (let attempt = 0; attempt < allKeys.length && !success; attempt++) {
    const keyResult = keyPool.getAvailableKey(allKeys, startIndex);
    if (!keyResult) {
      res.write(`data: ${JSON.stringify({ error: { message: 'All API keys are temporarily unavailable due to rate limits. Please try again later.' } })}\n\n`);
      res.end();
      return;
    }
    
    usedKey = keyResult.key;
    startIndex = keyResult.index + 1;
    console.log(`[Stream O(1)] Attempt ${attempt + 1}: Using key index ${keyResult.index}`);

    // Reset content for retry
    totalContent = '';
    totalReasoning = '';
    let toolCalls = [];
    let toolCallIndex = 0;

    try {
      // Only send initial role chunk on first attempt
      if (attempt === 0) {
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}\n\n`);
      }

      // Track if we're inside <think> tags for streaming
      let insideThinkTag = false;
      let tagBuffer = ''; // Small buffer only for detecting partial tags

      // Call Puter with streaming, process chunks via callback
      await callPuterStream(messages, model, usedKey, options, (chunk) => {
        if (chunk.type === 'text' && chunk.text) {
          // Combine any buffered partial tag with new text
          let text = tagBuffer + chunk.text;
          tagBuffer = '';
          
          // Process text character by character for real-time streaming
          while (text.length > 0) {
            if (!insideThinkTag) {
              // Look for opening <think> tag
              const thinkStart = text.indexOf('<think>');
              if (thinkStart !== -1) {
                // Send content before <think> tag immediately
                const beforeThink = text.substring(0, thinkStart);
                if (beforeThink) {
                  totalContent += beforeThink;
                  res.write(`data: ${JSON.stringify({ 
                    id, object: 'chat.completion.chunk', created, model, 
                    choices: [{ index: 0, delta: { content: beforeThink }, finish_reason: null }] 
                  })}\n\n`);
                }
                insideThinkTag = true;
                text = text.substring(thinkStart + 7); // Skip '<think>'
              } else {
                // Check for partial <think> tag at end (e.g., "<thi", "<think")
                let partialMatch = '';
                for (let len = Math.min(6, text.length); len > 0; len--) {
                  const suffix = text.substring(text.length - len);
                  if ('<think>'.startsWith(suffix)) {
                    partialMatch = suffix;
                    break;
                  }
                }
                
                if (partialMatch) {
                  // Buffer the potential partial tag, send the rest
                  const toSend = text.substring(0, text.length - partialMatch.length);
                  if (toSend) {
                    totalContent += toSend;
                    res.write(`data: ${JSON.stringify({ 
                      id, object: 'chat.completion.chunk', created, model, 
                      choices: [{ index: 0, delta: { content: toSend }, finish_reason: null }] 
                    })}\n\n`);
                  }
                  tagBuffer = partialMatch;
                } else {
                  // No tag, send all text immediately
                  totalContent += text;
                  res.write(`data: ${JSON.stringify({ 
                    id, object: 'chat.completion.chunk', created, model, 
                    choices: [{ index: 0, delta: { content: text }, finish_reason: null }] 
                  })}\n\n`);
                }
                text = '';
              }
            } else {
              // Inside <think> tag - stream reasoning content in real-time
              const thinkEnd = text.indexOf('</think>');
              if (thinkEnd !== -1) {
                // Send thinking content before closing tag immediately
                const thinkContent = text.substring(0, thinkEnd);
                if (thinkContent) {
                  totalReasoning += thinkContent;
                  res.write(`data: ${JSON.stringify({ 
                    id, object: 'chat.completion.chunk', created, model, 
                    choices: [{ index: 0, delta: { reasoning_content: thinkContent }, finish_reason: null }] 
                  })}\n\n`);
                }
                insideThinkTag = false;
                text = text.substring(thinkEnd + 8); // Skip '</think>'
              } else {
                // Check for partial </think> tag at end
                let partialMatch = '';
                for (let len = Math.min(7, text.length); len > 0; len--) {
                  const suffix = text.substring(text.length - len);
                  if ('</think>'.startsWith(suffix)) {
                    partialMatch = suffix;
                    break;
                  }
                }
                
                if (partialMatch) {
                  // Buffer the potential partial tag, stream the rest as reasoning immediately
                  const toSend = text.substring(0, text.length - partialMatch.length);
                  if (toSend) {
                    totalReasoning += toSend;
                    res.write(`data: ${JSON.stringify({ 
                      id, object: 'chat.completion.chunk', created, model, 
                      choices: [{ index: 0, delta: { reasoning_content: toSend }, finish_reason: null }] 
                    })}\n\n`);
                  }
                  tagBuffer = partialMatch;
                } else {
                  // No closing tag yet, stream all as reasoning immediately
                  totalReasoning += text;
                  res.write(`data: ${JSON.stringify({ 
                    id, object: 'chat.completion.chunk', created, model, 
                    choices: [{ index: 0, delta: { reasoning_content: text }, finish_reason: null }] 
                  })}\n\n`);
                }
                text = '';
              }
            }
          }
        } else if (chunk.type === 'reasoning' && chunk.text) {
          totalReasoning += chunk.text;
          res.write(`data: ${JSON.stringify({ 
            id, object: 'chat.completion.chunk', created, model, 
            choices: [{ index: 0, delta: { reasoning_content: chunk.text }, finish_reason: null }] 
          })}\n\n`);
        } else if (chunk.type === 'tool_use') {
          // OpenAI streaming format for tool calls
          const toolCall = {
            index: toolCallIndex,
            id: chunk.id,
            type: 'function',
            function: { name: chunk.name, arguments: chunk.arguments }
          };
          toolCalls.push(toolCall);
          
          // Send tool call chunk in OpenAI format
          res.write(`data: ${JSON.stringify({ 
            id, object: 'chat.completion.chunk', created, model, 
            choices: [{ index: 0, delta: { tool_calls: [toolCall] }, finish_reason: null }] 
          })}\n\n`);
          toolCallIndex++;
        } else if (chunk.message?.content) {
          const content = removeThinkTags(chunk.message.content);
          totalContent = content;
          res.write(`data: ${JSON.stringify({ 
            id, object: 'chat.completion.chunk', created, model, 
            choices: [{ index: 0, delta: { content }, finish_reason: null }] 
          })}\n\n`);
        }
      });
      
      success = true;
      
      // Send final chunk with appropriate finish_reason
      const finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop';
      res.write(`data: ${JSON.stringify({ 
        id, object: 'chat.completion.chunk', created, model, 
        choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
        usage: { prompt_tokens: 0, completion_tokens: Math.ceil(totalContent.length / 4), total_tokens: Math.ceil(totalContent.length / 4) }
      })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      
      // Log usage (approximate)
      await logUsage(user.id, model, { prompt_tokens: 0, completion_tokens: Math.ceil(totalContent.length / 4), total_tokens: Math.ceil(totalContent.length / 4) }, provider, true, null, hasUserKeys ? usedKey : null);
    } catch (error) {
      lastError = error;
      console.error(`[Stream] Key ${usedKey.substring(0, 20)}... failed:`, error.message);
      
      if (isRateLimitError(error.message)) {
        markKeyFailed(usedKey);
        // If it's a usage-limited error, mark for the whole day
        if (isUsageLimitedError(error.message)) {
          await markKeyUsageLimited(usedKey);
        }
        // Continue to try next key
        continue;
      }
      // Non-rate-limit error, don't try other keys
      break;
    }
  }

  if (!success) {
    // Log failed streaming usage
    await logUsage(user.id, model, null, provider, false, lastError?.message || 'All keys failed');
    
    res.write(`data: ${JSON.stringify({ error: { message: lastError?.message || 'All API keys failed' } })}\n\n`);
    res.end();
  }
}

// Streaming handler for direct Puter token (no key rotation)
async function handleStreamWithToken(res, messages, model, puterToken, options = {}, user, provider) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const id = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  
  let totalContent = '';
  let totalReasoning = '';
  let toolCalls = [];
  let toolCallIndex = 0;

  try {
    // Send initial role chunk
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}\n\n`);

    let insideThinkTag = false;
    let tagBuffer = '';

    await callPuterStream(messages, model, puterToken, options, (chunk) => {
      if (chunk.type === 'text' && chunk.text) {
        let text = tagBuffer + chunk.text;
        tagBuffer = '';
        
        while (text.length > 0) {
          if (!insideThinkTag) {
            const thinkStart = text.indexOf('<think>');
            if (thinkStart !== -1) {
              const beforeThink = text.substring(0, thinkStart);
              if (beforeThink) {
                totalContent += beforeThink;
                res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: beforeThink }, finish_reason: null }] })}\n\n`);
              }
              insideThinkTag = true;
              text = text.substring(thinkStart + 7);
            } else {
              let partialMatch = '';
              for (let len = Math.min(6, text.length); len > 0; len--) {
                const suffix = text.substring(text.length - len);
                if ('<think>'.startsWith(suffix)) { partialMatch = suffix; break; }
              }
              if (partialMatch) {
                const toSend = text.substring(0, text.length - partialMatch.length);
                if (toSend) {
                  totalContent += toSend;
                  res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: toSend }, finish_reason: null }] })}\n\n`);
                }
                tagBuffer = partialMatch;
              } else {
                totalContent += text;
                res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`);
              }
              text = '';
            }
          } else {
            const thinkEnd = text.indexOf('</think>');
            if (thinkEnd !== -1) {
              const thinkContent = text.substring(0, thinkEnd);
              if (thinkContent) {
                totalReasoning += thinkContent;
                res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { reasoning_content: thinkContent }, finish_reason: null }] })}\n\n`);
              }
              insideThinkTag = false;
              text = text.substring(thinkEnd + 8);
            } else {
              let partialMatch = '';
              for (let len = Math.min(7, text.length); len > 0; len--) {
                const suffix = text.substring(text.length - len);
                if ('</think>'.startsWith(suffix)) { partialMatch = suffix; break; }
              }
              if (partialMatch) {
                const toSend = text.substring(0, text.length - partialMatch.length);
                if (toSend) {
                  totalReasoning += toSend;
                  res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { reasoning_content: toSend }, finish_reason: null }] })}\n\n`);
                }
                tagBuffer = partialMatch;
              } else {
                totalReasoning += text;
                res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { reasoning_content: text }, finish_reason: null }] })}\n\n`);
              }
              text = '';
            }
          }
        }
      } else if (chunk.type === 'reasoning' && chunk.text) {
        totalReasoning += chunk.text;
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { reasoning_content: chunk.text }, finish_reason: null }] })}\n\n`);
      } else if (chunk.type === 'tool_use') {
        const toolCall = { index: toolCallIndex, id: chunk.id, type: 'function', function: { name: chunk.name, arguments: chunk.arguments } };
        toolCalls.push(toolCall);
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { tool_calls: [toolCall] }, finish_reason: null }] })}\n\n`);
        toolCallIndex++;
      } else if (chunk.message?.content) {
        const content = removeThinkTags(chunk.message.content);
        totalContent = content;
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
      }
    });
    
    const finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop';
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage: { prompt_tokens: 0, completion_tokens: Math.ceil(totalContent.length / 4), total_tokens: Math.ceil(totalContent.length / 4) } })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
    
    if (user.id !== 'puter-direct') {
      await logUsage(user.id, model, { prompt_tokens: 0, completion_tokens: Math.ceil(totalContent.length / 4), total_tokens: Math.ceil(totalContent.length / 4) }, provider, true, null, 'puter-token');
    }
  } catch (error) {
    console.error(`[Stream Puter Token] Failed:`, error.message);
    if (user.id !== 'puter-direct') {
      await logUsage(user.id, model, null, provider, false, error.message);
    }
    res.write(`data: ${JSON.stringify({ error: { message: error.message } })}\n\n`);
    res.end();
  }
}

// Streaming handler for direct Puter token with automatic fallback to system keys
async function handleStreamWithTokenAndFallback(res, messages, model, puterToken, options = {}, user, provider) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const id = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  
  let totalContent = '';
  let totalReasoning = '';
  let toolCalls = [];
  let toolCallIndex = 0;
  let streamStarted = false;

  try {
    // Send initial role chunk
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}\n\n`);
    streamStarted = true;

    let insideThinkTag = false;
    let tagBuffer = '';

    await callPuterStream(messages, model, puterToken, options, (chunk) => {
      if (chunk.type === 'text' && chunk.text) {
        let text = tagBuffer + chunk.text;
        tagBuffer = '';
        
        while (text.length > 0) {
          if (!insideThinkTag) {
            const thinkStart = text.indexOf('<think>');
            if (thinkStart !== -1) {
              const beforeThink = text.substring(0, thinkStart);
              if (beforeThink) {
                totalContent += beforeThink;
                res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: beforeThink }, finish_reason: null }] })}\n\n`);
              }
              insideThinkTag = true;
              text = text.substring(thinkStart + 7);
            } else {
              let partialMatch = '';
              for (let len = Math.min(6, text.length); len > 0; len--) {
                const suffix = text.substring(text.length - len);
                if ('<think>'.startsWith(suffix)) { partialMatch = suffix; break; }
              }
              if (partialMatch) {
                const toSend = text.substring(0, text.length - partialMatch.length);
                if (toSend) {
                  totalContent += toSend;
                  res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: toSend }, finish_reason: null }] })}\n\n`);
                }
                tagBuffer = partialMatch;
              } else {
                totalContent += text;
                res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`);
              }
              text = '';
            }
          } else {
            const thinkEnd = text.indexOf('</think>');
            if (thinkEnd !== -1) {
              const thinkContent = text.substring(0, thinkEnd);
              if (thinkContent) {
                totalReasoning += thinkContent;
                res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { reasoning_content: thinkContent }, finish_reason: null }] })}\n\n`);
              }
              insideThinkTag = false;
              text = text.substring(thinkEnd + 8);
            } else {
              let partialMatch = '';
              for (let len = Math.min(7, text.length); len > 0; len--) {
                const suffix = text.substring(text.length - len);
                if ('</think>'.startsWith(suffix)) { partialMatch = suffix; break; }
              }
              if (partialMatch) {
                const toSend = text.substring(0, text.length - partialMatch.length);
                if (toSend) {
                  totalReasoning += toSend;
                  res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { reasoning_content: toSend }, finish_reason: null }] })}\n\n`);
                }
                tagBuffer = partialMatch;
              } else {
                totalReasoning += text;
                res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { reasoning_content: text }, finish_reason: null }] })}\n\n`);
              }
              text = '';
            }
          }
        }
      } else if (chunk.type === 'reasoning' && chunk.text) {
        totalReasoning += chunk.text;
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { reasoning_content: chunk.text }, finish_reason: null }] })}\n\n`);
      } else if (chunk.type === 'tool_use') {
        const toolCall = { index: toolCallIndex, id: chunk.id, type: 'function', function: { name: chunk.name, arguments: chunk.arguments } };
        toolCalls.push(toolCall);
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { tool_calls: [toolCall] }, finish_reason: null }] })}\n\n`);
        toolCallIndex++;
      } else if (chunk.message?.content) {
        const content = removeThinkTags(chunk.message.content);
        totalContent = content;
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
      }
    });
    
    const finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop';
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage: { prompt_tokens: 0, completion_tokens: Math.ceil(totalContent.length / 4), total_tokens: Math.ceil(totalContent.length / 4) } })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
    
    if (user.id !== 'puter-direct') {
      await logUsage(user.id, model, { prompt_tokens: 0, completion_tokens: Math.ceil(totalContent.length / 4), total_tokens: Math.ceil(totalContent.length / 4) }, provider, true, null, 'puter-token');
    }
  } catch (error) {
    console.error(`[Stream Puter Token] Failed:`, error.message);
    console.log('[Stream Puter Token] Attempting fallback to system keys...');
    
    // Get system keys for fallback
    let systemKeys = await getSystemKeys();
    if (systemKeys.length === 0 && process.env.PUTER_API_KEY) {
      systemKeys = [process.env.PUTER_API_KEY];
    }
    
    if (systemKeys.length === 0) {
      if (user.id !== 'puter-direct') {
        await logUsage(user.id, model, null, provider, false, error.message);
      }
      if (!streamStarted) {
        res.write(`data: ${JSON.stringify({ error: { message: `Puter token failed: ${error.message}. No system keys for fallback.` } })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ error: { message: error.message } })}\n\n`);
      }
      res.end();
      return;
    }
    
    // If stream already started with content, we can't cleanly fallback - just error
    if (totalContent.length > 0 || totalReasoning.length > 0) {
      if (user.id !== 'puter-direct') {
        await logUsage(user.id, model, null, provider, false, error.message);
      }
      res.write(`data: ${JSON.stringify({ error: { message: `Stream interrupted: ${error.message}` } })}\n\n`);
      res.end();
      return;
    }
    
    // Fallback to system keys - use the regular handleStream which handles key rotation
    console.log('[Stream Puter Token] Falling back to system keys for streaming...');
    
    // Note: We already sent the initial role chunk, so handleStream will handle the rest
    // We need to continue the stream, not start a new one
    await keyPool.loadDailyBlockedFromDB();
    
    let fallbackSuccess = false;
    let lastFallbackError = null;
    let startIndex = 0;
    
    for (let attempt = 0; attempt < systemKeys.length && !fallbackSuccess; attempt++) {
      const keyResult = keyPool.getAvailableKey(systemKeys, startIndex);
      if (!keyResult) break;
      
      const usedKey = keyResult.key;
      startIndex = keyResult.index + 1;
      console.log(`[Stream Fallback] Attempt ${attempt + 1}: Using system key index ${keyResult.index}`);
      
      totalContent = '';
      totalReasoning = '';
      toolCalls = [];
      toolCallIndex = 0;
      
      try {
        let insideThinkTag = false;
        let tagBuffer = '';
        
        await callPuterStream(messages, model, usedKey, options, (chunk) => {
          if (chunk.type === 'text' && chunk.text) {
            let text = tagBuffer + chunk.text;
            tagBuffer = '';
            
            while (text.length > 0) {
              if (!insideThinkTag) {
                const thinkStart = text.indexOf('<think>');
                if (thinkStart !== -1) {
                  const beforeThink = text.substring(0, thinkStart);
                  if (beforeThink) {
                    totalContent += beforeThink;
                    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: beforeThink }, finish_reason: null }] })}\n\n`);
                  }
                  insideThinkTag = true;
                  text = text.substring(thinkStart + 7);
                } else {
                  let partialMatch = '';
                  for (let len = Math.min(6, text.length); len > 0; len--) {
                    const suffix = text.substring(text.length - len);
                    if ('<think>'.startsWith(suffix)) { partialMatch = suffix; break; }
                  }
                  if (partialMatch) {
                    const toSend = text.substring(0, text.length - partialMatch.length);
                    if (toSend) {
                      totalContent += toSend;
                      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: toSend }, finish_reason: null }] })}\n\n`);
                    }
                    tagBuffer = partialMatch;
                  } else {
                    totalContent += text;
                    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`);
                  }
                  text = '';
                }
              } else {
                const thinkEnd = text.indexOf('</think>');
                if (thinkEnd !== -1) {
                  const thinkContent = text.substring(0, thinkEnd);
                  if (thinkContent) {
                    totalReasoning += thinkContent;
                    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { reasoning_content: thinkContent }, finish_reason: null }] })}\n\n`);
                  }
                  insideThinkTag = false;
                  text = text.substring(thinkEnd + 8);
                } else {
                  let partialMatch = '';
                  for (let len = Math.min(7, text.length); len > 0; len--) {
                    const suffix = text.substring(text.length - len);
                    if ('</think>'.startsWith(suffix)) { partialMatch = suffix; break; }
                  }
                  if (partialMatch) {
                    const toSend = text.substring(0, text.length - partialMatch.length);
                    if (toSend) {
                      totalReasoning += toSend;
                      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { reasoning_content: toSend }, finish_reason: null }] })}\n\n`);
                    }
                    tagBuffer = partialMatch;
                  } else {
                    totalReasoning += text;
                    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { reasoning_content: text }, finish_reason: null }] })}\n\n`);
                  }
                  text = '';
                }
              }
            }
          } else if (chunk.type === 'reasoning' && chunk.text) {
            totalReasoning += chunk.text;
            res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { reasoning_content: chunk.text }, finish_reason: null }] })}\n\n`);
          } else if (chunk.type === 'tool_use') {
            const toolCall = { index: toolCallIndex, id: chunk.id, type: 'function', function: { name: chunk.name, arguments: chunk.arguments } };
            toolCalls.push(toolCall);
            res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { tool_calls: [toolCall] }, finish_reason: null }] })}\n\n`);
            toolCallIndex++;
          } else if (chunk.message?.content) {
            const content = removeThinkTags(chunk.message.content);
            totalContent = content;
            res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
          }
        });
        
        fallbackSuccess = true;
        
        const finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop';
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage: { prompt_tokens: 0, completion_tokens: Math.ceil(totalContent.length / 4), total_tokens: Math.ceil(totalContent.length / 4) } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        
        if (user.id !== 'puter-direct') {
          await logUsage(user.id, model, { prompt_tokens: 0, completion_tokens: Math.ceil(totalContent.length / 4), total_tokens: Math.ceil(totalContent.length / 4) }, provider, true, null, 'system-fallback');
        }
      } catch (fallbackError) {
        lastFallbackError = fallbackError;
        console.error(`[Stream Fallback] Key failed:`, fallbackError.message);
        
        if (isRateLimitError(fallbackError.message)) {
          markKeyFailed(usedKey);
          if (isUsageLimitedError(fallbackError.message)) {
            await markKeyUsageLimited(usedKey);
          }
          continue;
        }
        break;
      }
    }
    
    if (!fallbackSuccess) {
      if (user.id !== 'puter-direct') {
        await logUsage(user.id, model, null, provider, false, lastFallbackError?.message || 'All fallback keys failed');
      }
      res.write(`data: ${JSON.stringify({ error: { message: lastFallbackError?.message || 'All system keys failed after Puter token failure' } })}\n\n`);
      res.end();
    }
  }
}
