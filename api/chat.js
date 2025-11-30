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

function getDriverAndModel(modelId) {
  // Handle OpenRouter models (format: openrouter:provider/model)
  if (modelId.startsWith('openrouter:')) {
    return { driver: 'openrouter', model: modelId };
  }
  
  // Handle TogetherAI models
  if (modelId.startsWith('togetherai:')) {
    return { driver: 'together-ai', model: modelId };
  }
  
  // Route Gemini models through OpenRouter (direct driver doesn't work)
  if (modelId.startsWith('gemini-')) {
    return { driver: 'openrouter', model: `openrouter:google/${modelId}` };
  }
  
  // Route Grok models through OpenRouter (direct driver doesn't work)
  if (modelId.startsWith('grok-')) {
    return { driver: 'openrouter', model: `openrouter:x-ai/${modelId}` };
  }
  
  const mapping = MODEL_DRIVERS[modelId];
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

function getRotatingKey(keys, requestId) {
  if (!keys || keys.length === 0) return null;
  let hash = 0;
  for (let i = 0; i < requestId.length; i++) {
    hash = ((hash << 5) - hash) + requestId.charCodeAt(i);
    hash |= 0;
  }
  return keys[Math.abs(hash) % keys.length];
}

async function callPuter(messages, modelId, puterToken, options = {}) {
  const { driver, model } = getDriverAndModel(modelId);
  const args = { messages, model };
  if (options.max_tokens) args.max_tokens = options.max_tokens;
  if (options.temperature !== undefined) args.temperature = options.temperature;

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
  if (!data.success) throw new Error(data.error?.message || data.error || 'Puter API error');
  return data.result;
}


function extractContent(result) {
  // OpenAI/DeepSeek style (message.content is a string)
  if (result.message?.content && typeof result.message.content === 'string') {
    return result.message.content;
  }
  // Claude style (message.content is an array)
  if (result.message?.content && Array.isArray(result.message.content)) {
    return result.message.content.map(c => c.text || '').join('');
  }
  // Standard OpenAI choices format
  if (result.choices?.[0]?.message?.content) {
    return result.choices[0].message.content;
  }
  if (typeof result === 'string') return result;
  return '';
}

function extractUsage(result) {
  const usage = result.usage;
  
  // Array format from Puter [{type: "prompt", amount: X}, {type: "completion", amount: Y}]
  if (Array.isArray(usage)) {
    const prompt = usage.find(u => u.type === 'prompt')?.amount || 0;
    const completion = usage.find(u => u.type === 'completion')?.amount || 0;
    return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
  }
  
  // Claude format {input_tokens, output_tokens}
  if (usage?.input_tokens !== undefined) {
    return {
      prompt_tokens: usage.input_tokens || 0,
      completion_tokens: usage.output_tokens || 0,
      total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
    };
  }
  
  // Standard OpenAI format
  if (usage?.prompt_tokens !== undefined) {
    return {
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
    };
  }
  
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

function puterToOpenAI(puterResult, model) {
  const content = extractContent(puterResult);
  const finishReason = puterResult.finish_reason || puterResult.finishReason || 'stop';

  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: finishReason,
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

  try {
    const authHeader = req.headers.authorization || req.headers['x-api-key'] || '';
    const apiKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    
    if (!apiKey) {
      return res.status(401).json({ error: { message: 'API key required' } });
    }

    const user = await getUserByApiKey(apiKey);
    if (!user) {
      return res.status(401).json({ error: { message: 'Invalid API key' } });
    }

    const { model, messages, stream, temperature, max_tokens } = req.body;
    const requestId = `${Date.now()}-${Math.random()}`;

    console.log(`Request from ${user.email}: ${model}, stream=${stream}`);

    const hasOwnKeys = user.puterKeys && user.puterKeys.length > 0;
    
    if (!hasOwnKeys) {
      const dailyUsed = await getDailyUsage(user);
      if (dailyUsed >= FREE_DAILY_LIMIT) {
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

    const puterToken = hasOwnKeys 
      ? getRotatingKey(user.puterKeys, requestId)
      : process.env.PUTER_API_KEY;

    if (!puterToken) {
      return res.status(500).json({ error: { message: 'No Puter API key configured' } });
    }

    if (!hasOwnKeys) {
      await incrementUsage(user.id);
    }

    if (stream) {
      return handleStream(res, messages, model, puterToken, { temperature, max_tokens });
    }

    const result = await callPuter(messages, model, puterToken, { temperature, max_tokens });
    return res.json(puterToOpenAI(result, model));

  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ error: { message: error.message } });
  }
}

async function handleStream(res, messages, model, puterToken, options = {}) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const id = `chatcmpl-${Date.now()}`;

  try {
    const result = await callPuter(messages, model, puterToken, options);
    const content = extractContent(result);

    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: { message: error.message } })}\n\n`);
    res.end();
  }
}
