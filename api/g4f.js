/**
 * G4F (GPT4Free) Driver
 * 
 * Provides access to G4F backend API with RSA authentication.
 * The backend uses dynamic Cloudflare tunnel URLs that change periodically.
 */

import crypto from 'crypto';

// Known G4F backend hosts to probe for discovery
// The Cloudflare tunnel URL changes periodically, so we try multiple options
const KNOWN_HOSTS = [
    'https://dna-subjects-billing-scuba.trycloudflare.com', // Current known working tunnel
    'https://g4f.cloud',
    'https://api.g4f.cloud',
];

// Timeout for individual requests
const REQUEST_TIMEOUT = 15000; // 15 seconds

// Cache for backend URL and authentication
let cachedBackendUrl = null;
let cachedPublicKey = null;
let cachedChallenge = null;
let lastBackendCheck = 0;
const BACKEND_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cache for encrypted secret
let cachedSecret = null;
let secretExpiresAt = 0;
const SECRET_TTL = 60 * 1000; // 1 minute (challenges expire quickly)

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error(`Request timeout after ${timeout}ms`);
        }
        throw error;
    }
}

/**
 * Discover the current G4F backend URL by probing known hosts
 */
async function discoverBackendUrl() {
    const now = Date.now();

    // Return cached URL if still valid
    if (cachedBackendUrl && (now - lastBackendCheck) < BACKEND_CACHE_TTL) {
        return cachedBackendUrl;
    }

    console.log('[G4F] Discovering backend URL...');

    // First, try known hosts (faster and more reliable)
    for (const host of KNOWN_HOSTS) {
        try {
            console.log(`[G4F] Trying host: ${host}`);
            const testRes = await fetchWithTimeout(`${host}/backend-api/v2/public-key`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            }, 10000);
            if (testRes.ok) {
                const data = await testRes.json();
                if (data.public_key && data.data) {
                    cachedBackendUrl = host;
                    lastBackendCheck = now;
                    console.log(`[G4F] Using backend: ${cachedBackendUrl}`);
                    return cachedBackendUrl;
                }
            }
        } catch (e) {
            console.log(`[G4F] Host ${host} failed: ${e.message}`);
        }
    }

    // Fallback: try to fetch from g4f.dev framework (dynamic discovery)
    try {
        console.log('[G4F] Trying framework discovery...');
        const frameworkRes = await fetchWithTimeout('https://g4f.dev/dist/js/framework.js', {
            headers: { 'Accept': 'application/javascript' }
        }, 10000);

        if (frameworkRes.ok) {
            const text = await frameworkRes.text();
            // Look for G4F_HOST_PASS or similar patterns
            const hostMatch = text.match(/G4F_HOST_PASS\s*[=:]\s*["']([^"']+)["']/);
            if (hostMatch && hostMatch[1]) {
                const discoveredUrl = `https://${hostMatch[1]}`;
                console.log(`[G4F] Found host in framework: ${discoveredUrl}`);
                // Verify it works
                const testRes = await fetchWithTimeout(`${discoveredUrl}/backend-api/v2/public-key`, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' }
                }, 10000);
                if (testRes.ok) {
                    cachedBackendUrl = discoveredUrl;
                    lastBackendCheck = now;
                    console.log(`[G4F] Discovered backend: ${cachedBackendUrl}`);
                    return cachedBackendUrl;
                }
            }
        }
    } catch (e) {
        console.log('[G4F] Framework discovery failed:', e.message);
    }

    throw new Error('Could not discover G4F backend URL - all hosts unavailable');
}

/**
 * Fetch the RSA public key and challenge from G4F backend
 */
