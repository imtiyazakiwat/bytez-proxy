import express from 'express';

const app = express();
app.use(express.json({ limit: '50mb' }));

const BYTEZ_BASE_URL = 'https://api.bytez.com/models/v2/openai/v1/chat/completions';

// Model to provider mapping
const MODEL_CONFIG = {
  'claude-opus-4-5': { provider: 'anthropic', model: 'claude-opus-4-5' },
  'claude-sonnet-4': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  'claude-3-opus': { provider: 'anthropic', model: 'claude-3-opus-20240229' },
  'claude-3-sonnet': { provider: 'anthropic', model: 'claude-3-sonnet-20240229' },
  'claude-3-haiku': { provider: 'anthropic', model: 'claude-3-haiku-20240307' },
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
  if (MODEL_CONFIG[requestedModel]) return MODEL_CONFIG[requestedModel];
  if (requestedModel.startsWith('claude') || requestedModel.startsWith('anthropic/')) {
    return { provider: 'anthropic', model: requestedModel.replace('anthropic/', '') };
  }
  if (requestedModel.startsWith('gpt') || requestedModel.startsWith('o1') || requestedModel.startsWith('openai/')) {
    return { provider: 'openai', model: requestedModel.replace('openai/', '') };
  }
  return { provider: 'openai', model: requestedModel };
}

function getApiKey(req) {
  const authHeader = req.headers.authorization || req.headers['x-api-key'] || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
}


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

  // Get content - handle both OpenAI style (choices) and Anthropic style (output.content)
  let content = output.content || '';
  let choices = null;

  // If provider has OpenAI-style choices, use them and preserve tool_calls
  if (provider.choices && provider.choices.length > 0) {
    choices = provider.choices.map((choice, idx) => {
      const message = {
        role: choice.message?.role || 'assistant',
        content: choice.message?.content || '',
      };
      // Preserve tool_calls if present
      if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
        message.tool_calls = choice.message.tool_calls;
      }
      return {
        index: choice.index ?? idx,
        message,
        finish_reason: choice.finish_reason || 'stop',
      };
    });
  } else {
    // Anthropic style - check for tool_use blocks and convert to OpenAI format
    const toolCalls = [];
    let textContent = '';
    
    // Handle Anthropic's content array format
    if (Array.isArray(output.content)) {
      for (const block of output.content) {
        if (block.type === 'text') {
          textContent += block.text || '';
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {}),
            },
          });
        }
      }
    } else {
      textContent = output.content || '';
    }

    const message = { role: 'assistant', content: textContent || null };
    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    choices = [{
      index: 0,
      message,
      finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
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

app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, stream, tools, tool_choice, temperature, max_tokens } = req.body;
    const apiKey = getApiKey(req);

    console.log(`\n=== INCOMING REQUEST ===`);
    console.log(`Model: ${model}`);
    console.log(`Stream: ${stream}`);
    console.log(`Tools: ${tools?.length || 0}`);
    console.log(`Messages: ${messages?.length || 0}`);
    console.log(`Auth header: ${req.headers.authorization?.substring(0, 20)}...`);

    if (!apiKey) {
      return res.status(401).json({ error: { message: 'API key required' } });
    }

    // Map model to OpenRouter format (provider/model)
    const mappedModel = model.includes('/') ? model : `openai/${model}`;

    console.log(`Mapped model: ${mappedModel}`);

    // Build request body with model in body (OpenAI-compatible format)
    const requestBody = { model: mappedModel, messages };
    if (tools && tools.length > 0) requestBody.tools = tools;
    if (tool_choice) requestBody.tool_choice = tool_choice;
    if (temperature !== undefined) requestBody.temperature = temperature;
    // Use max_completion_tokens for newer models (gpt-5, o1, etc.)
    if (max_tokens !== undefined) requestBody.max_completion_tokens = max_tokens;
    if (stream) requestBody.stream = true;

    if (stream) return handleStream(res, BYTEZ_BASE_URL, requestBody, mappedModel, apiKey);

    const response = await fetch(BYTEZ_BASE_URL, {
      method: 'POST',
      headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();
    console.log(`\n=== RESPONSE ===`);
    console.log(`Status: ${response.status}`);
    console.log(`Has tool_calls: ${data.choices?.[0]?.message?.tool_calls?.length > 0}`);
    console.log(`Finish reason: ${data.choices?.[0]?.finish_reason}`);
    
    if (data.error) {
      console.log(`Error: ${JSON.stringify(data.error)}`);
      return res.status(500).json({ error: { message: data.error } });
    }

    // Response is already OpenAI format, just pass through
    res.json(data);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: { message: error.message } });
  }
});

async function handleStream(res, url, requestBody, model, apiKey) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      res.write(`data: ${JSON.stringify({ error: { message: await response.text() } })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    // Pass through SSE stream directly
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text) res.write(text);
    }

    res.end();
  } catch (error) {
    console.error('Stream error:', error);
    res.write(`data: ${JSON.stringify({ error: { message: error.message } })}\n\n`);
    res.end();
  }
}

app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: Object.keys(MODEL_CONFIG).map(id => ({ id, object: 'model', owned_by: MODEL_CONFIG[id].provider })),
  });
});

app.use(express.static('public'));

const PORT = 6660;
app.listen(PORT, () => console.log(`Proxy running on http://localhost:${PORT}`));
