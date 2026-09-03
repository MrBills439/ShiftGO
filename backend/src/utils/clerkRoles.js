// Clerk organization role  ->  ShiftGO Role enum.
//
// `org:admin` / `org:member` are Clerk's *built-in* org roles: an organization
// created through Clerk's own UI (or the API without an explicit role) makes its
// creator `org:admin`. If we don't map it, `handleMembershipUpsert` silently
// skips that user and they can never sign in (no local User row -> /users/me 401
// -> the web portal bounces between /dashboard and /sign-in forever). Treat an
// org admin as HR, the top of ShiftGO's hierarchy.
//
// `org:member` is deliberately left unmapped — it carries no ShiftGO role.
const ORG_ROLE_TO_ROLE = {
  'org:admin': 'HR',
  'org:hr': 'HR',
  'org:manager': 'MANAGER',
  'org:team_leader': 'TEAM_LEADER',
  'org:worker': 'WORKER',
};

// Explicit inverse — NOT derived by flipping ORG_ROLE_TO_ROLE. Two org roles
// now map to HR, and when we *send* an invite for an HR we must always use the
// custom `org:hr` role, never `org:admin`.
const ROLE_TO_ORG_ROLE = {
  HR: 'org:hr',
  MANAGER: 'org:manager',
  TEAM_LEADER: 'org:team_leader',
  WORKER: 'org:worker',
};

module.exports = { ORG_ROLE_TO_ROLE, ROLE_TO_ORG_ROLE };
