export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  res.json({
    object: 'list',
    data: [
      // Anthropic (temporarily disabled)
      // { id: 'claude-opus-4-5', object: 'model', owned_by: 'anthropic' },
      // { id: 'claude-sonnet-4', object: 'model', owned_by: 'anthropic' },
      // { id: 'claude-3-opus', object: 'model', owned_by: 'anthropic' },
      // { id: 'claude-3-sonnet', object: 'model', owned_by: 'anthropic' },
      // { id: 'claude-3-haiku', object: 'model', owned_by: 'anthropic' },
      // OpenAI
      { id: 'openai/gpt-5', object: 'model', owned_by: 'openai' },
      { id: 'openai/gpt-oss-120b', object: 'model', owned_by: 'openai' },
      { id: 'openai/gpt-5.1', object: 'model', owned_by: 'openai' },
      { id: 'openai/gpt-4.1', object: 'model', owned_by: 'openai' },
      { id: 'openai/gpt-oss-20b', object: 'model', owned_by: 'openai' },
    ],
  });
}
