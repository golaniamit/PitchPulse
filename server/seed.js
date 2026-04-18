require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const db = require('./db');

async function seed() {
  // Create admin
  const adminHash = await bcrypt.hash('admin123', 10);
  try {
    db.prepare('INSERT INTO users (username, password_hash, balance, is_admin) VALUES (?, ?, ?, 1)').run('admin', adminHash, 10000);
    console.log('Admin user created: admin / admin123');
  } catch (e) {
    console.log('Admin already exists');
  }

  // Create test users
  const userHash = await bcrypt.hash('pass123', 10);
  const testUsers = ['testuser1', 'testuser2', 'testuser3'];
  for (const u of testUsers) {
    try {
      db.prepare('INSERT INTO users (username, password_hash, balance) VALUES (?, ?, 1000)').run(u, userHash);
      console.log(`Test user created: ${u} / pass123`);
    } catch (e) {
      console.log(`${u} already exists`);
    }
  }

  console.log('\nSeed complete.');
  process.exit(0);
}

seed().catch(console.error);
