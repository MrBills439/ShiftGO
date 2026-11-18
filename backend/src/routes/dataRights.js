const express = require('express');
const ctrl = require('../controllers/dataRightsController');
const auth = require('../middleware/auth');
const { allow } = require('../middleware/roleGuard');
const asyncHandler = require('../middleware/asyncHandler');

// /privacy-notice
const privacy = express.Router();
privacy.use(auth);
privacy.get('/', asyncHandler(ctrl.getNotice));
privacy.post('/acknowledge', asyncHandler(ctrl.acknowledgeNotice));
privacy.put('/', allow('HR'), asyncHandler(ctrl.updateNotice));

// /deletion-requests (HR)
const deletionRequests = express.Router();
deletionRequests.use(auth);
deletionRequests.get('/', allow('HR'), asyncHandler(ctrl.listDeletionRequests));
deletionRequests.post('/:id/complete', allow('HR'), asyncHandler(ctrl.completeDeletion));
deletionRequests.post('/:id/reject', allow('HR'), asyncHandler(ctrl.rejectDeletion));

module.exports = { privacy, deletionRequests };