async function getPublicKey(backendUrl) {
    const response = await fetchWithTimeout(`${backendUrl}/backend-api/v2/public-key`, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch public key: ${response.status}`);
    }

    const data = await response.json();

    if (!data.public_key || !data.data) {
        throw new Error('Invalid public key response');
    }

    return {
        publicKey: data.public_key,
        challenge: data.data,
        user: data.user
    };
}

/**
 * Encrypt the challenge data using RSA public key
 */
function encryptChallenge(challenge, publicKeyPem) {
    try {
        const encrypted = crypto.publicEncrypt(
            {
                key: publicKeyPem,
                padding: crypto.constants.RSA_PKCS1_PADDING,
            },
            Buffer.from(challenge, 'utf8')
        );
        return encrypted.toString('base64');
    } catch (error) {
        console.error('[G4F] RSA encryption failed:', error.message);
        throw new Error('Failed to encrypt challenge');
    }
}

/**
 * Get the x-secret header value for authentication
 */
async function getSecret(backendUrl) {
    const now = Date.now();

    // Return cached secret if still valid
    if (cachedSecret && now < secretExpiresAt) {
        return cachedSecret;
    }

    console.log('[G4F] Refreshing authentication secret...');

    const { publicKey, challenge } = await getPublicKey(backendUrl);
    cachedPublicKey = publicKey;
    cachedChallenge = challenge;

    cachedSecret = encryptChallenge(challenge, publicKey);
    secretExpiresAt = now + SECRET_TTL;

    return cachedSecret;
}

/**
 * Generate a unique ID for messages/conversations
 */
function generateId() {
    return crypto.randomUUID();
}

/**
 * Convert OpenAI-style messages to G4F format
 */
function convertMessages(messages) {
    return messages.map(msg => ({
        role: msg.role,
        content: typeof msg.content === 'string'
            ? msg.content
            : Array.isArray(msg.content)
                ? msg.content.map(c => c.text || c.content || '').join('\n')
                : String(msg.content || '')
    }));
}

/**
 * Model mapping from g4f: format to G4F backend format
 * Multiple providers available - each with different model support
 */
const G4F_MODEL_MAP = {
    // PollinationsAI provider - free, no auth
    'gpt-4o': { model: 'openai', provider: 'PollinationsAI' },
    'gpt-4o-mini': { model: 'openai-fast', provider: 'PollinationsAI' },
    'gpt-4.1': { model: 'openai-large', provider: 'PollinationsAI' },
    'deepseek-v3': { model: 'deepseek', provider: 'PollinationsAI' },
    'deepseek-chat': { model: 'deepseek', provider: 'PollinationsAI' },
    'gemini-fast': { model: 'gemini-fast', provider: 'PollinationsAI' },
    'mistral': { model: 'mistral', provider: 'PollinationsAI' },
    'qwen-coder': { model: 'qwen-coder', provider: 'PollinationsAI' },

    // LMArena provider - no auth, has cutting-edge models
    'gemini-3-pro': { model: 'gemini-3-pro', provider: 'LMArena' },
    'gemini-3-flash': { model: 'gemini-3-flash', provider: 'LMArena' },
    'grok-4.1': { model: 'grok-4.1-thinking', provider: 'LMArena' },
    'claude-opus-4': { model: 'claude-opus-4-5-20251101', provider: 'LMArena' },

    // GeminiPro provider - no auth, high live score
    'gemini-2.0-flash': { model: 'models/gemini-2.0-flash', provider: 'GeminiPro' },
    'gemini-2.5-flash': { model: 'models/gemini-2.5-flash-preview-05-20', provider: 'GeminiPro' },
    'gemini-pro': { model: 'models/gemini-1.5-pro', provider: 'GeminiPro' },

    // DeepInfra provider - no auth, diverse models
    'glm-4.7': { model: 'zai-org/GLM-4.7', provider: 'DeepInfra' },
    'deepseek-v3.2': { model: 'deepseek-ai/DeepSeek-V3.2', provider: 'DeepInfra' },
    'minimax-m2': { model: 'MiniMaxAI/MiniMax-M2', provider: 'DeepInfra' },
    'kimi-k2': { model: 'moonshotai/Kimi-K2-Thinking', provider: 'DeepInfra' },

    // Groq provider - no auth, fast inference
    'groq-compound': { model: 'groq/compound', provider: 'Groq' },
    'groq-compound-mini': { model: 'groq/compound-mini', provider: 'Groq' },

    // Qwen provider - no auth, powerful Chinese models  
    'qwen3-max': { model: 'qwen3-max-preview', provider: 'Qwen' },
    'qwen-plus': { model: 'qwen-plus-2025-09-11', provider: 'Qwen' },
    'qwen3-235b': { model: 'qwen3-235b-a22b', provider: 'Qwen' },
    'qwen3-coder-plus': { model: 'qwen3-coder-plus', provider: 'Qwen' },
    'qwq-32b': { model: 'qwq-32b', provider: 'Qwen' },
};

/**
 * Convert user model to G4F backend model format
 * Returns both model and provider
 */
function mapModelToG4F(model) {
    // Remove g4f: prefix if present
    const cleanModel = model.replace(/^g4f:/, '');

    // Check if we have a direct mapping
    if (G4F_MODEL_MAP[cleanModel]) {
        return G4F_MODEL_MAP[cleanModel];
    }

    // For qwen models, use Qwen provider
    if (cleanModel.startsWith('qwen') || cleanModel.startsWith('qwq')) {
        return { model: cleanModel, provider: 'Qwen' };
    }

    // Default: use PollinationsAI with 'openai' (their default model)
    return { model: 'openai', provider: 'PollinationsAI' };
}

/**
 * Parse SSE stream and extract content
 */
async function* parseSSEStream(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                // Handle SSE data: prefix
                if (trimmed.startsWith('data: ')) {
                    const data = trimmed.slice(6);
                    if (data === '[DONE]') {
                        return;
                    }
                    try {
                        yield JSON.parse(data);
                    } catch (e) {
                        // Not JSON, might be raw text
                        yield { type: 'content', content: data };
                    }
                } else {
                    // Try to parse as raw JSON
                    try {
                        yield JSON.parse(trimmed);
                    } catch (e) {
                        // Skip unparseable lines
                    }
                }
            }
        }

        // Process remaining buffer
        if (buffer.trim()) {
            const trimmed = buffer.trim();
            if (trimmed.startsWith('data: ')) {
                const data = trimmed.slice(6);
                if (data !== '[DONE]') {
                    try {
                        yield JSON.parse(data);
                    } catch (e) {
                        yield { type: 'content', content: data };
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}

/**
 * Call G4F API (non-streaming)
 */
export async function callG4F(messages, model, options = {}) {
    const backendUrl = await discoverBackendUrl();
    const secret = await getSecret(backendUrl);

    // Map the model to G4F backend format (returns {model, provider})
    const { model: g4fModel, provider: g4fProvider } = mapModelToG4F(model);

    const requestBody = {
        id: generateId(),
        conversation_id: options.conversationId || generateId(),
        model: g4fModel,
        provider: options.provider || g4fProvider,
        messages: convertMessages(messages),
        action: 'chat',
        web_search: options.webSearch || false,
    };

    console.log(`[G4F] Non-streaming request to ${backendUrl} with model ${requestBody.model}, provider ${requestBody.provider}`);

    const response = await fetchWithTimeout(`${backendUrl}/backend-api/v2/conversation`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            'x-secret': secret,
        },
        body: JSON.stringify(requestBody),
    }, 60000); // 60 second timeout for API calls

    if (!response.ok) {
        // Invalidate caches on auth error
        if (response.status === 401 || response.status === 403) {
            cachedSecret = null;
            secretExpiresAt = 0;
        }
        const errorText = await response.text();
        throw new Error(`G4F API error: ${response.status} - ${errorText}`);
    }

    // Collect all SSE chunks
    let content = '';
    let reasoning = '';

    for await (const chunk of parseSSEStream(response)) {
        // Handle various response formats
        if (chunk.type === 'content' && chunk.content) {
            content += chunk.content;
        } else if (chunk.type === 'reasoning' && (chunk.reasoning || chunk.content)) {
            reasoning += chunk.reasoning || chunk.content;
        } else if (chunk.content) {
            content += chunk.content;
        } else if (typeof chunk === 'string') {
            // Raw string response
            content += chunk;
        } else if (chunk.choices && chunk.choices[0]?.delta?.content) {
            // OpenAI format delta
            content += chunk.choices[0].delta.content;
        } else if (chunk.message && chunk.message.content) {
            // Full message format
            content += chunk.message.content;
        } else if (chunk.text) {
            // Simple text format
            content += chunk.text;
        }
    }

    // Return in OpenAI-compatible format
    return {
        id: `g4f-${generateId()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content: content,
                ...(reasoning ? { reasoning } : {}),
            },
            finish_reason: 'stop',
        }],
        usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        },
    };
}

