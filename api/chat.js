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

// Track failed keys to avoid using them temporarily
const failedKeys = new Map(); // key -> timestamp of failure
const KEY_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown for failed keys

// Model to driver mapping - verified working models
const MODEL_DRIVERS = {
  // OpenAI models via openai-completion driver
  'gpt-5.1': 'openai-completion',
  'gpt-5': 'openai-completion',
  'gpt-5-mini': 'openai-completion',
  'gpt-4.1': 'openai-completion',
  'gpt-4o': 'openai-completion',
  'gpt-4o-mini': 'openai-completion',
  'o3': 'openai-completion',
  'o3-mini': 'openai-completion',
  'o1': 'openai-completion',
  'o1-mini': 'openai-completion',
  // Claude models via claude driver
  'claude-opus-4-5': { driver: 'claude', model: 'claude-opus-4-5-20251101' },
  'claude-opus-4.5': { driver: 'claude', model: 'claude-opus-4-5-20251101' },
  'claude-sonnet-4-5': { driver: 'claude', model: 'claude-sonnet-4-5-20250929' },
  'claude-sonnet-4.5': { driver: 'claude', model: 'claude-sonnet-4-5-20250929' },
  'claude-haiku-4-5': { driver: 'claude', model: 'claude-haiku-4-5-20251001' },
  'claude-haiku-4.5': { driver: 'claude', model: 'claude-haiku-4-5-20251001' },
  'claude-sonnet-4': { driver: 'claude', model: 'claude-sonnet-4-20250514' },
  'claude-opus-4': { driver: 'claude', model: 'claude-opus-4-20250514' },
  'claude-opus-4-1': { driver: 'claude', model: 'claude-opus-4-1-20250805' },
  'claude-3-5-sonnet': { driver: 'claude', model: 'claude-3-5-sonnet-20241022' },
  'claude-3-7-sonnet': { driver: 'claude', model: 'claude-3-7-sonnet-20250219' },
  'claude-3-haiku': { driver: 'claude', model: 'claude-3-haiku-20240307' },
  // DeepSeek models via deepseek driver
  'deepseek-chat': 'deepseek',
  'deepseek-reasoner': 'deepseek',
  // Mistral models via mistral driver
  'mistral-large': { driver: 'mistral', model: 'mistral-large-latest' },
  'mistral-medium': { driver: 'mistral', model: 'mistral-medium-latest' },
  'mistral-small': { driver: 'mistral', model: 'mistral-small-latest' },
};

// Normalize content - handle array format (Claude Code) vs string format
function normalizeContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
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

