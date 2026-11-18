/**
 * The agency (tenant) a request or user belongs to.
 *
 * Fails closed: there is deliberately NO fallback tenant. auth.js always loads
 * req.user from the database (User.agencyId is NOT NULL), so a missing value
 * means a bug — and silently writing into a shared "default" agency would mix
 * one customer's data with another's. Throwing turns that into a 500 instead.
 */
function agencyIdFor(userOrReq) {
  const agencyId = userOrReq?.agencyId || userOrReq?.user?.agencyId;
  if (!agencyId) {
    const err = new Error('No agency in request context');
    err.statusCode = 500;
    throw err;
  }
  return agencyId;
}

module.exports = { agencyIdFor };