/**
 * Call G4F API with streaming
 */
export async function callG4FStream(messages, model, options = {}, onChunk) {
    const backendUrl = await discoverBackendUrl();
    const secret = await getSecret(backendUrl);

    // Map the model to G4F backend format (returns {model, provider})
    const { model: g4fModel, provider: g4fProvider } = mapModelToG4F(model);

    const requestBody = {
        id: generateId(),
        conversation_id: options.conversationId || generateId(),
        model: g4fModel,
        provider: options.provider || g4fProvider,
        messages: convertMessages(messages),
        action: 'chat',
        web_search: options.webSearch || false,
    };

    console.log(`[G4F] Streaming request to ${backendUrl} with model ${requestBody.model}, provider ${requestBody.provider}`);

    const response = await fetchWithTimeout(`${backendUrl}/backend-api/v2/conversation`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            'x-secret': secret,
        },
        body: JSON.stringify(requestBody),
    }, 60000); // 60 second timeout

    if (!response.ok) {
        // Invalidate caches on auth error
        if (response.status === 401 || response.status === 403) {
            cachedSecret = null;
            secretExpiresAt = 0;
        }
        const errorText = await response.text();
        throw new Error(`G4F API error: ${response.status} - ${errorText}`);
    }

    // Stream SSE chunks to callback
    for await (const chunk of parseSSEStream(response)) {
        if (chunk.type === 'content' && chunk.content) {
            onChunk({ type: 'text', text: chunk.content });
        } else if (chunk.type === 'reasoning' && (chunk.reasoning || chunk.content)) {
            onChunk({ type: 'reasoning', text: chunk.reasoning || chunk.content });
        } else if (chunk.content) {
            onChunk({ type: 'text', text: chunk.content });
        } else if (chunk.type === 'error') {
            throw new Error(chunk.message || 'G4F stream error');
        }
    }
}

