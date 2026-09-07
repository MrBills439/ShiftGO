import { useEffect } from 'react';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { ClerkAuthSync } from '../components/ClerkAuthSync';
import { ProfileSyncError } from '../components/ProfileSyncError';
import { AnnouncementsPopup } from '../components/AnnouncementsPopup';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useAuthStore } from '../store/authStore';
import { identifyUser } from '../lib/monitoring';
import { tokenCache } from '../lib/tokenCache';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnReconnect: true,
    },
  },
});

function AuthGate() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const qc = useQueryClient();
  const syncError = useAuthStore((s) => s.error);
  const syncLoading = useAuthStore((s) => s.isLoading);
  const user = useAuthStore((s) => s.user);

  const inAuth = segments[0] === '(auth)';
  const inOnboarding = segments[0] === 'onboarding';
  // Only decide once the profile has actually loaded — `onboardedAt` lives on it.
  const needsOnboarding = !!user && !user.onboardedAt;

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      if (!inAuth) router.replace('/(auth)/login');
      return;
    }
    // Signed in. New users (no onboardedAt) go through onboarding first.
    if (needsOnboarding && !inOnboarding) {
      router.replace('/onboarding');
    } else if (!needsOnboarding && (inAuth || inOnboarding)) {
      router.replace('/(tabs)/clock');
    }
  }, [isSignedIn, isLoaded, segments, needsOnboarding]);

  useEffect(() => {
    identifyUser(user ? { id: user.id, email: user.email } : null);
  }, [user]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as
        | { type?: string; shiftId?: string; kind?: string }
        | undefined;
      if (!data) return;
      if (data.kind === 'ANNOUNCEMENT') {
        router.push('/announcements' as Href);
      } else if (data.type === 'SHIFT_OPEN') {
        router.push('/(tabs)/shifts' as Href);
      } else if (data.shiftId) {
        router.push(`/shift/${data.shiftId}` as Href);
      } else if (typeof data.kind === 'string' && data.kind.startsWith('LEAVE')) {
        router.push('/leave' as Href);
      }
    });
    return () => sub.remove();
  }, [router]);

  // A push that arrives while the app is open should refresh the lists it
  // affects, so the user never has to pull-to-refresh or restart.
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as { kind?: string } | undefined;
      qc.invalidateQueries({ queryKey: ['notifications'] });
      if (data?.kind === 'ANNOUNCEMENT') {
        qc.invalidateQueries({ queryKey: ['announcements'] });
        qc.invalidateQueries({ queryKey: ['announcements', 'unread'] });
      }
    });
    return () => sub.remove();
  }, [qc]);

  // Signed into Clerk, but the profile sync exhausted its retries — show a real
  // error instead of empty tab screens behind the UI. (After all hooks.)
  const showSyncError = isLoaded && isSignedIn && !inAuth && !inOnboarding && !syncLoading && syncError;
  const showAnnouncements =
    isLoaded && isSignedIn && !inAuth && !inOnboarding && !syncLoading && !syncError && !!user;

  if (showSyncError) return <ProfileSyncError />;

  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <AnnouncementsPopup enabled={showAnnouncements} />
    </>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <ClerkProvider
          publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!}
          tokenCache={tokenCache}
        >
          <QueryClientProvider client={queryClient}>
            <ClerkAuthSync />
            <AuthGate />
          </QueryClientProvider>
        </ClerkProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
