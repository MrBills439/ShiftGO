require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const clerkClient = require('../src/utils/clerkClient');
const { ROLE_TO_ORG_ROLE } = require('../src/utils/clerkRoles');

const prisma = new PrismaClient();

const optional = (value) => {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : undefined;
};

const required = (name) => {
  const value = optional(process.env[name]);
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const parseFloatEnv = (name) => {
  const value = optional(process.env[name]);
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`);
  return parsed;
};

const parseIntEnv = (name, fallback) => {
  const value = optional(process.env[name]);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
};

// Must match the Clerk instance's configured minimum (Dashboard → User & Authentication → Password).
const CLERK_MIN_PASSWORD_LENGTH = 15;

function configFromEnv() {
  const houseName = optional(process.env.PILOT_HOUSE_NAME);
  const houseAddress = optional(process.env.PILOT_HOUSE_ADDRESS);
  const houseLatitude = parseFloatEnv('PILOT_HOUSE_LATITUDE');
  const houseLongitude = parseFloatEnv('PILOT_HOUSE_LONGITUDE');

  if ([houseName, houseAddress, houseLatitude, houseLongitude].some((v) => v !== undefined)) {
    if (!houseName || !houseAddress || houseLatitude === undefined || houseLongitude === undefined) {
      throw new Error('PILOT_HOUSE_NAME, PILOT_HOUSE_ADDRESS, PILOT_HOUSE_LATITUDE, and PILOT_HOUSE_LONGITUDE are all required when creating a pilot house');
    }
    if (houseLatitude < -90 || houseLatitude > 90) throw new Error('PILOT_HOUSE_LATITUDE must be between -90 and 90');
    if (houseLongitude < -180 || houseLongitude > 180) throw new Error('PILOT_HOUSE_LONGITUDE must be between -180 and 180');
  }

  const managerPassword = required('PILOT_MANAGER_PASSWORD');
  if (managerPassword.length < CLERK_MIN_PASSWORD_LENGTH) {
    throw new Error(`PILOT_MANAGER_PASSWORD must be at least ${CLERK_MIN_PASSWORD_LENGTH} characters (Clerk's configured minimum)`);
  }

  return {
    dryRun: process.argv.includes('--dry-run') || process.env.PILOT_SETUP_DRY_RUN === 'true',
    agencyId: optional(process.env.PILOT_AGENCY_ID),
    agencyName: required('PILOT_AGENCY_NAME'),
    managerName: required('PILOT_MANAGER_NAME'),
    managerEmail: required('PILOT_MANAGER_EMAIL').toLowerCase(),
    managerPassword,
    managerPhone: optional(process.env.PILOT_MANAGER_PHONE),
    house: houseName
      ? {
          name: houseName,
          address: houseAddress,
          latitude: houseLatitude,
          longitude: houseLongitude,
          geofenceRadius: parseIntEnv('PILOT_HOUSE_GEOFENCE_RADIUS', 50),
        }
      : null,
  };
}

async function findLocalAgency(config) {
  if (config.agencyId) {
    return prisma.agency.findUnique({ where: { id: config.agencyId } });
  }
  return prisma.agency.findFirst({ where: { name: config.agencyName } });
}

async function findClerkUserByEmail(email) {
  const { data } = await clerkClient.users.getUserList({ emailAddress: [email] });
  return data[0] || null;
}

async function ensureClerkUser(config) {
  const existing = await findClerkUserByEmail(config.managerEmail);
  if (existing) return existing;

  const [firstName, ...rest] = config.managerName.trim().split(/\s+/);
  return clerkClient.users.createUser({
    emailAddress: [config.managerEmail],
    password: config.managerPassword,
    firstName,
    lastName: rest.join(' ') || undefined,
    skipPasswordChecks: false,
  });
}

async function ensureClerkOrganization(config, localAgency, clerkManagerUser) {
  if (localAgency?.clerkOrgId) {
    return clerkClient.organizations.getOrganization({ organizationId: localAgency.clerkOrgId });
  }
  return clerkClient.organizations.createOrganization({
    name: config.agencyName,
    createdBy: clerkManagerUser.id,
  });
}

async function ensureMembership(org, clerkUser, orgRole) {
  const { data } = await clerkClient.organizations.getOrganizationMembershipList({ organizationId: org.id });
  const existing = data.find((m) => m.publicUserData?.userId === clerkUser.id);

  if (!existing) {
    return clerkClient.organizations.createOrganizationMembership({
      organizationId: org.id,
      userId: clerkUser.id,
      role: orgRole,
    });
  }
  if (existing.role === orgRole) return existing;
  return clerkClient.organizations.updateOrganizationMembership({
    organizationId: org.id,
    userId: clerkUser.id,
    role: orgRole,
  });
}

async function setupPilotAgency(config) {
  const localAgency = await findLocalAgency(config);
  const existingLocalManager = await prisma.user.findUnique({ where: { email: config.managerEmail } });

  if (existingLocalManager && localAgency && existingLocalManager.agencyId !== localAgency.id) {
    throw new Error(`Manager email already belongs to another agency: ${existingLocalManager.agencyId}`);
  }
  if (existingLocalManager && !localAgency) {
    throw new Error(`Manager email already exists before pilot agency creation: ${existingLocalManager.agencyId}`);
  }
  if (localAgency && existingLocalManager && existingLocalManager.role !== 'MANAGER' && existingLocalManager.role !== 'HR') {
    throw new Error(`Existing manager email has unsupported role: ${existingLocalManager.role}`);
  }

  const targetRole = existingLocalManager?.role === 'HR' ? 'HR' : 'MANAGER';
  const targetOrgRole = ROLE_TO_ORG_ROLE[targetRole];

  if (config.dryRun) {
    return {
      dryRun: true,
      agency: {
        id: localAgency?.id || '(generated by Prisma)',
        clerkOrgId: localAgency?.clerkOrgId || '(would create a Clerk organization)',
        name: config.agencyName,
        action: 'would create or reuse',
      },
      manager: {
        email: config.managerEmail,
        name: config.managerName,
        role: targetRole,
        orgRole: targetOrgRole,
        action: 'would create or invite as a Clerk user, and create or update the org membership',
      },
      house: config.house ? { name: config.house.name, action: 'would create or update inside this agency' } : null,
    };
  }

  const clerkUser = await ensureClerkUser(config);
  const clerkOrg = await ensureClerkOrganization(config, localAgency, clerkUser);
  const membership = await ensureMembership(clerkOrg, clerkUser, targetOrgRole);

  // Upsert (keyed on the Clerk id, not the local id) rather than waiting on
  // webhook delivery — this script needs to be deterministic even if the
  // webhook tunnel isn't running, and safe if it IS running and reacts to the
  // same Clerk writes concurrently (a plain create() would race it).
  const agency = await prisma.agency.upsert({
    where: { clerkOrgId: clerkOrg.id },
    update: { name: config.agencyName },
    create: {
      ...(config.agencyId ? { id: config.agencyId } : {}),
      name: config.agencyName,
      clerkOrgId: clerkOrg.id,
    },
  });

  const manager = await prisma.user.upsert({
    where: { clerkUserId: clerkUser.id },
    update: {
      agencyId: agency.id,
      name: config.managerName,
      role: targetRole,
      status: 'ACTIVE',
      phone: config.managerPhone || null,
      deactivatedAt: null,
      deactivatedById: null,
      deactivationReason: null,
    },
    create: {
      agencyId: agency.id,
      clerkUserId: clerkUser.id,
      name: config.managerName,
      email: config.managerEmail,
      role: targetRole,
      status: 'ACTIVE',
      phone: config.managerPhone || null,
    },
  });

  let house = null;
  if (config.house) {
    const existingHouse = await prisma.house.findFirst({
      where: { agencyId: agency.id, name: config.house.name },
    });
    house = existingHouse
      ? await prisma.house.update({
          where: { id: existingHouse.id },
          data: { ...config.house, managerId: manager.id },
        })
      : await prisma.house.create({
          data: { agencyId: agency.id, ...config.house, managerId: manager.id },
        });
  }

  const refreshedClerkUser = await clerkClient.users.getUser(clerkUser.id);
  if (!refreshedClerkUser.passwordEnabled) {
    throw new Error('Pilot manager Clerk account does not have password authentication enabled');
  }
  if (manager.agencyId !== agency.id) {
    throw new Error('Pilot manager local agency linkage verification failed');
  }

  return {
    dryRun: false,
    agency: { id: agency.id, name: agency.name, clerkOrgId: agency.clerkOrgId },
    manager: {
      id: manager.id,
      email: manager.email,
      role: manager.role,
      agencyId: manager.agencyId,
      clerkUserId: manager.clerkUserId,
      orgRole: membership.role,
    },
    house: house ? { id: house.id, name: house.name, agencyId: house.agencyId } : null,
    clerkPasswordAuthVerified: true,
  };
}

async function main() {
  const config = configFromEnv();
  const result = await setupPilotAgency(config);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
