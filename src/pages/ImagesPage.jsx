import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || window.location.origin;

export default function ImagesPage({ profile }) {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('flux-schnell-free');
  const [size, setSize] = useState('1024x1024');
  const [loading, setLoading] = useState(false);
  const [generatedImage, setGeneratedImage] = useState(null);
  const [error, setError] = useState(null);
  const [inputImage, setInputImage] = useState(null);
  const [inputImagePreview, setInputImagePreview] = useState(null);
  const [imageModels, setImageModels] = useState([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    fetch('/api/images')
      .then(res => res.json())
      .then(data => {
        const aliases = data.aliases || [];
        const models = data.models || [];
        setImageModels([...aliases, ...models.map(id => ({ 
          id, name: id.split('/').pop().replace(/-/g, ' '),
          supportsEdit: id.toLowerCase().includes('gemini') && id.toLowerCase().includes('image')
        }))]);
      })
      .catch(console.error);
  }, []);

  const selectedModel = imageModels.find(m => m.id === model);
  const filteredModels = filter ? imageModels.filter(m => m.id.toLowerCase().includes(filter.toLowerCase())) : imageModels;

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => { setInputImage(event.target.result); setInputImagePreview(event.target.result); };
      reader.readAsDataURL(file);
    }
  };

  const generateImage = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setGeneratedImage(null);

    try {
      const body = { prompt, model, size };
      if (inputImage && selectedModel?.supportsEdit) body.image = inputImage;

      const res = await fetch('/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${profile?.apiKey}` },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      
      if (data.error) setError(data.error.message || 'Failed');
      else if (data.data?.[0]) {
        const img = data.data[0];
        setGeneratedImage(img.b64_json ? `data:image/png;base64,${img.b64_json}` : img.url);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="tab-content">
      <h1>Image Generation</h1>
      <div className="playground-grid">
        <div className="card">
          <h3>Generate</h3>
          <div className="form-group">
            <label>Model ({imageModels.length})</label>
            <input type="text" placeholder="Search..." value={filter} onChange={(e) => setFilter(e.target.value)} className="model-search" />
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {filteredModels.map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Prompt</label>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe image..." rows={4} />
          </div>
          <div className="form-group">
            <label>Size</label>
            <select value={size} onChange={(e) => setSize(e.target.value)}>
              <option value="1024x1024">1024x1024</option>
              <option value="1024x1792">1024x1792</option>
              <option value="1792x1024">1792x1024</option>
            </select>
          </div>
          {selectedModel?.supportsEdit && (
            <div className="form-group">
              <label>Input Image (optional)</label>
              {inputImagePreview ? (
                <div className="input-image-preview">
                  <img src={inputImagePreview} alt="Input" />
                  <button className="btn btn-secondary btn-sm" onClick={() => { setInputImage(null); setInputImagePreview(null); }}>
                    <X size={14} /> Remove
                  </button>
                </div>
              ) : (
                <label className="upload-label">
                  <input type="file" accept="image/*" onChange={handleImageUpload} hidden />
                  <span>Upload image</span>
                </label>
              )}
            </div>
          )}
          <button className="btn btn-primary" onClick={generateImage} disabled={loading || !prompt.trim()}>
            {loading ? 'Generating...' : 'Generate'}
          </button>
        </div>
        <div className="card">
          <h3>Result</h3>
          {error && <div className="error-message">{error}</div>}
          {loading && <div className="loading-spinner">Generating...</div>}
          {generatedImage && (
            <div className="generated-image-container">
              <img src={generatedImage} alt="Generated" className="generated-image" />
              <button className="btn btn-secondary" onClick={() => { const a = document.createElement('a'); a.href = generatedImage; a.download = `img-${Date.now()}.png`; a.click(); }}>
                Download
              </button>
            </div>
          )}
          {!generatedImage && !loading && !error && <p className="placeholder-text">Image will appear here</p>}
        </div>
      </div>
      <div className="card">
        <h3>API</h3>
        <pre className="code-block">
{`curl -X POST "${API_URL}/v1/images/generations" \\
  -H "Authorization: Bearer ${profile?.apiKey || 'KEY'}" \\
  -d '{"model": "gpt-image-1", "prompt": "A cat", "size": "1024x1024"}'`}
        </pre>
      </div>
    </div>
  );
}
