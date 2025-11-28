# Bytez OpenAI Proxy

OpenAI-compatible API proxy for Bytez models.

**Live URL:** https://bytez-proxy.vercel.app

## Endpoints

- `POST /v1/chat/completions` - Chat completions
- `GET /v1/models` - List available models

## Usage

```bash
curl -X POST "https://bytez-proxy.vercel.app/v1/chat/completions" \
  -H "Authorization: Bearer YOUR_BYTEZ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

## Available Models

**OpenAI:** gpt-5.1, gpt-5, gpt-4.1, gpt-4o, gpt-4o-mini, o1, o1-mini

**Anthropic:** claude-opus-4-5, claude-sonnet-4, claude-3-opus, claude-3-haiku

## Features

- OpenAI-compatible API format
- Streaming support
- Automatic model fallback on rate limits (gpt-5.1 → gpt-5 → gpt-4.1 → gpt-4o → gpt-4o-mini)

## Local Development

```bash
npm install
node server.js
# Server runs on http://localhost:6660
```
