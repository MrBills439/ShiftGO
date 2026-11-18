module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/.*|native-base|react-native-svg|better-auth|@better-auth/.*|better-call|@better-fetch/.*|nanostores|@nanostores/.*|defu|jose|rou3|uncrypto))',
  ],
  // Better Auth ships .mjs only.
  transform: { '^.+\\.(mjs|[jt]sx?)$': 'babel-jest' },
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  clearMocks: true,
};
