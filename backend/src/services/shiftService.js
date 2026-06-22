const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const shiftInclude = {
  house: true,
  worker: { select: { id: true, name: true, email: true, fcmToken: true } },
};

async function createShift(data, createdById) {
  return prisma.shift.create({
    data: {
      houseId: data.houseId,
      workerId: data.workerId,
      createdById,
      startTime: new Date(data.startTime),
      endTime: new Date(data.endTime),
      date: new Date(data.date),
    },
    include: shiftInclude,
  });
}

async function getShiftById(id) {
  return prisma.shift.findUnique({
    where: { id },
    include: shiftInclude,
  });
}

async function getShiftsForWorker(workerId) {
  return prisma.shift.findMany({
    where: { workerId },
    include: shiftInclude,
    orderBy: { date: 'asc' },
  });
}

async function getShiftsForHouse(houseId) {
  return prisma.shift.findMany({
    where: { houseId },
    include: shiftInclude,
    orderBy: { date: 'asc' },
  });
}

async function getShiftsForManager(managerId) {
  const houses = await prisma.house.findMany({ where: { managerId }, select: { id: true } });
  const houseIds = houses.map((h) => h.id);
  return prisma.shift.findMany({
    where: { houseId: { in: houseIds } },
    include: shiftInclude,
    orderBy: { date: 'asc' },
  });
}

async function getAllShifts() {
  return prisma.shift.findMany({
    include: shiftInclude,
    orderBy: { date: 'asc' },
  });
}

async function deleteShift(id) {
  return prisma.shift.delete({
    where: { id },
    include: shiftInclude,
  });
}

module.exports = {
  createShift, getShiftById,
  getShiftsForWorker, getShiftsForHouse, getShiftsForManager,
  getAllShifts, deleteShift,
};
