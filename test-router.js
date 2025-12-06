// Test script for model routing with Gemini Flash Lite
const API_URL = 'http://localhost:3000/v1/chat/completions';
const API_KEY = 'sk-0000d80ad3c542d29120527e66963a2e';
const ROUTER_MODEL = 'openrouter:google/gemini-2.0-flash-lite-001';

const SYSTEM_PROMPT = `You are a model router. Given a user question, respond with ONLY the model ID that best fits. Choose from:

- deepseek/deepseek-chat: Fast general chat, simple Q&A, translations, summaries, casual conversation
- deepseek/deepseek-coder: Code generation, debugging, programming tasks, technical implementation
- deepseek/deepseek-reasoner: Complex math, logic puzzles, multi-step reasoning, problem solving
- deepseek/deepseek-v3.2-speciale: Deep analysis, research questions, nuanced topics, philosophical discussions

Respond with ONLY the model ID, nothing else.`;

const testQuestions = [
  "Write a Python function to sort a list",
  "What is 2+2?",
  "Explain quantum entanglement in simple terms",
  "Solve: If x + 5 = 12, what is x?",
  "Debug this code: for i in range(10) print(i)",
  "What's the weather like today?",
  "Prove that the square root of 2 is irrational",
  "Translate 'hello' to Spanish",
  "What are the ethical implications of AI?",
  "Create a REST API endpoint in Node.js"
];

async function routeQuestion(question) {
  const start = Date.now();
  
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: ROUTER_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: question }
      ],
      max_tokens: 50
    })
  });

  const data = await response.json();
  const latency = Date.now() - start;
  const selectedModel = data.choices?.[0]?.message?.content?.trim() || 'ERROR';
  
  return { question, selectedModel, latency };
}

async function runTests() {
  console.log('🚀 Model Router Test\n');
  console.log(`Router: ${ROUTER_MODEL}\n`);
  console.log('='.repeat(80));
  
  let totalLatency = 0;
  
  for (const question of testQuestions) {
    try {
      const result = await routeQuestion(question);
      totalLatency += result.latency;
      
      const shortQ = question.length > 45 ? question.substring(0, 45) + '...' : question;
      console.log(`\n📝 "${shortQ}"`);
      console.log(`   → ${result.selectedModel} (${result.latency}ms)`);
    } catch (err) {
      console.log(`\n❌ "${question}"`);
      console.log(`   Error: ${err.message}`);
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log(`\n📊 Average routing latency: ${Math.round(totalLatency / testQuestions.length)}ms`);
}

runTests().catch(console.error);
