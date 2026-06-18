import 'dotenv/config';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// Initialize Firebase Admin
if (!getApps().length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (serviceAccount.project_id) {
        initializeApp({ credential: cert(serviceAccount) });
    }
}

const db = getFirestore();
const auth = getAuth();

const PUTER_API_BASE = 'https://api.puter.com';

async function testPuterKey(apiKey, index) {
    const origins = ['https://puter.com', 'https://g4f.dev', 'https://api.puter.com'];

    for (const origin of origins) {
        try {
            const [whoamiRes, usageRes] = await Promise.all([
                fetch(`${PUTER_API_BASE}/whoami`, {
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Origin': origin }
                }),
                fetch(`${PUTER_API_BASE}/metering/usage`, {
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Origin': origin }
                })
            ]);

            const whoami = await whoamiRes.json();
            const usageData = await usageRes.json();

            if (whoami.username || whoami.uuid) {
                const remaining = usageData.allowanceInfo?.remaining || 0;
                const allowance = usageData.allowanceInfo?.monthUsageAllowance || 0;
                const used = usageData.usage?.total || 0;

                return {
                    index,
                    preview: apiKey.substring(0, 20) + '...' + apiKey.slice(-8),
                    status: '✅ VALID',
                    isTemp: whoami.is_temp,
                    username: whoami.username,
                    remaining: `$${remaining.toFixed(4)}`,
                    allowance: `$${allowance.toFixed(2)}`,
                    used: `$${used.toFixed(6)}`
                };
            }
        } catch (e) {
            continue;
        }
    }

    // Try a simple chat completion test
    try {
        const res = await fetch(`${PUTER_API_BASE}/drivers/call`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                interface: 'puter-chat-completion',
                driver: 'openrouter',
                method: 'complete',
                args: {
                    messages: [{ role: 'user', content: 'Hi' }],
                    model: 'openrouter:openai/gpt-4o-mini',
                    max_tokens: 5
                }
            })
        });
        const text = await res.text();
        if (text === 'Forbidden' || text.includes('token_auth_failed')) {
            return {
                index,
                preview: apiKey.substring(0, 20) + '...' + apiKey.slice(-8),
                status: '❌ ERROR',
                error: 'Forbidden/Auth Failed'
            };
        }
    } catch (e) {
        // ignore
    }

    return {
        index,
        preview: apiKey.substring(0, 20) + '...' + apiKey.slice(-8),
        status: '❌ ERROR',
        error: 'Failed to fetch usage'
    };
}

async function main() {
    const email = 'imtiyazakiwat0@gmail.com';

    console.log(`\n🔍 Fetching Puter keys for: ${email}\n`);
    console.log('='.repeat(80));

    try {
        // Find user by email
        const userRecord = await auth.getUserByEmail(email);
        console.log(`✅ Found user: ${userRecord.uid}\n`);

        // Get user document from Firestore
        const userDoc = await db.collection('users').doc(userRecord.uid).get();

        if (!userDoc.exists) {
            console.log('❌ User document not found in Firestore');
            return;
        }

        const userData = userDoc.data();
        const puterKeys = userData.puterKeys || [];

        console.log(`📦 Found ${puterKeys.length} Puter keys\n`);

        if (puterKeys.length === 0) {
            console.log('No keys to test.');
            return;
        }

        // Test each key
        const results = [];
        for (let i = 0; i < puterKeys.length; i++) {
            const keyData = puterKeys[i];
            const key = typeof keyData === 'string' ? keyData : keyData.key;
            console.log(`Testing key ${i + 1}/${puterKeys.length}...`);
            const result = await testPuterKey(key, i + 1);
            results.push(result);
        }

        console.log('\n' + '='.repeat(80));
        console.log('\n📊 RESULTS:\n');

        const valid = results.filter(r => r.status.includes('✅'));
        const invalid = results.filter(r => r.status.includes('❌'));

        console.log(`✅ Valid: ${valid.length} | ❌ Invalid: ${invalid.length}\n`);

        console.log('--- VALID KEYS ---');
        valid.forEach(r => {
            console.log(`  #${r.index}: ${r.preview}`);
            console.log(`       Temp: ${r.isTemp} | User: ${r.username || 'N/A'}`);
            console.log(`       Used: ${r.used} | Remaining: ${r.remaining} / ${r.allowance}`);
        });

        console.log('\n--- INVALID KEYS ---');
        invalid.forEach(r => {
            console.log(`  #${r.index}: ${r.preview} - ${r.error}`);
        });

    } catch (error) {
        console.error('Error:', error.message);
    }
}

main().catch(console.error);