function getDriverAndModel(modelId, hasTools = false) {
  if (modelId.startsWith('openrouter:')) {
    return { driver: 'openrouter', model: modelId };
  }
  if (modelId.startsWith('togetherai:')) {
    return { driver: 'together-ai', model: modelId };
  }
  if (modelId.startsWith('gemini-')) {
    return { driver: 'openrouter', model: `openrouter:google/${modelId}` };
  }
  if (modelId.startsWith('grok-')) {
    return { driver: 'openrouter', model: `openrouter:x-ai/${modelId}` };
  }
  
  const mapping = MODEL_DRIVERS[modelId];
  
  // If request has tools and it's a Claude model, route through OpenRouter
  // because Puter's Claude driver may not support tool calling
  if (hasTools && modelId.startsWith('claude')) {
    // Map to OpenRouter model names (without date suffixes)
    const openRouterClaudeModels = {
      'claude-sonnet-4-5': 'anthropic/claude-sonnet-4.5',
      'claude-sonnet-4.5': 'anthropic/claude-sonnet-4.5',
      'claude-opus-4-5': 'anthropic/claude-opus-4.5',
      'claude-opus-4.5': 'anthropic/claude-opus-4.5',
      'claude-haiku-4-5': 'anthropic/claude-haiku-4.5',
      'claude-haiku-4.5': 'anthropic/claude-haiku-4.5',
      'claude-sonnet-4': 'anthropic/claude-sonnet-4',
      'claude-opus-4': 'anthropic/claude-opus-4',
      'claude-opus-4-1': 'anthropic/claude-opus-4.1',
      'claude-3-5-sonnet': 'anthropic/claude-3.5-sonnet',
      'claude-3-7-sonnet': 'anthropic/claude-3.7-sonnet',
      'claude-3-haiku': 'anthropic/claude-3-haiku',
    };
    const orModel = openRouterClaudeModels[modelId] || 'anthropic/claude-sonnet-4.5';
    return { driver: 'openrouter', model: `openrouter:${orModel}` };
  }
  
  if (!mapping) return { driver: 'openai-completion', model: modelId };
  if (typeof mapping === 'string') return { driver: mapping, model: modelId };
  return { driver: mapping.driver, model: mapping.model };
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

// Mark a key as failed
function markKeyFailed(key) {
  failedKeys.set(key, Date.now());
  console.log(`Marked key as failed (cooldown ${KEY_COOLDOWN_MS/1000}s): ${key.substring(0, 10)}...`);
}

// Get rotating key from available keys
function getRotatingKey(keys, requestId) {
  const availableKeys = getAvailableKeys(keys);
  if (availableKeys.length === 0) return null;
  
  let hash = 0;
  for (let i = 0; i < requestId.length; i++) {
    hash = ((hash << 5) - hash) + requestId.charCodeAt(i);
    hash |= 0;
  }
  return availableKeys[Math.abs(hash) % availableKeys.length];
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

async function callPuter(messages, modelId, puterToken, options = {}) {
  const hasTools = !!(options.tools && options.tools.length > 0);
  const { driver, model } = getDriverAndModel(modelId, hasTools);
  const args = { messages, model };
  if (options.max_tokens) args.max_tokens = options.max_tokens;
  if (options.temperature !== undefined) args.temperature = options.temperature;
  if (options.tools) args.tools = options.tools;
  if (options.tool_choice) args.tool_choice = options.tool_choice;

  // DEBUG: Log what we're sending to Puter
  console.log('\n========== PUTER REQUEST ==========');
  console.log('Driver:', driver);
  console.log('Model:', model);
  console.log('Has Tools:', !!options.tools, options.tools ? `(${options.tools.length} tools)` : '');
  console.log('Args keys:', Object.keys(args));
  console.log('====================================\n');

  const requestBody = {
    interface: 'puter-chat-completion',
    driver,
    method: 'complete',
    args,
  };
  
  console.log('FULL PUTER REQUEST BODY:', JSON.stringify(requestBody, null, 2).substring(0, 2000));

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
  });

  const data = await response.json();
  
  console.log('\n========== PUTER RESPONSE ==========');
  console.log('Success:', data.success);
  if (!data.success) {
    console.log('Error:', JSON.stringify(data.error, null, 2));
  } else {
    console.log('Result keys:', Object.keys(data.result || {}));
    console.log('Has tool_calls:', !!(data.result?.message?.tool_calls || data.result?.tool_calls || data.result?.choices?.[0]?.message?.tool_calls));
    console.log('Full result:', JSON.stringify(data.result, null, 2).substring(0, 2000));
  }
  console.log('=====================================\n');
  
  if (!data.success) {
    const errorMsg = data.error?.message || data.error || 'Puter API error';
    const error = new Error(errorMsg);
    error.isRateLimit = isRateLimitError(errorMsg);
    throw error;
  }
  return data.result;
}

