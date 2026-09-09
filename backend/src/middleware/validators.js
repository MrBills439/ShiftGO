const { body, param, query, validationResult } = require('express-validator');

const ROLES = ['WORKER', 'TEAM_LEADER', 'MANAGER', 'HR'];
const USER_STATUSES = ['ACTIVE', 'DEACTIVATED'];
const SHIFT_STATUSES = ['SCHEDULED', 'OPEN', 'CLAIMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
const SHIFT_TYPES = ['LONG_DAY', 'MID_DAY', 'WAKE_NIGHT', 'SLEEP_IN'];
const TIMESHEET_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];
const TRAINING_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED'];
const DBS_STATUSES = ['PENDING', 'CLEAR', 'FLAGGED', 'EXPIRED'];

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const fieldErrors = errors.array().reduce((acc, err) => {
      acc[err.path || err.param] = err.msg;
      return acc;
    }, {});

    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'One or more fields are invalid',
        fields: fieldErrors,
      },
      timestamp: new Date().toISOString(),
    });
  }
  next();
};

const idParam = (name = 'id', label = 'ID') => [
  param(name)
    .trim()
    .notEmpty()
    .withMessage(`${label} is required`)
    .isLength({ min: 5 })
    .withMessage(`${label} must be valid`),
];

const requiredIdBody = (name, label) =>
  body(name)
    .trim()
    .notEmpty()
    .withMessage(`${label} is required`)
    .isLength({ min: 5 })
    .withMessage(`${label} must be valid`);

const optionalIsoDate = (name, label) =>
  body(name)
    .optional({ nullable: true, checkFalsy: true })
    .isISO8601()
    .withMessage(`${label} must be a valid ISO 8601 date`);

// Weekly scheduled-hours override on a shift assignment (create / update).
const weeklyOverrideBody = [
  body('overrideWeeklyLimit')
    .optional()
    .isBoolean()
    .withMessage('overrideWeeklyLimit must be a boolean'),
  body('overrideReason')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ min: 3, max: 500 })
    .withMessage('An override reason of 3–500 characters is required'),
];

