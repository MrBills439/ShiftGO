/**
 * Sign-in for ShiftGO (Better Auth).
 *
 * Better Auth owns IDENTITY only: passwords, sessions, two-step verification
 * and reset codes. ShiftGO keeps owning agencies, roles and employment data on
 * its own User row (Better Auth's "user" model IS our User table).
 *
 * Rules enforced here:
 *  - no public sign-up: accounts are created only by accepting an invitation
 *    (src/services/invitationService.js);
 *  - deactivated people cannot start a session, even with the right password;
 *  - the email-code plugin is used ONLY for "forgot password" — signing in
 *    with an emailed code is blocked, because it would skip two-step
 *    verification;
 *  - a password reset signs the person out everywhere;
 *  - rate limits are stored in the database, so they hold across instances.
 *
 * Loaded lazily (getAuth) because better-auth is an ES module: the Express
 * server (Node 22) can require() it, the Jest suite cannot and never needs to.
 */
let instance = null;

function getAuth() {
  if (instance) return instance;
  const { betterAuth } = require('better-auth');
  const { prismaAdapter } = require('better-auth/adapters/prisma');
  const { twoFactor, emailOTP } = require('better-auth/plugins');
  const { APIError, createAuthMiddleware } = require('better-auth/api');
  const { expo } = require('@better-auth/expo');
  const prisma = require('../lib/prisma');
  const config = require('../config');
  const { sendEmail, layout } = require('../lib/email');

  const isProd = process.env.NODE_ENV === 'production';
  const trustedOrigins = [
    ...config.cors.origins,
    'shiftgo://',
    ...(isProd ? [] : ['exp://', 'exp://**']),
  ];

  async function revokeAllSessionsFor(email) {
    const user = await prisma.user.findFirst({ where: { email: String(email || '').toLowerCase() }, select: { id: true } });
    if (user) await prisma.session.deleteMany({ where: { userId: user.id } });
  }

  instance = betterAuth({
    appName: 'ShiftGO',
    secret: config.auth.secret,
    baseURL: config.auth.baseURL,
    basePath: '/auth',
    trustedOrigins,
    database: prismaAdapter(prisma, { provider: 'postgresql' }),

    user: {
      fields: { image: 'profilePicture' },
      additionalFields: {
        role: { type: 'string', input: false, required: false },
        agencyId: { type: 'string', input: false, required: false },
        status: { type: 'string', input: false, required: false },
      },
    },

    emailAndPassword: {
      enabled: true,
      disableSignUp: true, // invitations only
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },

    session: {
      expiresIn: 60 * 60 * 24 * 14, // 14 days, sliding
      updateAge: 60 * 60 * 24, // refresh at most daily
    },

    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/two-factor/*': { window: 60, max: 5 },
        '/email-otp/*': { window: 60, max: 3 },
      },
    },

    advanced: {
      cookiePrefix: 'shiftgo',
      useSecureCookies: isProd,
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
    },

    databaseHooks: {
      session: {
        create: {
          // Deactivated staff are refused a session no matter how they sign in.
          before: async (session) => {
            const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { status: true } });
            if (!user || user.status !== 'ACTIVE') {
              throw new APIError('FORBIDDEN', { message: 'This account has been deactivated. Contact your HR team.' });
            }
            return { data: session };
          },
        },
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Email codes are for password reset only — never a way to sign in.
        if (ctx.path === '/sign-in/email-otp') {
          throw new APIError('FORBIDDEN', { message: 'Sign in with your email and password.' });
        }
        if (ctx.path === '/email-otp/send-verification-otp' && ctx.body?.type !== 'forget-password') {
          throw new APIError('FORBIDDEN', { message: 'Codes can only be requested to reset a password.' });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        // A reset by email code must also sign the person out everywhere.
        if (ctx.path === '/email-otp/reset-password' && !ctx.context.returned?.error) {
          await revokeAllSessionsFor(ctx.body?.email);
        }
      }),
    },

    plugins: [
      twoFactor({ issuer: 'ShiftGO' }),
      emailOTP({
        disableSignUp: true,
        otpLength: 6,
        expiresIn: 10 * 60,
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== 'forget-password') return;
          const subject = 'Your ShiftGO password reset code';
          const lines = [
            `Your code to reset your ShiftGO password is ${otp}.`,
            'It expires in 10 minutes. If you did not ask to reset your password, you can ignore this email.',
          ];
          // Not awaited: a slow mail provider must not reveal whether the address exists.
          sendEmail({ to: email, subject, text: lines.join('\n\n'), html: layout('Reset your password', lines) })
            .catch(() => {});
        },
      }),
      expo(),
    ],
  });
  return instance;
}

/** Express handler for every /auth/* request (mounted before express.json()). */
function authHandler(req, res) {
  const { toNodeHandler } = require('better-auth/node');
  if (!authHandler.node) authHandler.node = toNodeHandler(getAuth());
  return authHandler.node(req, res);
}

module.exports = { getAuth, authHandler };