// Call Puter with key rotation on rate limit errors
async function callPuterWithRotation(messages, modelId, userKeys, systemKeys, options = {}) {
  // User keys take priority, then system keys
  const allKeys = userKeys && userKeys.length > 0 ? [...userKeys] : [...(systemKeys || [])];
  let lastError = null;
  let usedKey = null;
  
  // Try each available key
  for (let attempt = 0; attempt < allKeys.length; attempt++) {
    const availableKeys = getAvailableKeys(allKeys);
    if (availableKeys.length === 0) {
      throw new Error('All API keys are temporarily unavailable due to rate limits. Please try again later.');
    }
    
    // Pick a key (rotate based on attempt number)
    usedKey = availableKeys[attempt % availableKeys.length];
    
    try {
      console.log(`Attempt ${attempt + 1}: Using key ${usedKey.substring(0, 10)}...`);
      const result = await callPuter(messages, modelId, usedKey, options);
      return { result, usedKey };
    } catch (error) {
      lastError = error;
      console.error(`Key ${usedKey.substring(0, 10)}... failed:`, error.message);
      
      if (error.isRateLimit) {
        markKeyFailed(usedKey);
        // Continue to try next key
        continue;
      }
      // Non-rate-limit error, don't try other keys
      throw error;
    }
  }
  
  // All keys failed
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
  const content = extractContent(puterResult);
  const finishReason = puterResult.finish_reason || puterResult.finishReason || 'stop';

  // Build the assistant message
  const message = { role: 'assistant', content: content || null };
  
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

  return {
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
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Method not allowed' } });

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

    const { stream, temperature, max_tokens, tools, tool_choice } = req.body;
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
    
    // Sanitize messages while preserving tool call structure
    messages = messages.map(msg => {
      const sanitized = { role: msg.role || 'user' };
      
      // Handle tool role messages (tool results)
      if (msg.role === 'tool') {
        sanitized.content = normalizeContent(msg.content);
        if (msg.tool_call_id) sanitized.tool_call_id = msg.tool_call_id;
        if (msg.name) sanitized.name = msg.name;
        return sanitized;
      }
      
      // Handle assistant messages with tool_calls
      if (msg.role === 'assistant' && msg.tool_calls) {
        sanitized.tool_calls = msg.tool_calls;
        sanitized.content = msg.content != null ? normalizeContent(msg.content) : null;
        return sanitized;
      }
      
      // Handle system messages
      if (msg.role === 'system') {
        sanitized.content = normalizeContent(msg.content);
        if (msg.name) sanitized.name = msg.name;
        return sanitized;
      }
      
      // Regular messages - normalize content (handle array format from Claude Code)
      sanitized.content = normalizeContent(msg.content);
      
      // Preserve name field if present
      if (msg.name) sanitized.name = msg.name;
      
      return sanitized;
    }).filter(msg => {
      // Keep tool messages, assistant messages with tool_calls, or messages with content
      if (msg.role === 'tool') return true;
      if (msg.role === 'assistant' && msg.tool_calls) return true;
      if (msg.role === 'system') return msg.content !== '';
      return msg.content !== '';
    });
    
    if (messages.length === 0) {
      return res.status(400).json({ error: { message: 'At least one message with content is required' } });
    }

    // DEBUG: Log sanitized messages
    console.log('\n========== SANITIZED MESSAGES ==========');
    console.log(JSON.stringify(messages, null, 2));
    console.log('=========================================\n');

    console.log(`Request from ${user.email}: ${model}, stream=${stream}`);

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

    const requestOptions = { temperature, max_tokens, tools, tool_choice };

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

  try {
    const { result, usedKey } = await callPuterWithRotation(messages, model, userKeys, systemKeys, options);
    const content = extractContent(result);
    const usage = extractUsage(result);
    
    // Extract tool calls
    const rawToolCalls = result.message?.tool_calls || 
                         result.choices?.[0]?.message?.tool_calls ||
                         result.tool_calls;

    // Send role chunk
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}\n\n`);

    if (rawToolCalls && rawToolCalls.length > 0) {
      // Normalize and send tool calls
      const toolCalls = rawToolCalls.map((tc, idx) => ({
        id: tc.id || `call_${Date.now()}_${idx}`,
        type: tc.type || 'function',
        function: {
          name: tc.function?.name || tc.name,
          arguments: typeof tc.function?.arguments === 'string' 
            ? tc.function.arguments 
            : JSON.stringify(tc.function?.arguments || tc.arguments || {})
        }
      }));

      // Send content if present
      if (content) {
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
      }

      // Send tool calls - each tool call in separate chunks for streaming
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i];
        // First chunk: tool call with index and id
        res.write(`data: ${JSON.stringify({ 
          id, object: 'chat.completion.chunk', created, model, 
          choices: [{ 
            index: 0, 
            delta: { 
              tool_calls: [{ index: i, id: tc.id, type: tc.type, function: { name: tc.function.name, arguments: '' } }] 
            }, 
            finish_reason: null 
          }] 
        })}\n\n`);
        
        // Second chunk: arguments
        res.write(`data: ${JSON.stringify({ 
          id, object: 'chat.completion.chunk', created, model, 
          choices: [{ 
            index: 0, 
            delta: { 
              tool_calls: [{ index: i, function: { arguments: tc.function.arguments } }] 
            }, 
            finish_reason: null 
          }] 
        })}\n\n`);
      }

      // Final chunk with finish_reason
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage })}\n\n`);
    } else {
      // No tool calls - send content normally
      if (content) {
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    
    // Log successful streaming usage
    await logUsage(user.id, model, usage, provider, true, null, userKeys.length > 0 ? usedKey : null);
    
    res.end();
  } catch (error) {
    // Log failed streaming usage
    await logUsage(user.id, model, null, provider, false, error.message);
    
    res.write(`data: ${JSON.stringify({ error: { message: error.message } })}\n\n`);
    res.end();
  }
}
