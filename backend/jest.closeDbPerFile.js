// Runs inside every test file (jest.config.js setupFilesAfterEnv). Closes the
// app's shared Prisma pool when the file finishes. Without this each test file
// leaves its pool open, and a full run creeps up to Postgres's connection
// limit ("remaining connection slots are reserved...").
afterAll(async () => {
  const client = globalThis.__shiftgoPrisma;
  if (client) {
    await client.$disconnect().catch(() => {});
    delete globalThis.__shiftgoPrisma;
  }
});
