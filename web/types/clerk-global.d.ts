export {};

declare global {
  interface Window {
    Clerk?: {
      signOut: (opts?: { redirectUrl?: string }) => Promise<void>;
      session?: { getToken: () => Promise<string | null> };
    };
  }
}
