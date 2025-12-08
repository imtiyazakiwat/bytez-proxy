// Test Puter Drivers API with Web Search
// 
// IMPORTANT FINDINGS:
// - :online suffix works in Puter.js (browser SDK) but NOT in Drivers API
// - Drivers API validates model names and rejects :online suffix
// - For server-side web search, use NATIVE web search models
//
const PUTER_URL = 'https://api.puter.com/drivers/call';
const PUTER_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0IjoiYXUiLCJ2IjoiMC4wLjAiLCJ1dSI6InZZVW5TVTZJVGZtOFRMcGowN2ZIVUE9PSIsImF1IjoiaWRnL2ZEMDdVTkdhSk5sNXpXUGZhUT09IiwicyI6ImpsWU5uR21sWGNScHZwUlR0eWtod0E9PSIsImlhdCI6MTc1NzUwMzEzM30.GKGGVZZ1aM3mZv0uiLrl6kxgRRWr4jcwExN781O1KD0';

const PROMPT = 'What is today\'s date and what are the top 3 news headlines today?';

// Models with NATIVE web search (work with Puter Drivers API)
const NATIVE_SEARCH_MODELS = [
  { name: 'Perplexity Sonar', model: 'perplexity/sonar' },
  { name: 'Perplexity Sonar Pro', model: 'perplexity/sonar-pro' },
  { name: 'GPT-4o Search Preview', model: 'openai/gpt-4o-search-preview' },
  { name: 'GPT-4o Mini Search', model: 'openai/gpt-4o-mini-search-preview' },
];

async function testWebSearch() {
  console.log('🔍 Puter Drivers API - Web Search Test\n');
  console.log('='.repeat(70));
  
  // First show that :online doesn't work
  console.log('\n❌ :online suffix does NOT work with Drivers API:');
  console.log('   openrouter:openai/gpt-4o:online → "Field model is invalid"');
  console.log('   (Works only in Puter.js browser SDK, not server-side API)\n');
  
  console.log('✅ Use NATIVE web search models instead:\n');
  console.log(`Prompt: "${PROMPT}"\n`);
  console.log('-'.repeat(70));

  for (const { name, model } of NATIVE_SEARCH_MODELS) {
    console.log(`\n📌 ${name}`);
    await callPuter(`openrouter:${model}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('\n📊 SUMMARY - Web Search with Puter Drivers API:');
  console.log('');
  console.log('   ❌ NOT SUPPORTED:');
  console.log('      - :online suffix (e.g., openrouter:openai/gpt-4o:online)');
  console.log('      - plugins: [{ id: "web" }] parameter');
  console.log('');
  console.log('   ✅ SUPPORTED (use native search models):');
  console.log('      - openrouter:perplexity/sonar (cheapest)');
  console.log('      - openrouter:perplexity/sonar-pro (detailed)');
  console.log('      - openrouter:openai/gpt-4o-search-preview (best quality)');
  console.log('      - openrouter:openai/gpt-4o-mini-search-preview (fast & cheap)');
}

async function callPuter(model) {
  const start = Date.now();
  console.log(`   Model: ${model}`);

  try {
    const res = await fetch(PUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://puter.com',
        'Authorization': `Bearer ${PUTER_KEY}`
      },
      body: JSON.stringify({
        interface: 'puter-chat-completion',
        driver: 'openrouter',
        method: 'complete',
        args: {
          messages: [{ role: 'user', content: PROMPT }],
          model
        }
      })
    });

    const data = await res.json();
    const latency = Date.now() - start;

    if (data.success) {
      let content = '';
      if (data.result?.message?.content) {
        content = Array.isArray(data.result.message.content)
          ? data.result.message.content[0]?.text
          : data.result.message.content;
      }
      
      // Extract cost
      let cost = 0;
      const usage = data.result?.usage;
      if (Array.isArray(usage)) {
        cost = usage.reduce((sum, u) => sum + (u.cost || 0), 0);
      }
      
      const costStr = cost > 0 ? `$${(cost / 1e9).toFixed(6)}` : 'N/A';
      console.log(`   ✅ ${latency}ms | Cost: ${costStr}`);
      console.log(`   ${content?.substring(0, 300).replace(/\n/g, ' ')}...`);
    } else {
      console.log(`   ❌ ${data.error?.message || JSON.stringify(data.error)}`);
    }
  } catch (err) {
    console.log(`   ❌ ${err.message}`);
  }
}

testWebSearch().catch(console.error);
