// Comprehensive streaming comparison: Claude driver vs OpenRouter driver
const PUTER_URL = 'https://api.puter.com/drivers/call';
const PUTER_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0IjoiYXUiLCJ2IjoiMC4wLjAiLCJ1dSI6Ijd3eEIvVllHUnc2eFVaTGYvMHJlcnc9PSIsImF1IjoiaWRnL2ZEMDdVTkdhSk5sNXpXUGZhUT09IiwicyI6ImNYOFoyUVFGZXFjN3pseURBNUdIMkE9PSIsImlhdCI6MTc1ODI2NDIwOX0.QlHPgXjy3TRK5zBTWRtcNaEgn9T2p6GWHwlaY_QLtjU';

// Longer prompt to get substantial output
const PROMPT = `Explain how JavaScript's event loop works, including the call stack, callback queue, and microtask queue. Give a detailed explanation with examples.`;

const TESTS = [
  { name: 'Claude Sonnet 4', claude: 'claude-sonnet-4-20250514', openrouter: 'anthropic/claude-sonnet-4' },
  { name: 'Claude 3.7 Sonnet', claude: 'claude-3-7-sonnet-20250219', openrouter: 'anthropic/claude-3.7-sonnet' },
];

async function testStream(driver, model, stream = true) {
  const startTime = Date.now();
  let firstTokenTime = null;
  let totalChunks = 0;
  let totalContent = '';
  let tokens = { input: 0, output: 0 };
  
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
        model: driver === 'openrouter' ? `openrouter:${model}` : model,
        stream,
        max_tokens: 1000
      }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    return { error: err, success: false };
  }

  const contentType = res.headers.get('content-type') || '';
  
  // Non-streaming JSON response
  if (contentType.includes('application/json') || !stream) {
    const data = await res.json();
    const endTime = Date.now();
    
    if (!data.success) {
      return { error: data.error, success: false };
    }
    
    // Extract content
    if (data.result?.message?.content) {
      totalContent = Array.isArray(data.result.message.content)
        ? data.result.message.content.map(c => c.text || '').join('')
        : data.result.message.content;
    }
    
    // Extract tokens
    const usage = data.result?.usage;
    if (Array.isArray(usage)) {
      tokens.input = usage.find(u => u.type === 'prompt')?.amount || 0;
      tokens.output = usage.find(u => u.type === 'completion')?.amount || 0;
    } else if (usage) {
      tokens.input = usage.input_tokens || 0;
      tokens.output = usage.output_tokens || 0;
    }
    
    return {
      success: true,
      streaming: false,
      ttft: endTime - startTime, // For non-streaming, TTFT = total time
      totalTime: endTime - startTime,
      chunks: 1,
      contentLength: totalContent.length,
      tokens,
      tokensPerSecond: tokens.output / ((endTime - startTime) / 1000)
    };
  }

  // Streaming response
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // Process lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === '%') continue;

        try {
          const data = JSON.parse(trimmed);
          
          // First content chunk
          if (!firstTokenTime && (data.text || data.type === 'text')) {
            firstTokenTime = Date.now();
          }
          
          if (data.text) {
            totalContent += data.text;
            totalChunks++;
          } else if (data.type === 'text' && data.text) {
            totalContent += data.text;
            totalChunks++;
          }
          
          // Check for usage in final chunk
          if (data.usage) {
            if (Array.isArray(data.usage)) {
              tokens.input = data.usage.find(u => u.type === 'prompt')?.amount || 0;
              tokens.output = data.usage.find(u => u.type === 'completion')?.amount || 0;
            } else {
              tokens.input = data.usage.input_tokens || 0;
              tokens.output = data.usage.output_tokens || 0;
            }
          }
        } catch (e) {
          // Skip non-JSON lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const endTime = Date.now();
  const totalTime = endTime - startTime;
  const ttft = firstTokenTime ? firstTokenTime - startTime : totalTime;

  return {
    success: true,
    streaming: true,
    ttft,
    totalTime,
    chunks: totalChunks,
    contentLength: totalContent.length,
    tokens,
    tokensPerSecond: tokens.output > 0 ? tokens.output / (totalTime / 1000) : totalContent.length / 4 / (totalTime / 1000)
  };
}

