import { callG4F } from './api/g4f.js';

async function test() {
  console.log('Testing GLM 4.7 via G4F driver...\n');
  
  try {
    const result = await callG4F(
      [{ role: 'user', content: 'Say hello in one short sentence' }],
      'g4f:glm-4.7'
    );
    console.log('✅ SUCCESS!');
    console.log('Response:', result.choices[0].message.content);
    console.log('Model:', result.model);
  } catch (error) {
    console.log('❌ ERROR:', error.message);
  }
}

test();
