/**
 * Display-name helpers.
 *
 * The backend `User.name` is non-nullable and, for users Clerk has no first/last
 * name for, ends up holding the email address itself. Never show that as a name,
 * and never derive a name from the local-part of an email. When there is no real
 * name, fall back to something neutral.
 */

interface NamedUser {
  name?: string | null;
  email?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function looksLikeEmail(value?: string | null): boolean {
  return !!value && EMAIL_RE.test(value.trim());
}

/** The user's real name, or null when only an email-ish placeholder is stored. */
export function realNameOf(user?: NamedUser | null): string | null {
  const name = user?.name?.trim();
  if (!name) return null;
  if (looksLikeEmail(name)) return null;
  if (user?.email && name.toLowerCase() === user.email.trim().toLowerCase()) return null;
  return name;
}

/** First name for greetings, or null. */
export function firstNameOf(user?: NamedUser | null): string | null {
  const real = realNameOf(user);
  return real ? real.split(/\s+/)[0] : null;
}

/** Full name for profile areas; neutral fallback when unavailable. */
export function displayNameOf(user?: NamedUser | null, fallback = 'Your account'): string {
  return realNameOf(user) ?? fallback;
}
