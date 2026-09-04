import React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { WarningCircle } from 'phosphor-react-native';
import { useAuthStore } from '../store/authStore';

const C = {
  bg: '#F4F6F5',
  card: '#FFFFFF',
  emerald: '#005F56',
  text: '#0D1514',
  muted: '#607370',
  border: '#E2EDEB',
};

/**
 * Shown when Clerk has a valid session but the backend profile couldn't be
 * loaded (no user row yet, deactivated account, or the API is unreachable).
 * Replaces silently landing on an empty tab screen.
 */
export function ProfileSyncError() {
  const retrySync = useAuthStore((s) => s.retrySync);
  const logout = useAuthStore((s) => s.logout);
  const isLoading = useAuthStore((s) => s.isLoading);

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <WarningCircle size={40} color={C.emerald} weight="fill" />
        <Text style={styles.title}>We couldn&apos;t load your account</Text>
        <Text style={styles.body}>
          You&apos;re signed in, but we couldn&apos;t reach your ShiftGO profile. Your account
          may still be getting set up, or the server is briefly unavailable.
        </Text>

        <Pressable style={styles.primaryBtn} onPress={retrySync} disabled={isLoading}>
          {isLoading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.primaryTxt}>Try again</Text>}
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={logout}>
          <Text style={styles.secondaryTxt}>Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%', maxWidth: 380, backgroundColor: C.card, borderRadius: 24, padding: 28,
    alignItems: 'center', borderWidth: 1, borderColor: C.border,
  },
  title: { fontSize: 18, fontWeight: '700', color: C.text, marginTop: 16, textAlign: 'center' },
  body: { fontSize: 14, color: C.muted, marginTop: 8, textAlign: 'center', lineHeight: 20 },
  primaryBtn: {
    marginTop: 24, alignSelf: 'stretch', backgroundColor: C.emerald, borderRadius: 14,
    paddingVertical: 15, alignItems: 'center',
  },
  primaryTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: { marginTop: 12, alignSelf: 'stretch', borderRadius: 14, paddingVertical: 15, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  secondaryTxt: { color: C.text, fontSize: 15, fontWeight: '600' },
});
