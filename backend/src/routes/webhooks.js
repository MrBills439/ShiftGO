const router = require('express').Router();
const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const webhookController = require('../controllers/webhookController');

// Raw body required for Clerk's svix signature verification — must not pass
// through the app-wide express.json() parser.
router.post('/clerk', express.raw({ type: 'application/json' }), asyncHandler(webhookController.receive));

module.exports = router;
