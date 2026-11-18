/**
 * Record-level access rules that sit on top of the role gates in routes/.
 *
 * Role gates (atLeast('TEAM_LEADER')) only say "this kind of user may call this
 * endpoint". These helpers say "…for THIS house / THIS person". Every check is
 * agency-scoped first.
 *
 *   HR, MANAGER   agency-wide — a deliberate product decision (Nov 2026): managers
 *                 oversee the whole agency, like a registered manager, and
 *                 office / flexible staff belong to no service, so they cannot
 *                 be house-scoped. Revisit only with a "service manager" role.
 *   TEAM_LEADER   only houses they are assigned to (HouseTeamLeader), and only
 *                 WORKER staff assigned to one of those houses (HouseWorker)
 *   WORKER        only themselves
 *
 * Callers should answer a `false` with 404, the same as an unknown id, so the
 * response never confirms that a record exists outside the caller's scope.
 */
const prisma = require('../lib/prisma');

const AGENCY_WIDE_ROLES = new Set(['HR', 'MANAGER']);

async function teamLeaderHouseIds(teamLeaderId) {
  const links = await prisma.houseTeamLeader.findMany({
    where: { teamLeaderId },
    select: { houseId: true },
  });
  return links.map((l) => l.houseId);
}

/** May `user` see house `houseId`? The house must belong to `agencyId`. */
async function canAccessHouse(user, houseId, agencyId) {
  const house = await prisma.house.findFirst({ where: { id: houseId, agencyId }, select: { id: true } });
  if (!house) return false;
  if (AGENCY_WIDE_ROLES.has(user.role)) return true;
  if (user.role === 'TEAM_LEADER') {
    const link = await prisma.houseTeamLeader.findUnique({
      where: { houseId_teamLeaderId: { houseId, teamLeaderId: user.id } },
      select: { houseId: true },
    });
    return Boolean(link);
  }
  return false;
}

/** May `user` see personal compliance records (DBS, training, RTW) of `targetUserId`? */
async function canViewPersonRecords(user, targetUserId, agencyId) {
  const target = await prisma.user.findFirst({
    where: { id: targetUserId, agencyId },
    select: { id: true, role: true },
  });
  if (!target) return false;
  if (target.id === user.id) return true;
  if (AGENCY_WIDE_ROLES.has(user.role)) return true;
  if (user.role === 'TEAM_LEADER' && target.role === 'WORKER') {
    const houseIds = await teamLeaderHouseIds(user.id);
    if (houseIds.length === 0) return false;
    const shared = await prisma.houseWorker.findFirst({
      where: { workerId: target.id, houseId: { in: houseIds } },
      select: { houseId: true },
    });
    return Boolean(shared);
  }
  return false;
}

module.exports = { canAccessHouse, canViewPersonRecords, teamLeaderHouseIds };
