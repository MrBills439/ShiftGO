module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  // Loads .env.test and pins DATABASE_URL to the test database before any
  // app module is required. See jest.setup.js.
  setupFiles: ['<rootDir>/jest.setup.js'],
  clearMocks: true,
  watchman: false,
};