async function runTests() {
  console.log('🔬 Claude vs OpenRouter Streaming Comparison');
  console.log('   Prompt: "Explain JavaScript event loop..." (expecting ~500-1000 tokens output)\n');
  console.log('='.repeat(85));

  const results = [];

  for (const test of TESTS) {
    console.log(`\n📌 ${test.name}\n`);

    // Test Claude driver - streaming
    process.stdout.write('   Claude (stream):     ');
    const claudeStream = await testStream('claude', test.claude, true);
    if (claudeStream.success) {
      console.log(`✅ TTFT: ${claudeStream.ttft}ms | Total: ${claudeStream.totalTime}ms | ${claudeStream.tokens.output || '~' + Math.round(claudeStream.contentLength/4)} tokens | ${claudeStream.tokensPerSecond.toFixed(1)} tok/s`);
    } else {
      console.log(`❌ ${claudeStream.error}`);
    }

    // Test Claude driver - non-streaming
    process.stdout.write('   Claude (no-stream):  ');
    const claudeNoStream = await testStream('claude', test.claude, false);
    if (claudeNoStream.success) {
      console.log(`✅ TTFT: ${claudeNoStream.ttft}ms | Total: ${claudeNoStream.totalTime}ms | ${claudeNoStream.tokens.output || '~' + Math.round(claudeNoStream.contentLength/4)} tokens | ${claudeNoStream.tokensPerSecond.toFixed(1)} tok/s`);
    } else {
      console.log(`❌ ${claudeNoStream.error}`);
    }

    // Test OpenRouter driver - streaming
    process.stdout.write('   OpenRouter (stream): ');
    const orStream = await testStream('openrouter', test.openrouter, true);
    if (orStream.success) {
      console.log(`✅ TTFT: ${orStream.ttft}ms | Total: ${orStream.totalTime}ms | ${orStream.tokens.output || '~' + Math.round(orStream.contentLength/4)} tokens | ${orStream.tokensPerSecond.toFixed(1)} tok/s`);
    } else {
      console.log(`❌ ${orStream.error}`);
    }

    // Test OpenRouter driver - non-streaming  
    process.stdout.write('   OpenRouter (no-str): ');
    const orNoStream = await testStream('openrouter', test.openrouter, false);
    if (orNoStream.success) {
      console.log(`✅ TTFT: ${orNoStream.ttft}ms | Total: ${orNoStream.totalTime}ms | ${orNoStream.tokens.output || '~' + Math.round(orNoStream.contentLength/4)} tokens | ${orNoStream.tokensPerSecond.toFixed(1)} tok/s`);
    } else {
      console.log(`❌ ${orNoStream.error}`);
    }

    results.push({
      model: test.name,
      claudeStream,
      claudeNoStream,
      orStream,
      orNoStream
    });
  }

  // Summary
  console.log('\n' + '='.repeat(85));
  console.log('\n📊 COMPREHENSIVE SUMMARY\n');

  console.log('┌─────────────────────┬────────────┬────────────┬────────────┬────────────┐');
  console.log('│ Metric              │ Claude Str │ Claude NoS │ OR Stream  │ OR NoStr   │');
  console.log('├─────────────────────┼────────────┼────────────┼────────────┼────────────┤');

  const metrics = ['ttft', 'totalTime', 'tokensPerSecond'];
  const labels = ['Time to First Token', 'Total Time (ms)', 'Tokens/Second'];

  for (let i = 0; i < metrics.length; i++) {
    const metric = metrics[i];
    const label = labels[i];
    
    const vals = results.map(r => ({
      cs: r.claudeStream.success ? r.claudeStream[metric] : null,
      cn: r.claudeNoStream.success ? r.claudeNoStream[metric] : null,
      os: r.orStream.success ? r.orStream[metric] : null,
      on: r.orNoStream.success ? r.orNoStream[metric] : null
    }));

    // Average across models
    const avg = (arr) => {
      const valid = arr.filter(v => v !== null);
      return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    };

    const csAvg = avg(vals.map(v => v.cs));
    const cnAvg = avg(vals.map(v => v.cn));
    const osAvg = avg(vals.map(v => v.os));
    const onAvg = avg(vals.map(v => v.on));

    const fmt = (v) => v !== null ? (metric === 'tokensPerSecond' ? v.toFixed(1) : Math.round(v).toString()) : 'N/A';
    
    console.log(`│ ${label.padEnd(19)} │ ${fmt(csAvg).padStart(10)} │ ${fmt(cnAvg).padStart(10)} │ ${fmt(osAvg).padStart(10)} │ ${fmt(onAvg).padStart(10)} │`);
  }

  console.log('└─────────────────────┴────────────┴────────────┴────────────┴────────────┘');

  console.log('\n💡 KEY FINDINGS:\n');
  
  // Calculate averages for comparison
  const claudeStreamTTFT = results.filter(r => r.claudeStream.success).map(r => r.claudeStream.ttft);
  const orStreamTTFT = results.filter(r => r.orStream.success).map(r => r.orStream.ttft);
  const claudeStreamTotal = results.filter(r => r.claudeStream.success).map(r => r.claudeStream.totalTime);
  const orStreamTotal = results.filter(r => r.orStream.success).map(r => r.orStream.totalTime);

  if (claudeStreamTTFT.length && orStreamTTFT.length) {
    const avgClaudeTTFT = claudeStreamTTFT.reduce((a, b) => a + b, 0) / claudeStreamTTFT.length;
    const avgOrTTFT = orStreamTTFT.reduce((a, b) => a + b, 0) / orStreamTTFT.length;
    const ttftDiff = ((avgOrTTFT - avgClaudeTTFT) / avgOrTTFT * 100).toFixed(0);
    
    if (avgClaudeTTFT < avgOrTTFT) {
      console.log(`   ⚡ Claude driver TTFT is ${ttftDiff}% faster (${Math.round(avgClaudeTTFT)}ms vs ${Math.round(avgOrTTFT)}ms)`);
    } else {
      console.log(`   ⚡ OpenRouter TTFT is ${-ttftDiff}% faster (${Math.round(avgOrTTFT)}ms vs ${Math.round(avgClaudeTTFT)}ms)`);
    }
  }

  if (claudeStreamTotal.length && orStreamTotal.length) {
    const avgClaudeTotal = claudeStreamTotal.reduce((a, b) => a + b, 0) / claudeStreamTotal.length;
    const avgOrTotal = orStreamTotal.reduce((a, b) => a + b, 0) / orStreamTotal.length;
    const totalDiff = ((avgOrTotal - avgClaudeTotal) / avgOrTotal * 100).toFixed(0);
    
    if (avgClaudeTotal < avgOrTotal) {
      console.log(`   🏎️  Claude driver total time is ${totalDiff}% faster (${Math.round(avgClaudeTotal)}ms vs ${Math.round(avgOrTotal)}ms)`);
    } else {
      console.log(`   🏎️  OpenRouter total time is ${-totalDiff}% faster (${Math.round(avgOrTotal)}ms vs ${Math.round(avgClaudeTotal)}ms)`);
    }
  }

  console.log('\n   📝 Model Availability:');
  console.log('      - Claude driver: Works with Sonnet 4, 3.7 (NOT 3.5)');
  console.log('      - OpenRouter: Works with ALL Claude models');
  
  console.log('\n   💰 Cost Tracking:');
  console.log('      - Claude driver: Does NOT report per-request costs');
  console.log('      - OpenRouter: Reports detailed cost breakdown per request');

  console.log('\n🎯 RECOMMENDATION:');
  console.log('   For Claude models specifically:');
  console.log('   → Use Claude driver for Sonnet 4 / 3.7 if speed is critical');
  console.log('   → Use OpenRouter for broader model support + cost visibility');
  console.log('   → Consider hybrid: Claude driver for latest models, OpenRouter for older ones');
}

runTests().catch(console.error);
