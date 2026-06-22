const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const houseRoutes = require('./routes/houses');
const shiftRoutes = require('./routes/shifts');
const clockRoutes = require('./routes/clock');
const timesheetRoutes = require('./routes/timesheets');
const notificationRoutes = require('./routes/notifications');
const trainingRoutes = require('./routes/training');
const dbsRoutes = require('./routes/dbs');
const { serverError } = require('./utils/response');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Serve uploaded avatars
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.get('/health', (_, res) => res.json({ status: 'ok', app: 'ShiftGO' }));

app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/houses', houseRoutes);
app.use('/shifts', shiftRoutes);
app.use('/clock', clockRoutes);
app.use('/timesheets', timesheetRoutes);
app.use('/notifications', notificationRoutes);
app.use('/training', trainingRoutes);
app.use('/dbs', dbsRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  serverError(res, err.message);
});

module.exports = app;
