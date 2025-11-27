import express from 'express';

const app = express();
app.use(express.json({ limit: '50mb' }));

const DEFAULT_BYTEZ_API_KEY = '83af6349df87933af1ae6127d1455bf5';
const BYTEZ_BASE_URL = 'https://api.bytez.com/models/v2/anthropic';

// Extract API key from Authorization header (supports "Bearer <key>" or just "<key>")
function getApiKey(req) {
  const authHeader = req.headers.authorization || req.headers['x-api-key'] || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return authHeader || DEFAULT_BYTEZ_API_KEY;
}

// Model mapping from OpenAI to Bytez/Claude
const MODEL_MAP = {
  'gpt-4': 'claude-opus-4-5',
  'gpt-4-turbo': 'claude-opus-4-5',
  'gpt-3.5-turbo': 'claude-sonnet-4-20250514',
  'claude-opus-4-5': 'claude-opus-4-5',
  'claude-sonnet-4': 'claude-sonnet-4-20250514',
};

function getModel(requestedModel) {
  return MODEL_MAP[requestedModel] || 'claude-opus-4-5';
}

// Convert Bytez response to OpenAI format
function toOpenAIResponse(bytezResponse, model, stream = false) {
  const id = `chatcmpl-${bytezResponse.provider?.id || Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  
  const content = bytezResponse.output?.content || 
    bytezResponse.provider?.content?.[0]?.text || '';

  return {
    id,
    object: stream ? 'chat.completion.chunk' : 'chat.completion',
    created,
    model,
    choices: [{
      index: 0,
      message: stream ? undefined : { role: 'assistant', content },
      delta: stream ? { role: 'assistant', content } : undefined,
      finish_reason: bytezResponse.provider?.stop_reason === 'end_turn' ? 'stop' : null,
    }],
    usage: stream ? undefined : {
      prompt_tokens: bytezResponse.provider?.usage?.input_tokens || 0,
      completion_tokens: bytezResponse.provider?.usage?.output_tokens || 0,
      total_tokens: (bytezResponse.provider?.usage?.input_tokens || 0) + 
                   (bytezResponse.provider?.usage?.output_tokens || 0),
    },
  };
}


// Non-streaming endpoint
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, stream } = req.body;
    const bytezModel = getModel(model);
    const url = `${BYTEZ_BASE_URL}/${bytezModel}`;
    const apiKey = getApiKey(req);

    console.log(`Request: model=${model} -> ${bytezModel}, stream=${stream}`);

    if (stream) {
      return handleStream(req, res, url, messages, bytezModel, apiKey);
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
      return res.status(500).json({ error: bytezData.error });
    }

    const openaiResponse = toOpenAIResponse(bytezData, bytezModel);
    res.json(openaiResponse);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: { message: error.message } });
  }
});

// Streaming handler
async function handleStream(req, res, url, messages, model, apiKey) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages, stream: true }),
    });

    const contentType = response.headers.get('content-type');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    // Send initial role chunk
    const roleChunk = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    };
    res.write(`data: ${JSON.stringify(roleChunk)}\n\n`);

    // Read and forward stream
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const text = decoder.decode(value, { stream: true });
      
      // Bytez streams plain text, convert to OpenAI SSE format
      if (text) {
        const chunk = {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    }

    // Send finish chunk
    const finishChunk = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    };
    res.write(`data: ${JSON.stringify(finishChunk)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Stream error:', error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
}

// Models endpoint for compatibility
app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: [
      { id: 'claude-opus-4-5', object: 'model', owned_by: 'bytez' },
      { id: 'claude-sonnet-4', object: 'model', owned_by: 'bytez' },
      { id: 'gpt-4', object: 'model', owned_by: 'bytez' },
      { id: 'gpt-3.5-turbo', object: 'model', owned_by: 'bytez' },
    ],
  });
});

const PORT = 6660;
app.listen(PORT, () => {
  console.log(`OpenAI-compatible proxy running on http://localhost:${PORT}`);
  console.log(`Forwarding to Bytez API at ${BYTEZ_BASE_URL}`);
});
