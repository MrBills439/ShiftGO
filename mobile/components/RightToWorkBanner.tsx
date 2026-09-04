import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Warning, CaretRight, X } from 'phosphor-react-native';
import { getMyShareCode } from '../services/rightToWorkService';
import { ShareCode } from '../types';
import { D } from '../constants/theme';

const DISMISS_KEY = 'shiftgo_rtw_banner_dismissed_v1';

/**
 * Nudges a worker to add / refresh their Right-to-Work share code. Shows on the
 * Clock tab only while the status is MISSING or STALE. Dismissal is keyed to the
 * current status, so clearing a "missing" nudge doesn't also hide a later
 * "stale" one.
 */
export function RightToWorkBanner() {
  const router = useRouter();
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const { data } = useQuery<ShareCode>({
    queryKey: ['right-to-work'],
    queryFn: getMyShareCode,
    staleTime: 60_000,
  });

  useEffect(() => {
    AsyncStorage.getItem(DISMISS_KEY)
      .then((v) => setDismissedFor(v))
      .finally(() => setReady(true));
  }, []);

  if (!ready || !data) return null;
  if (data.status !== 'MISSING' && data.status !== 'STALE') return null;
  if (dismissedFor === data.status) return null;

  const missing = data.status === 'MISSING';

  function dismiss() {
    AsyncStorage.setItem(DISMISS_KEY, data!.status).catch(() => {});
    setDismissedFor(data!.status);
  }

  return (
    <Pressable
      onPress={() => router.push('/profile/right-to-work')}
      style={({ pressed }) => [s.wrap, pressed && { opacity: 0.9 }]}
    >
      <View style={s.iconBox}>
        <Warning size={16} color={D.warning} weight="fill" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>
          {missing ? 'Add your Right-to-Work share code' : 'Your Right-to-Work share code needs updating'}
        </Text>
        <Text style={s.sub}>
          {missing ? 'HR needs this on file to verify your status.' : "It's over 90 days old — generate a fresh one."}
        </Text>
      </View>
      <CaretRight size={14} color={D.muted} weight="bold" />
      <Pressable onPress={dismiss} hitSlop={10} style={s.close}>
        <X size={13} color={D.light} weight="bold" />
      </Pressable>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A',
    borderRadius: 14, paddingVertical: 11, paddingLeft: 11, paddingRight: 8,
    marginBottom: 10,
  },
  iconBox: { width: 30, height: 30, borderRadius: 9, backgroundColor: 'rgba(245,158,11,0.14)', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 12.5, fontWeight: '700', color: '#92400E' },
  sub: { fontSize: 11, color: '#B45309', marginTop: 1 },
  close: { padding: 4 },
});
