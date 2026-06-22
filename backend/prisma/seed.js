const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const pw = await bcrypt.hash('password123', 12);

  const hr = await prisma.user.upsert({
    where: { email: 'hr@shiftgo.com' },
    update: {},
    create: {
      name: 'HR Admin', email: 'hr@shiftgo.com', passwordHash: pw, role: 'HR',
      phone: '+44 7700 900001',
    },
  });

  const manager = await prisma.user.upsert({
    where: { email: 'manager@shiftgo.com' },
    update: {},
    create: {
      name: 'Jane Manager', email: 'manager@shiftgo.com', passwordHash: pw, role: 'MANAGER',
      phone: '+44 7700 900002',
    },
  });

  const tl = await prisma.user.upsert({
    where: { email: 'tl@shiftgo.com' },
    update: {},
    create: {
      name: 'Tom Leader', email: 'tl@shiftgo.com', passwordHash: pw, role: 'TEAM_LEADER',
      phone: '+44 7700 900003',
    },
  });

  const worker = await prisma.user.upsert({
    where: { email: 'worker@shiftgo.com' },
    update: {},
    create: {
      name: 'Alice Worker', email: 'worker@shiftgo.com', passwordHash: pw, role: 'WORKER',
      phone: '+44 7700 900123',
      bio: 'Care support worker with 3 years of experience.',
      address: '42 Oak Lane, London, E2 8AB',
    },
  });

  const house = await prisma.house.upsert({
    where: { id: 'seed-house-1' },
    update: {},
    create: {
      id: 'seed-house-1',
      name: 'Maple House',
      address: '10 Maple Street, London, E1 1AA',
      latitude: 51.5145,
      longitude: -0.0731,
      geofenceRadius: 50,
      managerId: manager.id,
    },
  });

  await prisma.houseTeamLeader.upsert({
    where: { houseId_teamLeaderId: { houseId: house.id, teamLeaderId: tl.id } },
    update: {},
    create: { houseId: house.id, teamLeaderId: tl.id },
  });

  await prisma.houseWorker.upsert({
    where: { houseId_workerId: { houseId: house.id, workerId: worker.id } },
    update: {},
    create: { houseId: house.id, workerId: worker.id },
  });

  // Training records for worker
  const trainings = [
    {
      title: 'Manual Handling',
      description: 'Safe techniques for manual handling and patient transfers.',
      status: 'COMPLETED',
      completedAt: new Date('2025-03-15'),
      expiresAt: new Date('2026-03-15'),
    },
    {
      title: 'First Aid at Work',
      description: '3-day first aid certification course.',
      status: 'COMPLETED',
      completedAt: new Date('2025-01-10'),
      expiresAt: new Date('2028-01-10'),
    },
    {
      title: 'Safeguarding Adults',
      description: 'Recognising and responding to abuse and neglect.',
      status: 'COMPLETED',
      completedAt: new Date('2025-06-01'),
      expiresAt: new Date('2026-06-01'),
    },
    {
      title: 'Medication Administration',
      description: 'Safe administration of medications in care settings.',
      status: 'IN_PROGRESS',
      expiresAt: null,
    },
    {
      title: 'Fire Safety',
      description: 'Fire prevention and evacuation procedures.',
      status: 'PENDING',
    },
  ];

  for (const t of trainings) {
    const existing = await prisma.training.findFirst({
      where: { userId: worker.id, title: t.title },
    });
    if (!existing) {
      await prisma.training.create({ data: { userId: worker.id, ...t } });
    }
  }

  // DBS Check for worker
  await prisma.dbsCheck.upsert({
    where: { userId: worker.id },
    update: {},
    create: {
      userId: worker.id,
      status: 'CLEAR',
      reference: 'DBS-2025-00123456',
      issuedAt: new Date('2025-02-20'),
      expiresAt: new Date('2028-02-20'),
      notes: 'Enhanced DBS certificate — clear.',
    },
  });

  console.log('Seed complete. Accounts created:');
  console.log('  hr@shiftgo.com        / password123  (HR)');
  console.log('  manager@shiftgo.com   / password123  (Manager)');
  console.log('  tl@shiftgo.com        / password123  (Team Leader)');
  console.log('  worker@shiftgo.com    / password123  (Worker)');
}

main().catch(console.error).finally(() => prisma.$disconnect());
