const { createClerkClient } = require('@clerk/backend');

module.exports = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
