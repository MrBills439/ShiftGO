import React, { useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  ArrowLeft, Bell, CalendarCheck, CalendarX,
  Clock, Warning, CheckCircle, CheckFat,
} from 'phosphor-react-native';
import { getNotifications, markRead, markAllRead } from '../../services/notificationsService';
import { Skeleton } from '../../components/Skeleton';
import { AppNotification, NotificationType } from '../../types';
import { D } from '../../constants/theme';
import { timeAgo } from '../../lib/datetime';


const typeConfig: Record<NotificationType, { icon: React.ReactNode; color: string; bg: string }> = {
  SHIFT_ASSIGNED:  { icon: <CalendarCheck size={18} color="#16A34A" weight="fill" />, color: '#16A34A', bg: 'rgba(22,163,74,0.10)' },
  SHIFT_REMOVED:   { icon: <CalendarX size={18} color="#EF4444" weight="fill" />, color: '#EF4444', bg: 'rgba(239,68,68,0.10)' },
  SHIFT_REMINDER:  { icon: <Clock size={18} color="#F59E0B" weight="fill" />, color: '#F59E0B', bg: 'rgba(245,158,11,0.10)' },
  SHIFT_OPEN:          { icon: <CalendarCheck size={18} color="#D97706" weight="fill" />, color: '#D97706', bg: 'rgba(217,119,6,0.10)' },
  SHIFT_DROPPED:       { icon: <CalendarX size={18} color="#D97706" weight="fill" />, color: '#D97706', bg: 'rgba(217,119,6,0.10)' },
  SHIFT_CLAIMED_YOU:   { icon: <CalendarCheck size={18} color="#16A34A" weight="fill" />, color: '#16A34A', bg: 'rgba(22,163,74,0.10)' },
  SHIFT_CLAIMED_OTHER: { icon: <CalendarX size={18} color={D.muted} weight="fill" />, color: D.muted, bg: 'rgba(96,115,112,0.10)' },
  MISSED_CLOCK_IN: { icon: <Warning size={18} color="#EF4444" weight="fill" />, color: '#EF4444', bg: 'rgba(239,68,68,0.10)' },
  CLOCK_OUT_PROMPT:{ icon: <Clock size={18} color="#F59E0B" weight="fill" />, color: '#F59E0B', bg: 'rgba(245,158,11,0.10)' },
  GENERAL:         { icon: <Bell size={18} color={D.emerald} weight="fill" />, color: D.emerald, bg: 'rgba(0,95,86,0.10)' },
};

function NotificationItem({ notif, onPress }: { notif: AppNotification; onPress: () => void }) {
  const cfg = typeConfig[notif.type] ?? typeConfig.GENERAL;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [ni.row, !notif.read && ni.unread, pressed && { opacity: 0.75 }]}
    >
      <View style={[ni.iconBox, { backgroundColor: cfg.bg }]}>{cfg.icon}</View>
      <View style={ni.content}>
        <View style={ni.top}>
          <Text style={[ni.title, !notif.read && ni.titleBold]} numberOfLines={1}>{notif.title}</Text>
          <Text style={ni.time}>{timeAgo(notif.createdAt)}</Text>
        </View>
        <Text style={ni.body} numberOfLines={2}>{notif.body}</Text>
      </View>
      {!notif.read && <View style={ni.dot} />}
    </Pressable>
  );
}

const ni = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#EEF2F1' },
  unread: { backgroundColor: D.unreadBg },
  iconBox: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 1, flexShrink: 0 },
  content: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  title: { fontSize: 14, fontWeight: '500', color: D.text, flex: 1, marginRight: 8 },
  titleBold: { fontWeight: '700' },
  body: { fontSize: 13, color: D.muted, lineHeight: 18 },
  time: { fontSize: 11, color: D.light, flexShrink: 0 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: D.unreadDot, marginTop: 6, flexShrink: 0 },
});

export default function NotificationsScreen() {
  const router = useRouter();
  const qc = useQueryClient();

  const { data = [], isLoading, refetch } = useQuery<AppNotification[]>({
    queryKey: ['notifications'],
    queryFn: getNotifications,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  // Pull fresh notifications every time this screen comes into focus.
  useFocusEffect(
    useCallback(() => {
      refetch();
      qc.invalidateQueries({ queryKey: ['notif-count'] });
    }, [refetch, qc])
  );

  const readMutation = useMutation({
    mutationFn: markRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notif-count'] });
    },
  });

  const readAllMutation = useMutation({
    mutationFn: markAllRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notif-count'] });
    },
  });

  const unread = data.filter((n) => !n.read).length;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={s.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.65 }]}
        >
          <ArrowLeft size={20} color={D.text} weight="bold" />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.title}>Notifications</Text>
          {unread > 0 && (
            <View style={s.badge}>
              <Text style={s.badgeTxt}>{unread}</Text>
            </View>
          )}
        </View>
        {unread > 0 ? (
          <Pressable
            onPress={() => readAllMutation.mutate()}
            style={({ pressed }) => [s.readAllBtn, pressed && { opacity: 0.65 }]}
          >
            <CheckFat size={16} color={D.emerald} weight="bold" />
          </Pressable>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {isLoading ? (
        <View style={s.list}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={ni.row}>
              <Skeleton width={42} height={42} radius={13} />
              <View style={ni.content}>
                <Skeleton width="55%" height={13} />
                <Skeleton width="85%" height={12} style={{ marginTop: 7 }} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={data.length === 0 ? s.emptyScroll : undefined}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={D.emerald} />}
        >
          {data.length === 0 ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Bell size={32} color={D.light} weight="thin" />
              </View>
              <Text style={s.emptyTitle}>No notifications</Text>
              <Text style={s.emptySub}>You're all caught up! Notifications about your shifts will appear here.</Text>
            </View>
          ) : (
            <View style={s.list}>
              {data.map((n) => (
                <NotificationItem
                  key={n.id}
                  notif={n}
                  onPress={() => {
                    if (!n.read) readMutation.mutate(n.id);
                    if (n.type === 'SHIFT_OPEN') {
                      router.push('/(tabs)/shifts' as any);
                    } else if (n.data?.shiftId) {
                      router.push(`/shift/${n.data.shiftId}`);
                    }
                  }}
                />
              ))}
              <View style={s.listEnd} />
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: D.bg },
  emptyScroll: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 12,
  },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: D.white, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: D.border },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 20, fontWeight: '700', color: D.text },
  badge: { backgroundColor: D.emerald, borderRadius: 20, minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeTxt: { fontSize: 12, fontWeight: '700', color: '#fff' },
  readAllBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: D.white, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: D.border },

  list: { backgroundColor: D.white, borderRadius: 22, marginHorizontal: 18, marginTop: 8, borderWidth: 1, borderColor: D.border, overflow: 'hidden', shadowColor: '#00534810', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 16, elevation: 3 },
  listEnd: { height: 1 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyIcon: { width: 80, height: 80, borderRadius: 28, backgroundColor: D.white, alignItems: 'center', justifyContent: 'center', marginBottom: 16, borderWidth: 1, borderColor: D.border },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: D.text, marginBottom: 8 },
  emptySub: { fontSize: 14, color: D.muted, textAlign: 'center', lineHeight: 21 },
});
