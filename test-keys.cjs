require('dotenv').config();
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

(async () => {
    try {
        if (!getApps().length) {
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
            initializeApp({ credential: cert(serviceAccount) });
        }
        const db = getFirestore();
        const auth = getAuth();

        const email = 'imtiyazakiwat0@gmail.com';
        console.log('\n🔍 Fetching keys for:', email);

        const userRecord = await auth.getUserByEmail(email);
        console.log('✅ User UID:', userRecord.uid);

        const userDoc = await db.collection('users').doc(userRecord.uid).get();
        const userData = userDoc.data();
        const puterKeys = userData.puterKeys || [];

        console.log('📦 Found', puterKeys.length, 'Puter keys\n');
        console.log('='.repeat(80));

        // Test each key
        console.log('\n📊 TESTING ALL KEYS:\n');

        let validCount = 0;
        let errorCount = 0;

        for (let i = 0; i < puterKeys.length; i++) {
            const keyData = puterKeys[i];
            const key = typeof keyData === 'string' ? keyData : keyData.key;
            const preview = key.substring(0, 20) + '...' + key.slice(-8);

            try {
                const res = await fetch('https://api.puter.com/whoami', {
                    headers: { 'Authorization': 'Bearer ' + key, 'Origin': 'https://puter.com' }
                });
                const data = await res.json();

                if (data.username || data.uuid) {
                    const usageRes = await fetch('https://api.puter.com/metering/usage', {
                        headers: { 'Authorization': 'Bearer ' + key, 'Origin': 'https://puter.com' }
                    });
                    const usage = await usageRes.json();
                    const remaining = usage.allowanceInfo?.remaining || 0;
                    const allowance = usage.allowanceInfo?.monthUsageAllowance || 0;
                    console.log(`${i + 1}. ✅ ${preview}`);
                    console.log(`   Temp: ${data.is_temp} | Remaining: $${remaining.toFixed(4)} / $${allowance.toFixed(2)}`);
                    validCount++;
                } else {
                    console.log(`${i + 1}. ❌ ${preview} - ${data.message || 'Auth failed'}`);
                    errorCount++;
                }
            } catch (e) {
                console.log(`${i + 1}. ❌ ${preview} - ${e.message}`);
                errorCount++;
            }
        }

        console.log('\n' + '='.repeat(80));
        console.log(`\n📊 SUMMARY: ✅ ${validCount} valid | ❌ ${errorCount} errors\n`);

    } catch (error) {
        console.error('Error:', error.message);
    }

    process.exit(0);
})();
