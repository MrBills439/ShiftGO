// Runs (via jest.config.js `setupFiles`) before any test file or app module is
// required. Force-loads .env.test so DATABASE_URL points at the throwaway test
// database — otherwise `npm test` runs against, and wipes, dev data.
const fs = require('fs');
const path = require('path');

const envTestPath = path.resolve(__dirname, '.env.test');
if (fs.existsSync(envTestPath)) {
  const parsed = require('dotenv').parse(fs.readFileSync(envTestPath));
  for (const [key, value] of Object.entries(parsed)) {
    // Override — the whole point is to beat the shell and .env.
    process.env[key] = value;
  }
}

process.env.NODE_ENV = 'test';

if (!/(_test|test_|\btest\b)/i.test(process.env.DATABASE_URL || '')) {
  throw new Error(
    `Refusing to run tests: DATABASE_URL (${process.env.DATABASE_URL || 'unset'}) does not look like a test database. ` +
      'Create backend/.env.test from .env.test.example.'
  );
}
