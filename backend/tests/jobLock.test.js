// Week 2: a cron tick must run on only one API instance at a time.
process.env.NODE_ENV = 'test';
const prisma = require('../src/lib/prisma');
const { withJobLock } = require('../src/jobs/jobLock');

afterAll(() => prisma.$disconnect());

test('two overlapping runs of the same job: only one executes', async () => {
  let runs = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const slowJob = async () => { runs += 1; await gate; return 'done'; };

  const first = withJobLock('test-job', slowJob);
  await new Promise((r) => setTimeout(r, 200)); // let the first take the lock
  const second = await withJobLock('test-job', slowJob);
  expect(second).toEqual({ ran: false });

  release();
  expect(await first).toEqual({ ran: true, result: 'done' });
  expect(runs).toBe(1);
});

test('the lock is released when the run ends (and different jobs do not block each other)', async () => {
  expect(await withJobLock('test-job', async () => 1)).toEqual({ ran: true, result: 1 });
  expect(await withJobLock('test-job', async () => 2)).toEqual({ ran: true, result: 2 });
  const [a, b] = await Promise.all([
    withJobLock('job-a', async () => 'a'),
    withJobLock('job-b', async () => 'b'),
  ]);
  expect([a.ran, b.ran]).toEqual([true, true]);
});

test('a failing job releases the lock', async () => {
  await expect(withJobLock('test-fail', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  expect(await withJobLock('test-fail', async () => 'ok')).toEqual({ ran: true, result: 'ok' });
});