const pagination = [
  query('page')
    .optional()
    .isInt({ min: 1, max: 10_000 })
    .withMessage('Page must be an integer between 1 and 10000'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be an integer between 1 and 100'),
];

const gps = [
  body('latitude')
    .notEmpty()
    .withMessage('Latitude is required')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90'),
  body('longitude')
    .notEmpty()
    .withMessage('Longitude is required')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180'),
  body('accuracy')
    .optional()
    .isFloat({ min: 0, max: 5000 })
    .withMessage('Accuracy must be between 0 and 5000 metres'),
];


const validators = {
  login: [
    body('email')
      .trim()
      .notEmpty()
      .withMessage('Email is required')
      .isEmail()
      .normalizeEmail()
      .withMessage('Email must be valid'),
    body('password')
      .notEmpty()
      .withMessage('Password is required')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
    handleValidationErrors,
  ],

  refresh: [
    body('refreshToken')
      .trim()
      .notEmpty()
      .withMessage('Refresh token is required'),
    handleValidationErrors,
  ],

  register: [
    body('email')
      .trim()
      .notEmpty()
      .withMessage('Email is required')
      .isEmail()
      .normalizeEmail()
      .withMessage('Email must be valid'),
    body('password')
      .notEmpty()
      .withMessage('Password is required')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters'),
    body('name')
      .trim()
      .notEmpty()
      .withMessage('Name is required')
      .isLength({ min: 2, max: 120 })
      .withMessage('Name must be between 2 and 120 characters'),
    body('role')
      .notEmpty()
      .withMessage('Role is required')
      .isIn(ROLES)
      .withMessage('Role must be WORKER, TEAM_LEADER, MANAGER, or HR'),
    handleValidationErrors,
  ],

  createUser: [
    body('email')
      .trim()
      .notEmpty()
      .withMessage('Email is required')
      .isEmail()
      .normalizeEmail()
      .withMessage('Email must be valid'),
    body('name')
      .trim()
      .notEmpty()
      .withMessage('Name is required')
      .isLength({ min: 2, max: 120 })
      .withMessage('Name must be between 2 and 120 characters'),
    body('role')
      .notEmpty()
      .withMessage('Role is required')
      .isIn(ROLES)
      .withMessage('Role must be WORKER, TEAM_LEADER, MANAGER, or HR'),
    body('phone')
      .optional({ nullable: true, checkFalsy: true })
      .trim()
      .isLength({ max: 40 })
      .withMessage('Phone must be 40 characters or fewer'),
    handleValidationErrors,
  ],

  listUsers: [
    query('role')
      .optional()
      .isIn(ROLES)
      .withMessage('Role must be WORKER, TEAM_LEADER, MANAGER, or HR'),
    query('status')
      .optional()
      .isIn(USER_STATUSES)
      .withMessage('User status must be ACTIVE or DEACTIVATED'),
    ...pagination,
    handleValidationErrors,
  ],

  getUser: [
    ...idParam('id', 'User ID'),
    handleValidationErrors,
  ],

  updateUser: [
    ...idParam('id', 'User ID'),
    body('contractedHours')
      .optional({ nullable: true, checkFalsy: true })
      .isFloat({ min: 0, max: 168 })
      .withMessage('Contracted hours must be between 0 and 168'),
    handleValidationErrors,
  ],

  deactivateUser: [
    ...idParam('id', 'User ID'),
    body('reason')
      .trim()
      .notEmpty()
      .withMessage('Deactivation reason is required')
      .bail()
      .isLength({ min: 3, max: 500 })
      .withMessage('Deactivation reason must be between 3 and 500 characters'),
    handleValidationErrors,
  ],

  updateMe: [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 120 })
      .withMessage('Name must be between 2 and 120 characters'),
    body('phone')
      .optional({ nullable: true })
      .trim()
      .isLength({ max: 40 })
      .withMessage('Phone must be 40 characters or fewer'),
    body('bio')
      .optional({ nullable: true })
      .trim()
      .isLength({ max: 1000 })
      .withMessage('Bio must be 1000 characters or fewer'),
    body('address')
      .optional({ nullable: true })
      .trim()
      .isLength({ max: 500 })
      .withMessage('Address must be 500 characters or fewer'),
    handleValidationErrors,
  ],

  updateFcmToken: [
    body('fcmToken')
      .notEmpty()
      .withMessage('FCM token is required')
      .isString()
      .withMessage('FCM token must be a string')
      .isLength({ max: 4096 })
      .withMessage('FCM token must be 4096 characters or fewer'),
    handleValidationErrors,
  ],

  assignWorkerToHouse: [
    requiredIdBody('workerId', 'Worker ID'),
    requiredIdBody('houseId', 'House ID'),
    handleValidationErrors,
  ],

  assignTeamLeaderToHouse: [
    requiredIdBody('teamLeaderId', 'Team leader ID'),
    requiredIdBody('houseId', 'House ID'),
    handleValidationErrors,
  ],

  listShifts: [
    query('houseId')
      .optional()
      .trim()
      .isLength({ min: 5 })
      .withMessage('House ID must be valid'),
    query('workerId')
      .optional()
      .trim()
      .isLength({ min: 5 })
      .withMessage('Worker ID must be valid'),
    query('status')
      .optional()
      .isIn(SHIFT_STATUSES)
      .withMessage('Shift status must be SCHEDULED, OPEN, CLAIMED, IN_PROGRESS, COMPLETED, or CANCELLED'),
    query('shiftType')
      .optional()
      .isIn(SHIFT_TYPES)
      .withMessage('Shift type must be LONG_DAY, MID_DAY, WAKE_NIGHT, or SLEEP_IN'),
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('Start date must be a valid ISO 8601 date'),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('End date must be a valid ISO 8601 date')
      .custom((endDate, { req }) => {
        if (!req.query.startDate || Number.isNaN(new Date(req.query.startDate).getTime())) return true;
        if (new Date(endDate) < new Date(req.query.startDate)) {
          throw new Error('End date must be on or after start date');
        }
        return true;
      }),
    ...pagination,
    handleValidationErrors,
  ],

  createShift: [
    body('workerId')
      .if((value, { req }) => req.body.status !== 'OPEN')
      .trim()
      .notEmpty()
      .withMessage('Worker ID is required')
      .isLength({ min: 5 })
      .withMessage('Worker ID must be valid'),
    requiredIdBody('houseId', 'House ID'),
    body('startTime')
      .notEmpty()
      .withMessage('Start time is required')
      .isISO8601()
      .toDate()
      .withMessage('Start time must be a valid ISO 8601 date'),
    body('endTime')
      .notEmpty()
      .withMessage('End time is required')
      .isISO8601()
      .toDate()
      .withMessage('End time must be a valid ISO 8601 date')
      .custom((endTime, { req }) => {
        if (!req.body.startTime || Number.isNaN(new Date(req.body.startTime).getTime())) return true;
        if (new Date(endTime) <= new Date(req.body.startTime)) {
          throw new Error('End time must be after start time');
        }
        return true;
      }),
    body('date')
      .notEmpty()
      .withMessage('Date is required')
      .isISO8601()
      .withMessage('Date must be a valid ISO 8601 date'),
    body('status')
      .optional()
      .isIn(SHIFT_STATUSES)
      .withMessage('Shift status must be SCHEDULED, OPEN, CLAIMED, IN_PROGRESS, COMPLETED, or CANCELLED'),
    body('shiftType')
      .optional()
      .isIn(SHIFT_TYPES)
      .withMessage('Shift type must be LONG_DAY, MID_DAY, WAKE_NIGHT, or SLEEP_IN'),
    body('eligibleRoles')
      .optional()
      .isArray()
      .withMessage('Eligible roles must be an array'),
    body('eligibleRoles.*')
      .isIn(ROLES)
      .withMessage('Eligible roles must be WORKER, TEAM_LEADER, MANAGER, or HR'),
    body('urgent')
      .optional()
      .isBoolean()
      .withMessage('Urgent must be a boolean'),
    ...weeklyOverrideBody,
    handleValidationErrors,
  ],

  updateShift: [
    ...idParam('id', 'Shift ID'),
    body('workerId')
      .optional({ nullable: true, checkFalsy: true })
      .trim()
      .isLength({ min: 5 })
      .withMessage('Worker ID must be valid'),
    body('houseId')
      .optional()
      .trim()
      .isLength({ min: 5 })
      .withMessage('House ID must be valid'),
    body('startTime')
      .optional()
      .isISO8601()
      .withMessage('Start time must be a valid ISO 8601 date'),
    body('endTime')
      .optional()
      .isISO8601()
      .withMessage('End time must be a valid ISO 8601 date')
      .custom((endTime, { req }) => {
        if (!req.body.startTime || Number.isNaN(new Date(req.body.startTime).getTime())) return true;
        if (new Date(endTime) <= new Date(req.body.startTime)) {
          throw new Error('End time must be after start time');
        }
        return true;
      }),
    body('date')
      .optional()
      .isISO8601()
      .withMessage('Date must be a valid ISO 8601 date'),
    body('shiftType')
      .optional()
      .isIn(SHIFT_TYPES)
      .withMessage('Shift type must be LONG_DAY, MID_DAY, WAKE_NIGHT, or SLEEP_IN'),
    body('urgent')
      .optional()
      .isBoolean()
      .withMessage('Urgent must be a boolean'),
    body('eligibleRoles')
      .optional()
      .isArray()
      .withMessage('Eligible roles must be an array'),
    body('eligibleRoles.*')
      .isIn(ROLES)
      .withMessage('Eligible roles must be WORKER, TEAM_LEADER, MANAGER, or HR'),
    ...weeklyOverrideBody,
    handleValidationErrors,
  ],

  openShift: [
    ...idParam('id', 'Shift ID'),
    body('eligibleRoles')
      .optional()
      .isArray()
      .withMessage('Eligible roles must be an array'),
    body('eligibleRoles.*')
      .isIn(ROLES)
      .withMessage('Eligible roles must be WORKER, TEAM_LEADER, MANAGER, or HR'),
    body('maxClaimsPerWorker')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Max claims per worker must be a positive integer'),
    body('urgent')
      .optional()
      .isBoolean()
      .withMessage('Urgent must be a boolean'),
    handleValidationErrors,
  ],

  claimShift: [
    ...idParam('id', 'Shift ID'),
    handleValidationErrors,
  ],

  dropShift: [
    ...idParam('id', 'Shift ID'),
    body('reason')
      .optional({ nullable: true })
      .trim()
      .isLength({ max: 500 })
      .withMessage('Reason must be 500 characters or fewer'),
    handleValidationErrors,
  ],

  rotaWeek: [
    query('startDate')
      .notEmpty()
      .withMessage('Start date is required')
      .isISO8601()
      .withMessage('Start date must be a valid ISO 8601 date'),
    handleValidationErrors,
  ],

  rotaDay: [
    query('date')
      .notEmpty()
      .withMessage('Date is required')
      .isISO8601()
      .withMessage('Date must be a valid ISO 8601 date'),
    handleValidationErrors,
  ],

  getShift: [
    ...idParam('id', 'Shift ID'),
    handleValidationErrors,
  ],

  cancelShift: [
    ...idParam('id', 'Shift ID'),
    body('reason')
      .trim()
      .notEmpty()
      .withMessage('Cancellation reason is required')
      .bail()
      .isLength({ min: 3, max: 500 })
      .withMessage('Cancellation reason must be between 3 and 500 characters'),
    handleValidationErrors,
  ],

  manualClockIn: [
    requiredIdBody('houseId', 'House ID'),
    requiredIdBody('shiftId', 'Shift ID'),
    optionalIsoDate('timestamp', 'Clock timestamp'),
    body('latitude')
      .optional()
      .isFloat({ min: -90, max: 90 })
      .withMessage('Latitude must be between -90 and 90'),
    body('longitude')
      .optional()
      .isFloat({ min: -180, max: 180 })
      .withMessage('Longitude must be between -180 and 180'),
    body('accuracy')
      .optional()
      .isFloat({ min: 0, max: 5000 })
      .withMessage('Accuracy must be between 0 and 5000 metres'),
    optionalIsoDate('capturedAt', 'Location capture time'),
    body('mockLocationSuspected')
      .optional()
      .isBoolean()
      .withMessage('mockLocationSuspected must be a boolean'),
    body('reason')
      .optional({ nullable: true, checkFalsy: true })
      .trim()
      .isLength({ min: 3, max: 500 })
      .withMessage('Manual attendance reason must be between 3 and 500 characters'),
    body('locationSource')
      .optional()
      .isIn(['MANUAL', 'OFFLINE_SYNC'])
      .withMessage('Location source must be MANUAL or OFFLINE_SYNC'),
    handleValidationErrors,
  ],

  reportLocation: [
    requiredIdBody('shiftId', 'Shift ID'),
    ...gps,
    optionalIsoDate('capturedAt', 'Location capture time'),
    body('mockLocationSuspected')
      .optional()
      .isBoolean()
      .withMessage('mockLocationSuspected must be a boolean'),
    handleValidationErrors,
  ],

  attendanceAction: [
    requiredIdBody('shiftId', 'Shift ID'),
    handleValidationErrors,
  ],

  createHouse: [
    body('name')
      .trim()
      .notEmpty()
      .withMessage('House name is required')
      .isLength({ min: 2, max: 160 })
      .withMessage('House name must be between 2 and 160 characters'),
    body('address')
      .trim()
      .notEmpty()
      .withMessage('Address is required')
      .isLength({ max: 500 })
      .withMessage('Address must be 500 characters or fewer'),
    body('latitude')
      .notEmpty()
      .withMessage('Latitude is required')
      .isFloat({ min: -90, max: 90 })
      .withMessage('Latitude must be between -90 and 90'),
    body('longitude')
      .notEmpty()
      .withMessage('Longitude is required')
      .isFloat({ min: -180, max: 180 })
      .withMessage('Longitude must be between -180 and 180'),
    body('geofenceRadius')
      .optional()
      .isInt({ min: 10, max: 500 })
      .withMessage('Geofence radius must be between 10 and 500 meters'),
    body('managerId')
      .optional({ nullable: true, checkFalsy: true })
      .trim()
      .isLength({ min: 5 })
      .withMessage('Manager ID must be valid'),
    body('autoConfirm')
      .optional()
      .isBoolean()
      .withMessage('Auto-confirm must be a boolean'),
    body('assignedHours')
      .optional({ nullable: true, checkFalsy: true })
      .isFloat({ min: 0, max: 10000 })
      .withMessage('Assigned hours must be 0 or more'),
    handleValidationErrors,
  ],

  getHouse: [
    ...idParam('id', 'House ID'),
    handleValidationErrors,
  ],

  updateHouse: [
    ...idParam('id', 'House ID'),
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 160 })
      .withMessage('House name must be between 2 and 160 characters'),
    body('address')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Address must be 500 characters or fewer'),
    body('latitude')
      .optional()
      .isFloat({ min: -90, max: 90 })
      .withMessage('Latitude must be between -90 and 90'),
    body('longitude')
      .optional()
      .isFloat({ min: -180, max: 180 })
      .withMessage('Longitude must be between -180 and 180'),
    body('geofenceRadius')
      .optional()
      .isInt({ min: 10, max: 500 })
      .withMessage('Geofence radius must be between 10 and 500 meters'),
    body('managerId')
      .optional({ nullable: true, checkFalsy: true })
      .trim()
      .isLength({ min: 5 })
      .withMessage('Manager ID must be valid'),
    body('autoConfirm')
      .optional()
      .isBoolean()
      .withMessage('Auto-confirm must be a boolean'),
    body('assignedHours')
      .optional({ nullable: true, checkFalsy: true })
      .isFloat({ min: 0, max: 10000 })
      .withMessage('Assigned hours must be 0 or more'),
    handleValidationErrors,
  ],

  updateGeofence: [
    ...idParam('id', 'House ID'),
    body('radius')
      .notEmpty()
      .withMessage('Radius is required')
      .isInt({ min: 10, max: 500 })
      .withMessage('Radius must be between 10 and 500 metres'),
    handleValidationErrors,
  ],

  listSupportedPeople: [
    ...idParam('id', 'House ID'),
    handleValidationErrors,
  ],

  createSupportedPerson: [
    ...idParam('id', 'House ID'),
    body('name')
      .trim()
      .notEmpty()
      .withMessage('Name is required')
      .isLength({ min: 2, max: 160 })
      .withMessage('Name must be between 2 and 160 characters'),
    body('dateOfBirth')
      .optional({ values: 'falsy' })
      .isISO8601()
      .withMessage('Date of birth must be a valid date'),
    body('emergencyContactName')
      .optional({ values: 'falsy' })
      .trim()
      .isLength({ max: 160 })
      .withMessage('Emergency contact name must be 160 characters or fewer'),
    body('emergencyContactPhone')
      .optional({ values: 'falsy' })
      .trim()
      .isLength({ max: 40 })
      .withMessage('Emergency contact phone must be 40 characters or fewer'),
    handleValidationErrors,
  ],

  deleteSupportedPerson: [
    ...idParam('id', 'House ID'),
    ...idParam('personId', 'Person ID'),
    handleValidationErrors,
  ],

  notificationId: [
    ...idParam('id', 'Notification ID'),
    handleValidationErrors,
  ],

  listNotifications: [
    ...pagination,
    handleValidationErrors,
  ],

  sendTestPush: [
    body('token')
      .trim()
      .notEmpty()
      .withMessage('FCM token is required')
      .isLength({ min: 10, max: 4096 })
      .withMessage('FCM token must be between 10 and 4096 characters'),
    body('title')
      .optional()
      .trim()
      .isLength({ min: 1, max: 120 })
      .withMessage('Title must be between 1 and 120 characters'),
    body('body')
      .optional()
      .trim()
      .isLength({ min: 1, max: 500 })
      .withMessage('Body must be between 1 and 500 characters'),
    handleValidationErrors,
  ],

  listAuditLogs: [
    query('entityType')
      .optional()
      .trim()
      .isLength({ min: 1, max: 80 })
      .withMessage('Entity type must be between 1 and 80 characters'),
    query('entityId')
      .optional()
      .trim()
      .isLength({ min: 1, max: 120 })
      .withMessage('Entity ID must be between 1 and 120 characters'),
    query('actorId')
      .optional()
      .trim()
      .isLength({ min: 1, max: 120 })
      .withMessage('Actor ID must be between 1 and 120 characters'),
    query('action')
      .optional()
      .trim()
      .isLength({ min: 1, max: 120 })
      .withMessage('Action must be between 1 and 120 characters'),
    query('dateFrom')
      .optional()
      .isISO8601()
      .withMessage('Date from must be a valid ISO 8601 date'),
    query('dateTo')
      .optional()
      .isISO8601()
      .withMessage('Date to must be a valid ISO 8601 date'),
    ...pagination,
    handleValidationErrors,
  ],

  houseTimesheets: [
    ...idParam('houseId', 'House ID'),
    query('status')
      .optional()
      .isIn(TIMESHEET_STATUSES)
      .withMessage('Timesheet status must be PENDING, APPROVED, or REJECTED'),
    ...pagination,
    handleValidationErrors,
  ],

  confirmTimesheet: [
    ...idParam('id', 'Timesheet ID'),
    handleValidationErrors,
  ],

  rejectTimesheet: [
    ...idParam('id', 'Timesheet ID'),
    body('reason')
      .trim()
      .notEmpty()
      .withMessage('Rejection reason is required')
      .bail()
      .isLength({ min: 3, max: 500 })
      .withMessage('Rejection reason must be between 3 and 500 characters'),
    handleValidationErrors,
  ],

  resolveTimesheetReview: [
    ...idParam('id', 'Timesheet ID'),
    body('clockOutTime')
      .optional({ nullable: true, checkFalsy: true })
      .isISO8601()
      .withMessage('Clock-out time must be a valid date/time'),
    body('reason')
      .optional({ nullable: true, checkFalsy: true })
      .trim()
      .isLength({ max: 500 })
      .withMessage('Resolution reason must be 500 characters or fewer'),
    handleValidationErrors,
  ],

  userIdParam: [
    ...idParam('userId', 'User ID'),
    handleValidationErrors,
  ],

  createTraining: [
    requiredIdBody('userId', 'User ID'),
    body('title')
      .trim()
      .notEmpty()
      .withMessage('Title is required')
      .isLength({ min: 2, max: 200 })
      .withMessage('Title must be between 2 and 200 characters'),
    body('description')
      .optional({ nullable: true })
      .trim()
      .isLength({ max: 2000 })
      .withMessage('Description must be 2000 characters or fewer'),
    body('status')
      .optional()
      .isIn(TRAINING_STATUSES)
      .withMessage('Training status must be PENDING, IN_PROGRESS, COMPLETED, or EXPIRED'),
    optionalIsoDate('completedAt', 'Completed date'),
    optionalIsoDate('expiresAt', 'Expiry date'),
    handleValidationErrors,
  ],

  updateTraining: [
    ...idParam('id', 'Training ID'),
    body('title')
      .optional()
      .trim()
      .isLength({ min: 2, max: 200 })
      .withMessage('Title must be between 2 and 200 characters'),
    body('description')
      .optional({ nullable: true })
      .trim()
      .isLength({ max: 2000 })
      .withMessage('Description must be 2000 characters or fewer'),
    body('status')
      .optional()
      .isIn(TRAINING_STATUSES)
      .withMessage('Training status must be PENDING, IN_PROGRESS, COMPLETED, or EXPIRED'),
    optionalIsoDate('completedAt', 'Completed date'),
    optionalIsoDate('expiresAt', 'Expiry date'),
    handleValidationErrors,
  ],

  upsertDbs: [
    requiredIdBody('userId', 'User ID'),
    body('status')
      .optional()
      .isIn(DBS_STATUSES)
      .withMessage('DBS status must be PENDING, CLEAR, FLAGGED, or EXPIRED'),
    body('reference')
      .optional({ nullable: true })
      .trim()
      .isLength({ max: 120 })
      .withMessage('Reference must be 120 characters or fewer'),
    optionalIsoDate('issuedAt', 'Issued date'),
    optionalIsoDate('expiresAt', 'Expiry date'),
    body('notes')
      .optional({ nullable: true })
      .trim()
      .isLength({ max: 2000 })
      .withMessage('Notes must be 2000 characters or fewer'),
    handleValidationErrors,
  ],

  // Right-to-Work share code (fine-grained format checks live in the service)
  upsertShareCode: [
    body('code').trim().notEmpty().withMessage('Share code is required'),
    body('shareDate').notEmpty().withMessage('Share date is required'),
    body('notes')
      .optional({ nullable: true })
      .trim()
      .isLength({ max: 1000 })
      .withMessage('Notes must be 1000 characters or fewer'),
    handleValidationErrors,
  ],

  upsertShareCodeForUser: [
    ...idParam('userId', 'User ID'),
    body('code').trim().notEmpty().withMessage('Share code is required'),
    body('shareDate').notEmpty().withMessage('Share date is required'),
    body('notes')
      .optional({ nullable: true })
      .trim()
      .isLength({ max: 1000 })
      .withMessage('Notes must be 1000 characters or fewer'),
    handleValidationErrors,
  ],

  // Leave Requests
  createLeaveRequest: [
    body('workerId')
      .optional()
      .trim()
      .isLength({ min: 5 })
      .withMessage('Worker ID must be valid'),
    body('startDate')
      .notEmpty()
      .withMessage('Start date is required')
      .isISO8601()
      .toDate()
      .withMessage('Start date must be a valid date'),
    body('endDate')
      .notEmpty()
      .withMessage('End date is required')
      .isISO8601()
      .toDate()
      .withMessage('End date must be a valid date'),
    body('reason')
      .optional({ nullable: true, checkFalsy: true })
      .trim()
      .isLength({ max: 500 })
      .withMessage('Reason must be 500 characters or fewer'),
    handleValidationErrors,
  ],

  approveLeaveRequest: [
    ...idParam('id', 'Leave request ID'),
    handleValidationErrors,
  ],

  rejectLeaveRequest: [
    ...idParam('id', 'Leave request ID'),
    body('rejectionReason')
      .trim()
      .notEmpty()
      .withMessage('Rejection reason is required')
      .isLength({ min: 3, max: 500 })
      .withMessage('Rejection reason must be between 3 and 500 characters'),
    handleValidationErrors,
  ],

  cancelLeaveRequest: [
    ...idParam('id', 'Leave request ID'),
    handleValidationErrors,
  ],

  // Announcements
  createAnnouncement: [
    body('title')
      .trim()
      .notEmpty()
      .withMessage('Title is required')
      .isLength({ min: 3, max: 150 })
      .withMessage('Title must be between 3 and 150 characters'),
    body('body')
      .trim()
      .notEmpty()
      .withMessage('Message is required')
      .isLength({ min: 3, max: 3000 })
      .withMessage('Message must be between 3 and 3000 characters'),
    body('pinned')
      .optional()
      .isBoolean()
      .withMessage('Pinned must be true or false'),
    handleValidationErrors,
  ],

  getAnnouncement: [
    ...idParam('id', 'Announcement ID'),
    handleValidationErrors,
  ],

  staffAllocation: [
    query('week')
      .optional({ checkFalsy: true })
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('week must be YYYY-MM-DD'),
    query('proposedShiftId')
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ min: 5 })
      .withMessage('proposedShiftId must be a valid shift id'),
    handleValidationErrors,
  ],

  // ─── Shift Cover / Swap ─────────────────────────────────────────────────
  shiftChangeCover: [
    requiredIdBody('shiftId', 'Shift ID'),
    requiredIdBody('targetWorkerId', 'Teammate ID'),
    body('reason').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 1000 }).withMessage('Reason must be 1000 characters or fewer'),
    handleValidationErrors,
  ],
  shiftChangeSwap: [
    requiredIdBody('shiftId', 'Shift ID'),
    requiredIdBody('targetWorkerId', 'Teammate ID'),
    requiredIdBody('targetShiftId', 'Teammate shift ID'),
    body('reason').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 1000 }).withMessage('Reason must be 1000 characters or fewer'),
    handleValidationErrors,
  ],
  shiftChangeEligibleWorkers: [
    query('shiftId').trim().isLength({ min: 5 }).withMessage('shiftId is required'),
    handleValidationErrors,
  ],
  shiftChangeSwapShifts: [
    query('shiftId').trim().isLength({ min: 5 }).withMessage('shiftId is required'),
    query('targetWorkerId').trim().isLength({ min: 5 }).withMessage('targetWorkerId is required'),
    handleValidationErrors,
  ],
  shiftChangeRespond: [
    ...idParam('id', 'Request ID'),
    body('decision').isIn(['ACCEPT', 'DECLINE']).withMessage('decision must be ACCEPT or DECLINE'),
    handleValidationErrors,
  ],
  shiftChangeIdOnly: [
    ...idParam('id', 'Request ID'),
    handleValidationErrors,
  ],
  shiftChangeApprove: [
    ...idParam('id', 'Request ID'),
    body('overrideWeeklyHours').optional().isBoolean().withMessage('overrideWeeklyHours must be a boolean'),
    body('overrideReason').optional({ nullable: true, checkFalsy: true }).trim().isLength({ min: 3, max: 500 }).withMessage('An override reason of 3–500 characters is required'),
    handleValidationErrors,
  ],
  shiftChangeReject: [
    ...idParam('id', 'Request ID'),
    body('reason').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 1000 }).withMessage('Reason must be 1000 characters or fewer'),
    handleValidationErrors,
  ],
  shiftChangeList: [
    query('page').optional().isInt({ min: 1, max: 10_000 }).withMessage('page must be a positive integer'),
    query('pageSize').optional().isInt({ min: 1, max: 50 }).withMessage('pageSize must be 1–50'),
    query('status').optional().isIn(['PENDING_MANAGER', 'APPROVED', 'REJECTED']).withMessage('invalid status filter'),
    handleValidationErrors,
  ],
};

module.exports = { validators, handleValidationErrors };
