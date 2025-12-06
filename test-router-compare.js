// Compare top 3 router models for latency
const API_URL = 'http://localhost:3000/v1/chat/completions';
const API_KEY = 'sk-0000d80ad3c542d29120527e66963a2e';

const ROUTER_MODELS = [
  'openrouter:google/gemini-2.5-flash-lite',
  'openrouter:openai/gpt-3.5-turbo',
  'openrouter:google/gemini-2.0-flash-lite-001'
];

const SYSTEM_PROMPT = `You are a model router. Given a user question, respond with ONLY the model ID that best fits. Choose from:
- deepseek/deepseek-chat: Fast general chat, simple Q&A, translations, summaries
- deepseek/deepseek-coder: Code generation, debugging, programming tasks
- deepseek/deepseek-reasoner: Complex math, logic puzzles, multi-step reasoning
- deepseek/deepseek-v3.2-speciale: Deep analysis, research, nuanced topics
Respond with ONLY the model ID, nothing else.`;

const testQuestions = [
  "Write a Python function to sort a list",
  "What is 2+2?",
  "Prove that sqrt(2) is irrational",
  "What are the ethical implications of AI?",
  "Debug: for i in range(10) print(i)"
];

async function testModel(model, question) {
  const start = Date.now();
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: question }],
      max_tokens: 50
    })
  });
  const data = await response.json();
  return { latency: Date.now() - start, result: data.choices?.[0]?.message?.content?.trim() || 'ERROR' };
}

async function runComparison() {
  console.log('🏁 Router Model Comparison\n');
  
  const results = {};
  for (const model of ROUTER_MODELS) {
    results[model] = { totalLatency: 0, tests: [] };
  }

  for (const question of testQuestions) {
    const shortQ = question.length > 40 ? question.substring(0, 40) + '...' : question;
    console.log(`\n📝 "${shortQ}"`);
    
    for (const model of ROUTER_MODELS) {
      const { latency, result } = await testModel(model, question);
      results[model].totalLatency += latency;
      results[model].tests.push({ question: shortQ, latency, result });
      
      const modelName = model.split('/').pop();
      console.log(`   ${modelName.padEnd(25)} → ${result.padEnd(30)} (${latency}ms)`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('\n📊 SUMMARY (Average Latency):\n');
  
  const sorted = ROUTER_MODELS.map(m => ({
    model: m.split('/').pop(),
    avg: Math.round(results[m].totalLatency / testQuestions.length)
  })).sort((a, b) => a.avg - b.avg);

  sorted.forEach((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
    console.log(`${medal} ${r.model.padEnd(28)} ${r.avg}ms avg`);
  });
}

runComparison().catch(console.error);