/**
 * Refresh the backend URL (force re-discovery)
 */
export async function refreshBackendUrl() {
    cachedBackendUrl = null;
    lastBackendCheck = 0;
    cachedSecret = null;
    secretExpiresAt = 0;
    return await discoverBackendUrl();
}

/**
 * Get available G4F models
 * These are mapped to PollinationsAI provider models (openai, openai-fast, gemini, deepseek, mistral)
 */
export function getG4FModels() {
    return {
        'g4f:gpt-4o': { name: 'GPT-4o (G4F)', provider: 'g4f', description: 'OpenAI-class model via PollinationsAI' },
        'g4f:gpt-4o-mini': { name: 'GPT-4o Mini (G4F)', provider: 'g4f', description: 'Fast OpenAI-class model via PollinationsAI' },
        'g4f:gpt-4.1': { name: 'GPT-4.1 (G4F)', provider: 'g4f', description: 'Large OpenAI-class model via PollinationsAI' },
        'g4f:deepseek-v3': { name: 'DeepSeek V3 (G4F)', provider: 'g4f', description: 'DeepSeek model via PollinationsAI' },
        'g4f:gemini-2.0-flash': { name: 'Gemini 2.0 Flash (G4F)', provider: 'g4f', description: 'Fast Gemini model via PollinationsAI' },
        'g4f:mistral': { name: 'Mistral (G4F)', provider: 'g4f', description: 'Mistral model via PollinationsAI' },

        // Qwen Provider
        'g4f:qwen3-max': { name: 'Qwen3 Max (G4F)', provider: 'g4f', description: 'Qwen3 Max via Qwen Provider' },
        'g4f:qwen-plus': { name: 'Qwen Plus (G4F)', provider: 'g4f', description: 'Qwen Plus via Qwen Provider' },

        // DeepInfra Provider
        'g4f:glm-4.7': { name: 'GLM 4.7 (G4F)', provider: 'g4f', description: 'GLM 4.7 via DeepInfra' },
        'g4f:deepseek-v3.2': { name: 'DeepSeek V3.2 (G4F)', provider: 'g4f', description: 'DeepSeek V3.2 via DeepInfra' },

        // Groq Provider
        'g4f:groq-compound': { name: 'Groq Compound (G4F)', provider: 'g4f', description: 'Groq Compound via Groq' },
    };
}

/**
 * Check if a model ID is a G4F model
 */
export function isG4FModel(modelId) {
    return modelId && modelId.startsWith('g4f:');
}

export default {
    callG4F,
    callG4FStream,
    refreshBackendUrl,
    getG4FModels,
    isG4FModel,
};
