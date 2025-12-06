import { useState, useEffect } from 'react';

export default function PlaygroundPage({ profile, models }) {
  const openRouterModels = models.filter(m => m.id.startsWith('openrouter:'));
  const defaultModel = openRouterModels.find(m => m.id === 'openrouter:openai/gpt-4o')?.id || openRouterModels[0]?.id || 'openrouter:openai/gpt-4o';
  
  const [model, setModel] = useState(defaultModel);
  const [message, setMessage] = useState('');
  const [content, setContent] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingCollapsed, setThinkingCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stream, setStream] = useState(true);
  const [filter, setFilter] = useState('');

  const getModelName = (id) => {
    if (id.startsWith('openrouter:')) {
      const path = id.replace('openrouter:', '');
      const parts = path.split('/');
      return parts.length > 1 ? `${parts[1]} (${parts[0]})` : path;
    }
    return id;
  };

  const filteredModels = openRouterModels.filter(m => !filter || m.id.toLowerCase().includes(filter.toLowerCase()));
  const popularIds = ['openrouter:openai/gpt-4o', 'openrouter:openai/gpt-4o-mini', 'openrouter:anthropic/claude-3.5-sonnet', 'openrouter:deepseek/deepseek-r1'];
  const popularModels = openRouterModels.filter(m => popularIds.includes(m.id));
  const otherModels = filteredModels.filter(m => !popularIds.includes(m.id));

  useEffect(() => {
    if (filter && filteredModels.length > 0 && !filteredModels.find(m => m.id === model)) {
      setModel(filteredModels[0].id);
    }
  }, [filter, filteredModels, model]);

  const sendRequest = async () => {
    if (!message.trim()) return;
    setLoading(true);
    setContent('');
    setReasoning('');
    setIsThinking(false);
    setThinkingCollapsed(false);

    try {
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${profile?.apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: message }], stream })
      });

      if (stream) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '', fullReasoning = '', hasStartedContent = false, buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
              try {
                const data = JSON.parse(trimmed.slice(6));
                if (data.error) { setContent(`Error: ${data.error.message || data.error}`); return; }
                if (data.choices?.[0]?.delta?.reasoning_content) {
                  fullReasoning += data.choices[0].delta.reasoning_content;
                  setReasoning(fullReasoning);
                  setIsThinking(true);
                }
                if (data.choices?.[0]?.delta?.content) {
                  if (!hasStartedContent && fullReasoning) { setThinkingCollapsed(true); setIsThinking(false); }
                  hasStartedContent = true;
                  fullContent += data.choices[0].delta.content;
                  setContent(fullContent);
                }
              } catch {}
            }
          }
        }
        if (fullContent && fullReasoning) { setThinkingCollapsed(true); setIsThinking(false); }
      } else {
        const data = await res.json();
        setContent(data.choices?.[0]?.message?.content || JSON.stringify(data, null, 2));
        if (data.choices?.[0]?.message?.reasoning_content) {
          setReasoning(data.choices[0].message.reasoning_content);
          setThinkingCollapsed(true);
        }
      }
    } catch (error) {
      setContent(`Error: ${error.message}`);
    } finally {
      setLoading(false);
      setIsThinking(false);
    }
  };

  return (
    <div className="tab-content">
      <h1>Playground</h1>
      <div className="playground-grid">
        <div className="card">
          <h3>Request</h3>
          <div className="form-group">
            <label>Model</label>
            <input type="text" placeholder="Search..." value={filter} onChange={(e) => setFilter(e.target.value)} className="model-search" />
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {!filter && popularModels.length > 0 && (
                <optgroup label="Popular">
                  {popularModels.map(m => <option key={m.id} value={m.id}>{getModelName(m.id)}</option>)}
                </optgroup>
              )}
              <optgroup label={filter ? 'Results' : 'All'}>
                {(filter ? filteredModels : otherModels).slice(0, 100).map(m => <option key={m.id} value={m.id}>{getModelName(m.id)}</option>)}
              </optgroup>
            </select>
          </div>
          <div className="form-group">
            <label>Message</label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Enter message..." rows={6} />
          </div>
          <div className="form-group checkbox">
            <input type="checkbox" id="stream" checked={stream} onChange={(e) => setStream(e.target.checked)} />
            <label htmlFor="stream">Stream</label>
          </div>
          <button className="btn btn-primary" onClick={sendRequest} disabled={loading}>
            {loading ? 'Sending...' : 'Send'}
          </button>
        </div>
        <div className="card">
          <h3>Response</h3>
          {(reasoning || isThinking) && (
            <div className={`thinking-section ${thinkingCollapsed ? 'collapsed' : ''}`}>
              <div className="thinking-header" onClick={() => setThinkingCollapsed(!thinkingCollapsed)}>
                <span>{isThinking ? '⏳ Thinking...' : '🧠 Thought'}</span>
                <span>{thinkingCollapsed ? '▶' : '▼'}</span>
              </div>
              {!thinkingCollapsed && <pre className="thinking-content">{reasoning}</pre>}
            </div>
          )}
          <pre className="response-box">{content || 'Response here...'}</pre>
        </div>
      </div>
    </div>
  );
}
