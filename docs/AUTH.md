# Sign-in and accounts

ShiftGO runs its own sign-in with [Better Auth](https://www.better-auth.com)
inside the API. There is no outside identity provider: passwords (hashed with
scrypt), sessions and two-step secrets are stored in the ShiftGO database.

## How people get an account

There is **no public sign-up**.

1. **A new agency** is created by the platform owner:
   ```bash
   npm run agency:create -- --name "Acme Care" --hr-email hr@acme.example --hr-name "Jo Smith"
   ```
   (`--dry-run` shows what would happen.) This creates the agency and emails
   its HR lead an invitation.
2. **Staff** are added by HR in the web app (Staff → Add employee). They get
   an invitation email.
3. The invitation link (`/accept-invite?token=…`) works **once** and for
   **7 days**. Only a SHA-256 of the token is stored. The person sets a
   password (10–128 characters) and is signed in.

To resend, HR adds the same person again: a new link is emailed and the old one stops working.

## Signing in

| Who | Needs |
| --- | --- |
| Workers, team leaders | Email + password. Two-step verification is optional (Profile). |
| HR, managers | Email + password **and** a code from an authenticator app. |

HR and managers are taken to a set-up screen on first sign-in (QR code on
the web; "Open authenticator app" or the key on the phone) and get 10
backup codes. Until it is on, the API answers everything except
`GET /users/me` and the privacy notice with `403 TWO_FACTOR_REQUIRED`.

**Forgot password:** a 6-digit code is emailed (valid 10 minutes, one use).
Resetting signs the person out everywhere. Signing in with an email code is
switched off, so it can't be used to skip two-step verification.

**Deactivating** someone (HR → Staff) deletes all their sessions at once.

**Rate limits:** sign-in 5/minute, two-step codes 5/minute, email codes
3/minute per IP, stored in the database so they hold across instances.

## Sessions

- Web: an HttpOnly, Secure (in production), SameSite=Lax cookie
  `__Secure-shiftgo.session_token`. The web app forwards `/api/*` to the API,
  so the cookie is first-party and JavaScript never sees it.
- Mobile: the same cookie, kept in the phone's encrypted SecureStore and sent
  as a `Cookie` header.
- Sessions last 14 days and are extended once a day while in use.

## Environment

| Variable | Where | Notes |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | backend | 32+ random characters. Changing it signs everyone out. |
| `BETTER_AUTH_URL` | backend | Public URL of the API. |
| `WEB_APP_URL` | backend | Used in invitation links. |
| `CORS_ORIGINS` | backend | Must include the web app URL. |
| `RESEND_API_KEY`, `EMAIL_FROM` | backend | Email. Without a key, development logs emails; production refuses to send. `EMAIL_FROM` must be on a domain verified in Resend. |
| `REQUIRE_2FA_FOR_ADMINS` | backend | Default `true`. Only the test suite turns it off. |
| `API_PROXY_TARGET` | web | The API URL that `/api/*` is forwarded to. |
| `EXPO_PUBLIC_API_URL` | mobile | The API URL (https in release builds). |

## Tests

- `npm test` (backend): the API, with sign-in stubbed.
- `npm run test:auth` (backend): the real flows. These cover invite, sign in,
  wrong password, no sign-up, password reset revoking sessions, blocked
  email-code sign-in, deactivation, HR two-step set-up and code sign-in,
  and brute-force limits.
