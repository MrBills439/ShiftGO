// `pretest` hook: make sure the test database exists and its schema is current
// before Jest runs. Reads DATABASE_URL from .env.test (never .env).
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const envTestPath = path.resolve(__dirname, '..', '.env.test');
if (!fs.existsSync(envTestPath)) {
  console.error('backend/.env.test not found. Copy it from .env.test.example first.');
  process.exit(1);
}

const parsed = require('dotenv').parse(fs.readFileSync(envTestPath));
const DATABASE_URL = parsed.DATABASE_URL;

if (!DATABASE_URL || !/(_test|test_|\btest\b)/i.test(DATABASE_URL)) {
  console.error(`.env.test DATABASE_URL (${DATABASE_URL || 'unset'}) does not look like a test database. Aborting.`);
  process.exit(1);
}

console.log(`[prepareTestDb] migrating ${DATABASE_URL.replace(/:\/\/[^@]+@/, '://***@')}`);

// `prisma migrate deploy` creates the database if it doesn't exist yet, then
// applies every migration in prisma/migrations.
execSync('npx prisma migrate deploy', {
  cwd: path.resolve(__dirname, '..'),
  env: { ...process.env, DATABASE_URL },
  stdio: 'inherit',
});
