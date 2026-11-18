/** Only follow same-site paths after sign-in ("/x", never "//evil.com" or "https://…"). */
export function safeNext(next: string | null | undefined, fallback = '/dashboard') {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}
