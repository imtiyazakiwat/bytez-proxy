// Compare Claude driver vs OpenRouter driver for Claude models
const PUTER_URL = 'https://api.puter.com/drivers/call';
const PUTER_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0IjoiYXUiLCJ2IjoiMC4wLjAiLCJ1dSI6Ijd3eEIvVllHUnc2eFVaTGYvMHJlcnc9PSIsImF1IjoiaWRnL2ZEMDdVTkdhSk5sNXpXUGZhUT09IiwicyI6ImNYOFoyUVFGZXFjN3pseURBNUdIMkE9PSIsImlhdCI6MTc1ODI2NDIwOX0.QlHPgXjy3TRK5zBTWRtcNaEgn9T2p6GWHwlaY_QLtjU';

const TESTS = [
  { name: 'Claude Sonnet 4', claude: 'claude-sonnet-4-20250514', openrouter: 'anthropic/claude-sonnet-4' },
  { name: 'Claude 3.7 Sonnet', claude: 'claude-3-7-sonnet-20250219', openrouter: 'anthropic/claude-3.7-sonnet' },
  { name: 'Claude 3.5 Sonnet', claude: 'claude-3-5-sonnet-20241022', openrouter: 'anthropic/claude-3.5-sonnet' },
];

const PROMPT = 'What is 2+2? Reply with just the number.';

async function callPuter(driver, model) {
  const start = Date.now();
  const res = await fetch(PUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://puter.com',
      'Authorization': `Bearer ${PUTER_KEY}`
    },
    body: JSON.stringify({
      interface: 'puter-chat-completion',
      driver,
      method: 'complete',
      args: {
        messages: [{ role: 'user', content: PROMPT }],
        model: driver === 'openrouter' ? `openrouter:${model}` : model
      }
    })
  });
  const data = await res.json();
  const latency = Date.now() - start;
  
  let content = '';
  let tokens = { input: 0, output: 0, total: 0 };
  let cost = { input: 0, output: 0, total: 0 };
  
  if (data.success) {
    // Extract content
    if (data.result?.message?.content) {
      content = Array.isArray(data.result.message.content) 
        ? data.result.message.content[0]?.text 
        : data.result.message.content;
    }
    // Extract tokens and cost
    const usage = data.result?.usage;
    if (Array.isArray(usage)) {
      // OpenRouter format: [{type: "prompt", amount: X, cost: Y}, {type: "completion", ...}]
      const prompt = usage.find(u => u.type === 'prompt') || {};
      const completion = usage.find(u => u.type === 'completion') || {};
      tokens = { 
        input: prompt.amount || 0, 
        output: completion.amount || 0,
        total: (prompt.amount || 0) + (completion.amount || 0)
      };
      cost = {
        input: prompt.cost || 0,
        output: completion.cost || 0,
        total: (prompt.cost || 0) + (completion.cost || 0)
      };
    } else if (usage) {
      // Claude driver format: {input_tokens: X, output_tokens: Y}
      tokens = {
        input: usage.input_tokens || 0,
        output: usage.output_tokens || 0,
        total: (usage.input_tokens || 0) + (usage.output_tokens || 0)
      };
      // Claude driver doesn't return cost - we'll mark as N/A
      cost = { input: null, output: null, total: null };
    }
  }
  
  return { success: data.success, latency, content, tokens, cost, error: data.error };
}

async function runTests() {
  console.log('🔬 Claude Driver vs OpenRouter Driver Comparison\n');
  console.log('='.repeat(70));
  
  const results = { claude: [], openrouter: [] };
  
  for (const test of TESTS) {
    console.log(`\n📌 ${test.name}`);
    
    // Test Claude driver
    process.stdout.write('   Claude driver:     ');
    const claudeResult = await callPuter('claude', test.claude);
    if (claudeResult.success) {
      const costStr = claudeResult.cost.total !== null ? `$${(claudeResult.cost.total / 1e9).toFixed(6)}` : 'N/A';
      console.log(`✅ ${claudeResult.latency}ms | ${claudeResult.tokens.total} tokens | cost: ${costStr}`);
      results.claude.push({ latency: claudeResult.latency, tokens: claudeResult.tokens, cost: claudeResult.cost });
    } else {
      console.log(`❌ ${claudeResult.error || 'Failed'}`);
    }
    
    // Test OpenRouter driver
    process.stdout.write('   OpenRouter driver: ');
    const orResult = await callPuter('openrouter', test.openrouter);
    if (orResult.success) {
      const costStr = orResult.cost.total !== null ? `$${(orResult.cost.total / 1e9).toFixed(6)}` : 'N/A';
      console.log(`✅ ${orResult.latency}ms | ${orResult.tokens.total} tokens | cost: ${costStr}`);
      results.openrouter.push({ latency: orResult.latency, tokens: orResult.tokens, cost: orResult.cost });
    } else {
      console.log(`❌ ${orResult.error || 'Failed'}`);
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('\n📊 SUMMARY\n');
  
  if (results.claude.length > 0) {
    const avgLatency = Math.round(results.claude.reduce((a, b) => a + b.latency, 0) / results.claude.length);
    const avgTokens = Math.round(results.claude.reduce((a, b) => a + b.tokens.total, 0) / results.claude.length);
    console.log(`   Claude driver:     ${avgLatency}ms avg | ${avgTokens} tokens avg | cost: N/A (not reported)`);
    console.log(`                      (${results.claude.length}/${TESTS.length} models worked)`);
  }
  if (results.openrouter.length > 0) {
    const avgLatency = Math.round(results.openrouter.reduce((a, b) => a + b.latency, 0) / results.openrouter.length);
    const avgTokens = Math.round(results.openrouter.reduce((a, b) => a + b.tokens.total, 0) / results.openrouter.length);
    const totalCost = results.openrouter.reduce((a, b) => a + (b.cost.total || 0), 0);
    const avgCost = totalCost / results.openrouter.length;
    console.log(`   OpenRouter driver: ${avgLatency}ms avg | ${avgTokens} tokens avg | cost: $${(avgCost / 1e9).toFixed(6)} avg`);
    console.log(`                      (${results.openrouter.length}/${TESTS.length} models worked)`);
  }
  
  console.log('\n💰 COST BREAKDOWN (OpenRouter only - Claude driver doesn\'t report costs):');
  results.openrouter.forEach((r, i) => {
    if (r.cost.total !== null) {
      console.log(`   ${TESTS[i]?.name || 'Model ' + i}: input $${(r.cost.input / 1e9).toFixed(6)} + output $${(r.cost.output / 1e9).toFixed(6)} = $${(r.cost.total / 1e9).toFixed(6)}`);
    }
  });
  
  console.log('\n💡 RECOMMENDATION:');
  if (results.claude.length < results.openrouter.length) {
    console.log('   → Use OpenRouter for better model availability');
    console.log('   → Claude driver doesn\'t report usage costs (may still be billed)');
  } else if (results.claude.length > 0) {
    const avgC = results.claude.reduce((a, b) => a + b.latency, 0) / results.claude.length;
    const avgO = results.openrouter.reduce((a, b) => a + b.latency, 0) / results.openrouter.length;
    if (avgC < avgO * 0.8) {
      console.log('   → Claude driver is faster, but OpenRouter has more models + cost visibility');
    } else {
      console.log('   → OpenRouter recommended for consistency, model variety, and cost tracking');
    }
  }
}

runTests().catch(console.error);
