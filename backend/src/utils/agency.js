const DEFAULT_AGENCY_ID = 'default-agency';

function agencyIdFor(userOrReq) {
  return userOrReq?.agencyId || userOrReq?.user?.agencyId || DEFAULT_AGENCY_ID;
}

module.exports = { DEFAULT_AGENCY_ID, agencyIdFor };
