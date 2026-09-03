/**
 * Seed a realistic shift history for the worker `feddy439@icloud.com` so the
 * same data can be viewed on both the mobile app and the web dashboard.
 *
 *   - 5 past shifts (COMPLETED) each with an APPROVED timesheet
 *   - 1 shift whose window is active right now (SCHEDULED)
 *   - 5 upcoming shifts (SCHEDULED)
 *
 * Idempotent: wipes feddy's existing shifts + timesheets first, then reseeds.
 *
 *   node scripts/seedFeddyShifts.js
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const AGENCY_ID = 'cmt0jfmoc000bl6ccykbw1wr6'; // Mobile Test Agency
const WORKER_ID = 'cmtd8njm60004t7wc7opzy1nn'; // feddy439@icloud.com
const CREATED_BY = 'cmtd8njsg0006t7wcb61y0bu9'; // demonbillz@gmail.com (MANAGER)

const HOUSE = {
  sunflower: 'demo-sunflower-house',       // Sunflower House
  barnsole309: 'cmt358hn30001u9av48dhlmqx', // 309 Barnsole Road
};

const DAY = 86_400_000;

/** Build a Date at `hh:mm` local time on the day `offsetDays` from today. */
function at(offsetDays, hh, mm = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hh, mm, 0, 0);
  return d;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function hoursBetween(a, b) {
  return Math.round(((b.getTime() - a.getTime()) / 3_600_000) * 100) / 100;
}

// ─── Shift definitions ───────────────────────────────────────────────────────
const now = new Date();

const PAST = [
  { offset: -10, type: 'LONG_DAY',   start: [7, 30], end: [19, 30], house: HOUSE.sunflower },
  { offset: -8,  type: 'WAKE_NIGHT', start: [20, 0], end: [8, 0],   house: HOUSE.barnsole309, endsNextDay: true },
  { offset: -5,  type: 'MID_DAY',    start: [9, 0],  end: [17, 0],  house: HOUSE.sunflower },
  { offset: -3,  type: 'LONG_DAY',   start: [7, 30], end: [19, 30], house: HOUSE.barnsole309 },
  { offset: -1,  type: 'MID_DAY',    start: [10, 0], end: [18, 0],  house: HOUSE.sunflower },
];

const UPCOMING = [
  { offset: 1,  type: 'LONG_DAY',   start: [7, 30], end: [19, 30], house: HOUSE.barnsole309 },
  { offset: 3,  type: 'WAKE_NIGHT', start: [20, 0], end: [8, 0],   house: HOUSE.sunflower, endsNextDay: true },
  { offset: 5,  type: 'MID_DAY',    start: [9, 0],  end: [17, 0],  house: HOUSE.barnsole309 },
  { offset: 8,  type: 'LONG_DAY',   start: [7, 30], end: [19, 30], house: HOUSE.sunflower },
  { offset: 11, type: 'MID_DAY',    start: [10, 0], end: [18, 0],  house: HOUSE.barnsole309 },
];

async function main() {
  // ── wipe existing ──
  const existing = await prisma.shift.findMany({ where: { agencyId: AGENCY_ID, workerId: WORKER_ID }, select: { id: true } });
  const ids = existing.map((s) => s.id);
  if (ids.length) {
    await prisma.timesheet.deleteMany({ where: { shiftId: { in: ids } } });
    await prisma.clockEvent.deleteMany({ where: { shiftId: { in: ids } } });
    await prisma.shift.deleteMany({ where: { id: { in: ids } } });
    console.log(`removed ${ids.length} existing shift(s) for feddy`);
  }

  let created = 0;

  // ── past shifts + approved timesheets ──
  for (const def of PAST) {
    const startTime = at(def.offset, ...def.start);
    const endTime = at(def.offset + (def.endsNextDay ? 1 : 0), ...def.end);
    const total = hoursBetween(startTime, endTime);

    const shift = await prisma.shift.create({
      data: {
        agencyId: AGENCY_ID,
        houseId: def.house,
        workerId: WORKER_ID,
        createdById: CREATED_BY,
        startTime,
        endTime,
        date: startOfDay(startTime),
        shiftType: def.type,
        status: 'COMPLETED',
      },
    });

    // clocked in ~4 min after start, out ~2 min before end
    const clockInAt = new Date(startTime.getTime() + 4 * 60_000);
    const clockOutAt = new Date(endTime.getTime() - 2 * 60_000);
    await prisma.timesheet.create({
      data: {
        agencyId: AGENCY_ID,
        workerId: WORKER_ID,
        houseId: def.house,
        shiftId: shift.id,
        clockInAt,
        clockOutAt,
        totalHours: hoursBetween(clockInAt, clockOutAt),
        status: 'APPROVED',
        autoConfirmed: true,
        confirmedById: CREATED_BY,
        confirmedAt: new Date(endTime.getTime() + 30 * 60_000),
        reviewedById: CREATED_BY,
        reviewedAt: new Date(endTime.getTime() + 45 * 60_000),
      },
    });
    created += 1;
    console.log(`  past   ${startTime.toISOString().slice(0, 16)}  ${def.type.padEnd(10)} ${total}h  (COMPLETED)`);
  }

  // ── one shift active right now ──
  {
    const startTime = new Date(now.getTime() - 90 * 60_000); // started 1.5h ago
    const endTime = new Date(now.getTime() + 6 * 3_600_000);  // ends in 6h
    const shift = await prisma.shift.create({
      data: {
        agencyId: AGENCY_ID,
        houseId: HOUSE.sunflower,
        workerId: WORKER_ID,
        createdById: CREATED_BY,
        startTime,
        endTime,
        date: startOfDay(startTime),
        shiftType: 'LONG_DAY',
        status: 'SCHEDULED',
      },
    });
    created += 1;
    console.log(`  now    ${startTime.toISOString().slice(0, 16)}  LONG_DAY   active window  (SCHEDULED, shift ${shift.id})`);
  }

  // ── upcoming shifts ──
  for (const def of UPCOMING) {
    const startTime = at(def.offset, ...def.start);
    const endTime = at(def.offset + (def.endsNextDay ? 1 : 0), ...def.end);
    await prisma.shift.create({
      data: {
        agencyId: AGENCY_ID,
        houseId: def.house,
        workerId: WORKER_ID,
        createdById: CREATED_BY,
        startTime,
        endTime,
        date: startOfDay(startTime),
        shiftType: def.type,
        status: 'SCHEDULED',
      },
    });
    created += 1;
    console.log(`  future ${startTime.toISOString().slice(0, 16)}  ${def.type.padEnd(10)} ${hoursBetween(startTime, endTime)}h  (SCHEDULED)`);
  }

  console.log(`\ncreated ${created} shifts for feddy439@icloud.com`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
