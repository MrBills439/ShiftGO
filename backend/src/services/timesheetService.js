const { PrismaClient } = require('@prisma/client');
const PDFDocument = require('pdfkit');
const { send } = require('./notificationService');

const prisma = new PrismaClient();

async function getMyTimesheets(workerId) {
  return prisma.timesheet.findMany({
    where: { workerId },
    include: { shift: true, house: true },
    orderBy: { createdAt: 'desc' },
  });
}

async function getHouseTimesheets(houseId) {
  return prisma.timesheet.findMany({
    where: { houseId },
    include: {
      worker: { select: { id: true, name: true, email: true } },
      shift: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function confirmTimesheet(id, confirmedById) {
  const ts = await prisma.timesheet.update({
    where: { id },
    data: { confirmedById, confirmedAt: new Date() },
    include: {
      worker: { select: { id: true, name: true, email: true, fcmToken: true } },
      house:  true,
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

async function generatePDF(houseId, res) {
  const timesheets = await prisma.timesheet.findMany({
    where: { houseId, OR: [{ confirmedAt: { not: null } }, { autoConfirmed: true }] },
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

module.exports = { getMyTimesheets, getHouseTimesheets, confirmTimesheet, generatePDF };
