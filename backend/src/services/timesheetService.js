const { PrismaClient } = require('@prisma/client');
const PDFDocument = require('pdfkit');
const { send } = require('./notificationService');

const prisma = new PrismaClient();

async function getMyTimesheets(workerId, agencyId) {
  return prisma.timesheet.findMany({
    where: { agencyId, workerId },
    include: { shift: true, house: true },
    orderBy: { createdAt: 'desc' },
  });
}

async function getHouseTimesheets(houseId, agencyId) {
  return prisma.timesheet.findMany({
    where: { agencyId, houseId },
    include: {
      worker: { select: { id: true, name: true, email: true } },
      shift: true,
      reviewedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function confirmTimesheet(id, confirmedById, agencyId) {
  const existing = await prisma.timesheet.findFirst({ where: { id, agencyId } });
  if (!existing) {
    const err = new Error('Timesheet not found');
    err.statusCode = 404;
    throw err;
  }
  if (existing.status !== 'PENDING') {
    const err = new Error('Timesheet has already been reviewed');
    err.statusCode = 409;
    throw err;
  }

  const reviewedAt = new Date();
  const ts = await prisma.timesheet.update({
    where: { id },
    data: {
      status: 'APPROVED',
      rejectionReason: null,
      confirmedById,
      confirmedAt: reviewedAt,
      reviewedById: confirmedById,
      reviewedAt,
    },
    include: {
      worker: { select: { id: true, name: true, email: true, fcmToken: true } },
      house:  true,
      reviewedBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (ts.worker?.fcmToken) {
    const hrs = ts.totalHours ? `${ts.totalHours.toFixed(1)}h` : '';
    await send(ts.worker.fcmToken, {
      title: 'Timesheet confirmed',
      body:  `Your timesheet for ${ts.house.name}${hrs ? ` (${hrs})` : ''} has been confirmed.`,
    });
  }

  return ts;
}

async function rejectTimesheet(id, reviewedById, reason, agencyId) {
  const existing = await prisma.timesheet.findFirst({ where: { id, agencyId } });
  if (!existing) {
    const err = new Error('Timesheet not found');
    err.statusCode = 404;
    throw err;
  }
  if (existing.status !== 'PENDING') {
    const err = new Error('Timesheet has already been reviewed');
    err.statusCode = 409;
    throw err;
  }

  const ts = await prisma.timesheet.update({
    where: { id },
    data: {
      status: 'REJECTED',
      rejectionReason: reason.trim(),
      reviewedById,
      reviewedAt: new Date(),
    },
    include: {
      worker: { select: { id: true, name: true, email: true, fcmToken: true } },
      house: true,
      reviewedBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (ts.worker?.fcmToken) {
    await send(ts.worker.fcmToken, {
      title: 'Timesheet rejected',
      body: `Your timesheet for ${ts.house.name} needs review: ${ts.rejectionReason}`,
    });
  }

  return ts;
}

async function generatePDF(houseId, res, agencyId) {
  const timesheets = await prisma.timesheet.findMany({
    where: { agencyId, houseId, status: 'APPROVED' },
    include: {
      worker: { select: { name: true, email: true } },
      shift: true,
      house: true,
    },
    orderBy: { clockInAt: 'asc' },
  });

  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="timesheet-${houseId}.pdf"`);
  doc.pipe(res);

  const house = timesheets[0]?.house;
  doc.fontSize(20).font('Helvetica-Bold').text('ShiftGO — Confirmed Timesheet', { align: 'center' });
  doc.moveDown(0.5);
  if (house) {
    doc.fontSize(14).font('Helvetica').text(`House: ${house.name}`, { align: 'center' });
    doc.text(`Address: ${house.address}`, { align: 'center' });
  }
  doc.moveDown(1);

  const colX = [50, 180, 310, 390, 470];
  doc.fontSize(10).font('Helvetica-Bold');
  doc.text('Worker', colX[0], doc.y, { continued: false });
  const headerY = doc.y - 15;
  doc.text('Worker', colX[0], headerY);
  doc.text('Clock In', colX[1], headerY);
  doc.text('Clock Out', colX[2], headerY);
  doc.text('Hours', colX[3], headerY);
  doc.text('Method', colX[4], headerY);
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
  doc.moveDown(0.3);

  doc.font('Helvetica').fontSize(9);
  for (const ts of timesheets) {
    const y = doc.y;
    const fmt = (d) => d ? new Date(d).toLocaleString('en-GB') : '—';
    doc.text(ts.worker.name, colX[0], y, { width: 120 });
    doc.text(fmt(ts.clockInAt), colX[1], y, { width: 120 });
    doc.text(fmt(ts.clockOutAt), colX[2], y, { width: 75 });
    doc.text(ts.totalHours ? ts.totalHours.toFixed(2) : '—', colX[3], y, { width: 70 });
    doc.text(ts.autoConfirmed ? 'Auto' : 'Manual', colX[4], y);
    doc.moveDown(0.6);
  }

  doc.end();
}

module.exports = {
  getMyTimesheets,
  getHouseTimesheets,
  confirmTimesheet,
  rejectTimesheet,
  generatePDF,
};
