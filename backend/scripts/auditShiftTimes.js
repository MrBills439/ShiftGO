#!/usr/bin/env node
/**
 * READ-ONLY audit of stored shift times, before deciding on any data fix.
 * It never writes to the database.
 *
 *   node scripts/auditShiftTimes.js                 every agency
 *   node scripts/auditShiftTimes.js --agency <id>   one agency
 *   node scripts/auditShiftTimes.js --samples 50    more example rows
 *
 * Background: until this change the Schedule's "Create shift" / "Post open
 * shift" forms sent typed times as UTC ("09:00" -> 09:00Z), while the Shifts
 * page and the server's pattern generator store the real instant. In winter
 * (GMT = UTC) both agree. During summer time the Schedule form stored shifts
 * ONE HOUR LATER than typed (09:00 BST typed -> 09:00Z = 10:00 BST).
 *
 * The stored rows do not record which form created them, so this script can
 * only list CANDIDATES: hand-entered shifts (not pattern-generated) whose start
 * falls in daylight-saving time for the agency. A person must review them.
 *
 * Also reported: rows whose `date` column disagrees with the agency calendar
 * date of their start time (a sign of an inconsistent conversion).
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { resolveTimeZone } = require('../src/lib/agencyTime');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

function wall(instant, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZoneName: 'short',
  }).formatToParts(instant).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, zone: p.timeZoneName };
}

/** Minutes the zone is ahead of UTC at `instant`. */
function offsetMinutes(instant, tz) {
  const w = wall(instant, tz);
  const asUtc = Date.parse(`${w.date}T${w.time}:00Z`);
  return Math.round((asUtc - Math.floor(instant.getTime() / 60000) * 60000) / 60000);
}

/** The zone's standard (winter) offset: the smaller of January and July. */
function standardOffset(tz, year) {
  return Math.min(offsetMinutes(new Date(Date.UTC(year, 0, 15, 12)), tz), offsetMinutes(new Date(Date.UTC(year, 6, 15, 12)), tz));
}

async function main() {
  const prisma = new PrismaClient();
  const sampleLimit = Number(arg('samples', 20));
  const onlyAgency = arg('agency', null);
  try {
    const agencies = await prisma.agency.findMany({
      where: onlyAgency ? { id: onlyAgency } : {},
      select: { id: true, name: true, timezone: true },
    });
    const report = { generatedAt: new Date().toISOString(), readOnly: true, agencies: [] };

    for (const agency of agencies) {
      const tz = resolveTimeZone(agency.timezone);
      const shifts = await prisma.shift.findMany({
        where: { agencyId: agency.id },
        select: {
          id: true, startTime: true, endTime: true, date: true, status: true, createdAt: true,
          fixedWorkPatternId: true, house: { select: { name: true } }, location: { select: { name: true } },
        },
        orderBy: { startTime: 'asc' },
      });

      const summary = {
        agencyId: agency.id, agency: agency.name, timeZone: tz,
        totalShifts: shifts.length,
        patternGenerated: 0,
        handEntered: 0,
        handEnteredInSummerTime: 0,
        dateColumnMismatch: 0,
        summerTimeCandidates: [],
        dateMismatchExamples: [],
      };

      for (const s of shifts) {
        if (!s.startTime) continue;
        const start = wall(s.startTime, tz);
        const inDst = offsetMinutes(s.startTime, tz) !== standardOffset(tz, s.startTime.getUTCFullYear());
        const storedDate = s.date ? s.date.toISOString().slice(0, 10) : null;
        if (s.fixedWorkPatternId) summary.patternGenerated += 1;
        else summary.handEntered += 1;

        if (!s.fixedWorkPatternId && inDst) {
          summary.handEnteredInSummerTime += 1;
          if (summary.summerTimeCandidates.length < sampleLimit) {
            summary.summerTimeCandidates.push({
              id: s.id, status: s.status, where: s.house?.name ?? s.location?.name ?? null,
              storedStartUtc: s.startTime.toISOString(),
              showsAs: `${start.date} ${start.time} ${start.zone}`,
              ifEnteredOnScheduleForm: `typed as ${s.startTime.toISOString().slice(11, 16)} (would mean it shows 1 hour late)`,
              createdAt: s.createdAt.toISOString(),
            });
          }
        }
        if (storedDate && storedDate !== start.date) {
          summary.dateColumnMismatch += 1;
          if (summary.dateMismatchExamples.length < sampleLimit) {
            summary.dateMismatchExamples.push({ id: s.id, storedDate, startsOnAgencyDate: start.date, storedStartUtc: s.startTime.toISOString() });
          }
        }
      }
      report.agencies.push(summary);
    }

    console.log(JSON.stringify(report, null, 2));
    const totalCandidates = report.agencies.reduce((n, a) => n + a.handEnteredInSummerTime, 0);
    console.error(totalCandidates === 0
      ? '\nNo hand-entered shifts fall in summer time: the old Schedule-form bug cannot have affected stored shifts.'
      : `\n${totalCandidates} hand-entered shift(s) fall in summer time and may have been stored an hour late. Review them before any change; this script changed nothing.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
