import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json({ limit: '50mb' }));

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// Import API handlers
const chatHandler = (await import('./api/chat.js')).default;
const modelsHandler = (await import('./api/models.js')).default;
const authHandler = (await import('./api/auth.js')).default;
const usageHandler = (await import('./api/usage.js')).default;
const adminHandler = (await import('./api/admin.js')).default;
const imagesHandler = (await import('./api/images.js')).default;

// API routes
app.post('/v1/chat/completions', chatHandler);
app.get('/v1/models', modelsHandler);
app.all('/v1/images/generations', imagesHandler);
app.all('/api/images', imagesHandler);
app.all('/api/auth', authHandler);
app.all('/api/models', modelsHandler);
app.all('/api/usage', usageHandler);
app.all('/api/admin', adminHandler);

// Serve static files
app.use(express.static(join(__dirname, 'dist')));
app.use(express.static(join(__dirname, 'public')));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
