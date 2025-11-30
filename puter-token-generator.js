// Puter Temp Account & Token Generator
const PUTER_API = 'https://api.puter.com';

function generateUsername() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'user_';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generatePassword() {
  return 'Pass' + Math.random().toString(36).slice(2) + '!1Aa';
}

async function tryEndpoint(name, url, options) {
  console.log(`\n--- Trying: ${name} ---`);
  console.log(`URL: ${url}`);
  
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    console.log(`Status: ${response.status}`);
    
    try {
      const json = JSON.parse(text);
      console.log('Response:', JSON.stringify(json, null, 2));
      return { success: true, data: json, status: response.status };
    } catch {
      console.log('Response (text):', text.slice(0, 500));
      return { success: false, text, status: response.status };
    }
  } catch (err) {
    console.log('Error:', err.message);
    return { success: false, error: err.message };
  }
}

async function testToken(token) {
  console.log('\n=== Testing Token ===');
  
  const response = await fetch(`${PUTER_API}/drivers/call`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Origin': 'https://puter.com',
    },
    body: JSON.stringify({
      interface: 'puter-chat-completion',
      driver: 'openai-completion',
      method: 'complete',
      args: {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Say "works"' }],
        max_tokens: 10
      },
    }),
  });
  
  const data = await response.json();
  if (data.success) {
    console.log('✓ TOKEN WORKS!');
    return true;
  } else {
    console.log('✗ Token failed:', data.error?.message || data.error);
    return false;
  }
}

async function main() {
  console.log('=== PUTER API ENDPOINT DISCOVERY ===\n');
  
  const username = generateUsername();
  const password = generatePassword();
  const email = `${username}@test.local`;
  
  console.log('Generated credentials:');
  console.log('Username:', username);
  console.log('Password:', password);
  console.log('Email:', email);
  
  // Try various signup endpoints
  const endpoints = [
    {
      name: 'POST /signup (temp)',
      url: `${PUTER_API}/signup`,
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': 'https://puter.com' },
        body: JSON.stringify({ is_temp: true })
      }
    },
    {
      name: 'POST /auth/create-temp-user',
      url: `${PUTER_API}/auth/create-temp-user`,
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': 'https://puter.com' },
        body: JSON.stringify({})
      }
    },
    {
      name: 'POST /auth/tmp-user',
      url: `${PUTER_API}/auth/tmp-user`,
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': 'https://puter.com' },
        body: JSON.stringify({})
      }
    },
    {
      name: 'GET /auth/check',
      url: `${PUTER_API}/auth/check`,
      options: {
        method: 'GET',
        headers: { 'Origin': 'https://puter.com' }
      }
    },
    {
      name: 'POST /signup (full)',
      url: `${PUTER_API}/signup`,
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': 'https://puter.com' },
        body: JSON.stringify({ username, password, email })
      }
    },
    {
      name: 'POST /auth/signup',
      url: `${PUTER_API}/auth/signup`,
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': 'https://puter.com' },
        body: JSON.stringify({ username, password, email })
      }
    },
  ];
  
  for (const ep of endpoints) {
    const result = await tryEndpoint(ep.name, ep.url, ep.options);
    
    // Check if we got a token
    if (result.data?.token) {
      console.log('\n🎉 GOT TOKEN:', result.data.token);
      await testToken(result.data.token);
      return;
    }
  }
  
  console.log('\n=== SUMMARY ===');
  console.log('Could not auto-generate token via API.');
  console.log('Puter likely requires browser-based OAuth flow.');
}

main().catch(console.error);
