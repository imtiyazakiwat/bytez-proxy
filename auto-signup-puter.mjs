/**
 * Puter Auto-Signup: Creates temporary Puter accounts automatically.
 * 
 * How it works:
 * 1. Fetches an SVG captcha from Puter's API
 * 2. Uses GPT-4o vision (via an existing Puter token) to solve it
 * 3. Signs up a temp account and returns the auth token
 * 
 * Usage:
 *   PUTER_KEY=<existing_working_key> node auto-signup-puter.mjs
 * 
 * Rate limit: 10 signups per 15 minutes per IP
 */

import sharp from '/tmp/node_modules/sharp/lib/index.js';

const PUTER_API = 'https://api.puter.com';

async function solveCaptcha(svgImage, apiKey) {
  // Remove noise lines (fill="none" paths are decorative noise)
  const clean = svgImage.replace(/<path[^>]*fill="none"[^/]*\/>/g, '')
    .replace(/fill="#f0f0f0"/, 'fill="#ffffff"');

  // Render SVG to PNG for vision model
  const png = await sharp(Buffer.from(clean), { density: 300 })
    .resize(540, 150).png().toBuffer();

  const res = await fetch(`${PUTER_API}/drivers/call`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Origin': 'http://docs.puter.com',
      'Referer': 'http://docs.puter.com/',
    },
    body: JSON.stringify({
      interface: 'puter-chat-completion',
      driver: 'ai-chat',
      method: 'complete',
      args: {
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'data:image/png;base64,' + png.toString('base64') } },
            { type: 'text', text: 'Read the 6-character captcha text. Valid chars: abcdefghjkmnpqrstuvwxyz23456789. Reply with ONLY the 6 characters.' }
          ]
        }],
        model: 'gpt-4o',
        stream: false
      }
    })
  });
  const data = await res.json();
  const content = data?.result?.message?.content || '';
  return content.trim().toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 6);
}

export async function createTempPuterAccount(existingApiKey, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      // 1. Get captcha
      const captcha = await (await fetch(`${PUTER_API}/api/captcha/generate`)).json();

      // 2. Solve with AI vision
      const answer = await solveCaptcha(captcha.image, existingApiKey);
      if (answer.length !== 6) continue;

      // 3. Signup
      const res = await fetch(`${PUTER_API}/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://puter.com',
          'Referer': 'https://puter.com/',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
        body: JSON.stringify({
          is_temp: true,
          captchaToken: captcha.token,
          captchaAnswer: answer,
        }),
      });
      const result = await res.json();

      if (result.token) {
        return { token: result.token, username: result.username };
      }
      if (result.message?.includes('Too many requests')) {
        console.log('Rate limited, waiting 60s...');
        await new Promise(r => setTimeout(r, 60000));
      }
    } catch (e) {
      console.error('Attempt failed:', e.message);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}

// CLI mode
if (process.argv[1]?.includes('auto-signup-puter')) {
  const key = process.env.PUTER_KEY;
  if (!key) { console.error('Set PUTER_KEY env var'); process.exit(1); }

  console.log('Creating temp Puter account...');
  const account = await createTempPuterAccount(key, 5);
  if (account) {
    console.log('✅ Success!');
    console.log('Token:', account.token);
    console.log('Username:', account.username);
  } else {
    console.log('❌ Failed after retries');
  }
}
