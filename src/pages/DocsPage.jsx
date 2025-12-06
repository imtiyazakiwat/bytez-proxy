const API_URL = import.meta.env.VITE_API_URL || window.location.origin;

export default function DocsPage({ profile }) {
  return (
    <div className="tab-content">
      <h1>Documentation</h1>
      
      <div className="card">
        <h3>API Endpoint</h3>
        <code className="endpoint">{API_URL}/v1/chat/completions</code>
      </div>

      <div className="card">
        <h3>Authentication</h3>
        <pre className="code-block">Authorization: Bearer {profile?.apiKey || 'YOUR_API_KEY'}</pre>
      </div>

      <div className="card">
        <h3>Python</h3>
        <pre className="code-block">
{`from openai import OpenAI

client = OpenAI(api_key="${profile?.apiKey || 'KEY'}", base_url="${API_URL}/v1")
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)`}
        </pre>
      </div>

      <div className="card">
        <h3>JavaScript</h3>
        <pre className="code-block">
{`import OpenAI from 'openai';

const client = new OpenAI({ apiKey: '${profile?.apiKey || 'KEY'}', baseURL: '${API_URL}/v1' });
const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }]
});
console.log(response.choices[0].message.content);`}
        </pre>
      </div>

      <div className="card">
        <h3>Models</h3>
        <div className="docs-models">
          <div>
            <h4>OpenAI</h4>
            <ul><li>gpt-4.1, gpt-4o, gpt-4o-mini</li><li>o1, o1-mini, o3, o3-mini</li></ul>
          </div>
          <div>
            <h4>Anthropic</h4>
            <ul><li>claude-sonnet-4</li><li>claude-3-5-sonnet, claude-3-haiku</li></ul>
          </div>
          <div>
            <h4>Other</h4>
            <ul><li>deepseek-chat, deepseek-reasoner</li><li>gemini-*, grok-*</li></ul>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Image Generation</h3>
        <pre className="code-block">
{`POST ${API_URL}/v1/images/generations
{"model": "gpt-image-1", "prompt": "A sunset", "size": "1024x1024"}`}
        </pre>
      </div>

      <p className="note" style={{ marginTop: '1rem' }}>15 free requests/day. Add Puter key for unlimited.</p>
    </div>
  );
}
