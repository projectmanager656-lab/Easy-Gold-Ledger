const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getAuth, createUserWithEmailAndPassword } = require('firebase/auth');
const { getFirestore, doc, setDoc } = require('firebase/firestore');

// Helper to manually parse the .env file in Node.js
function parseEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error('.env file not found! Make sure you created it.');
    process.exit(1);
  }
  
  const env = {};
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach((line) => {
    const parts = line.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      env[key] = val;
    }
  });
  return env;
}

async function run() {
  const env = parseEnv();
  
  const email = process.argv[2];
  const password = process.argv[3];
  const name = process.argv[4] || 'Super Admin';
  const phone = process.argv[5] || '9999999999';

  if (!email || !password) {
    console.log('\nUsage: node scripts/create-admin.cjs <email> <password> ["name"] ["phone"]');
    console.log('Example: node scripts/create-admin.cjs admin@example.com mySecurePass123 "Owner Name" "9876543210"\n');
    process.exit(1);
  }

  const firebaseConfig = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID
  };

  console.log(`Initializing Firebase for project: ${firebaseConfig.projectId}...`);
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  try {
    console.log(`Creating user authentication record for ${email}...`);
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;
    console.log(`Auth record created. UID: ${uid}`);

    console.log('Writing Super Admin user role mapping to Firestore...');
    const userDocRef = doc(db, 'users', uid);
    await setDoc(userDocRef, {
      role: 'super_admin',
      name,
      phone,
      email,
      status: 'active',
      createdAt: new Date().toISOString()
    });

    console.log('\n=============================================');
    console.log('SUCCESS: Super Admin account registered!');
    console.log(`Email: ${email}`);
    console.log(`UID: ${uid}`);
    console.log('You can now log in using these credentials.');
    console.log('=============================================\n');
    process.exit(0);
  } catch (error) {
    console.error('\nError creating Super Admin:', error.message);
    process.exit(1);
  }
}

run();
