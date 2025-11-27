const BYTEZ_BASE_URL = 'https://api.bytez.com/models/v2';

// Model to provider mapping
const MODEL_CONFIG = {
  // Anthropic models
  'claude-opus-4-5': { provider: 'anthropic', model: 'claude-opus-4-5' },
  'claude-sonnet-4': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  'claude-3-opus': { provider: 'anthropic', model: 'claude-3-opus-20240229' },
  'claude-3-sonnet': { provider: 'anthropic', model: 'claude-3-sonnet-20240229' },
  'claude-3-haiku': { provider: 'anthropic', model: 'claude-3-haiku-20240307' },
  // OpenAI models
  'gpt-5': { provider: 'openai', model: 'gpt-5' },
  'gpt-5.1': { provider: 'openai', model: 'gpt-5.1' },
  'gpt-4': { provider: 'openai', model: 'gpt-4' },
  'gpt-4-turbo': { provider: 'openai', model: 'gpt-4-turbo' },
  'gpt-4o': { provider: 'openai', model: 'gpt-4o' },
  'gpt-4o-mini': { provider: 'openai', model: 'gpt-4o-mini' },
  'gpt-3.5-turbo': { provider: 'openai', model: 'gpt-3.5-turbo' },
  'o1': { provider: 'openai', model: 'o1' },
  'o1-mini': { provider: 'openai', model: 'o1-mini' },
  'o1-preview': { provider: 'openai', model: 'o1-preview' },
};

function getModelConfig(requestedModel) {
  // Check if it's a known model
  if (MODEL_CONFIG[requestedModel]) {
    return MODEL_CONFIG[requestedModel];
  }
  // Try to detect provider from model name
  if (requestedModel.startsWith('claude') || requestedModel.startsWith('anthropic/')) {
    const model = requestedModel.replace('anthropic/', '');
    return { provider: 'anthropic', model };
  }
  if (requestedModel.startsWith('gpt') || requestedModel.startsWith('o1') || requestedModel.startsWith('openai/')) {
    const model = requestedModel.replace('openai/', '');
    return { provider: 'openai', model };
  }
  // Default to openai for unknown models
  return { provider: 'openai', model: requestedModel };
}

function getApiKey(req) {
  const authHeader = req.headers?.authorization || req.headers?.['x-api-key'] || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return authHeader || process.env.BYTEZ_API_KEY || '';
}


// Convert Bytez response to OpenAI format
function toOpenAIResponse(bytezResponse, model) {
  const provider = bytezResponse.provider || {};
  const output = bytezResponse.output || {};
  const usage = provider.usage || {};

  // Normalize usage to OpenAI format
  const normalizedUsage = {
    prompt_tokens: usage.prompt_tokens || usage.input_tokens || 0,
    completion_tokens: usage.completion_tokens || usage.output_tokens || 0,
    total_tokens: usage.total_tokens || (usage.prompt_tokens || usage.input_tokens || 0) + (usage.completion_tokens || usage.output_tokens || 0),
  };

  // Get content and build proper OpenAI choices
  let content = output.content || '';
  let choices = null;

  if (provider.choices && provider.choices.length > 0) {
    // OpenAI style - normalize the choices
    choices = provider.choices.map((choice, idx) => ({
      index: choice.index ?? idx,
      message: {
        role: choice.message?.role || 'assistant',
        content: choice.message?.content || '',
      },
      finish_reason: choice.finish_reason || 'stop',
    }));
  } else {
    // Anthropic style - build OpenAI choices from output
    choices = [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    }];
  }

  // Ensure id has chatcmpl- prefix
  let id = provider.id || `${Date.now()}`;
  if (!id.startsWith('chatcmpl-')) id = `chatcmpl-${id}`;

  return {
    id,
    object: 'chat.completion',
    created: provider.created || Math.floor(Date.now() / 1000),
    model: provider.model || model,
    choices,
    usage: normalizedUsage,
  };
}

function createStreamChunk(id, model, delta, finishReason = null) {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const { model, messages, stream } = req.body;
    const apiKey = getApiKey(req);

    if (!apiKey) {
      return res.status(401).json({ error: { message: 'API key required' } });
    }

    const config = getModelConfig(model);
    const url = `${BYTEZ_BASE_URL}/${config.provider}/${config.model}`;

    console.log(`Request: ${model} -> ${config.provider}/${config.model}, stream=${stream}`);

    if (stream) {
      return handleStream(res, url, messages, config.model, apiKey);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages }),
    });

    const bytezData = await response.json();

    if (bytezData.error) {
      return res.status(response.status || 500).json({ error: { message: bytezData.error } });
    }

    const openaiResponse = toOpenAIResponse(bytezData, config.model);
    res.json(openaiResponse);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: { message: error.message } });
  }
}


async function handleStream(res, url, messages, model, apiKey) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const id = `chatcmpl-${Date.now()}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages, stream: true }),
    });

    if (!response.ok) {
      const error = await response.text();
      res.write(`data: ${JSON.stringify({ error: { message: error } })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    // Send initial role chunk
    res.write(`data: ${JSON.stringify(createStreamChunk(id, model, { role: 'assistant' }))}\n\n`);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      if (text) {
        res.write(`data: ${JSON.stringify(createStreamChunk(id, model, { content: text }))}\n\n`);
      }
    }

    // Send finish chunk
    res.write(`data: ${JSON.stringify(createStreamChunk(id, model, {}, 'stop'))}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Stream error:', error);
    res.write(`data: ${JSON.stringify({ error: { message: error.message } })}\n\n`);
    res.end();
  }
}
