import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ArrowLeft, Megaphone, PushPin } from 'phosphor-react-native';
import { getAnnouncements, markAnnouncementRead } from '../../services/announcementsService';
import { Announcement } from '../../types';
import { D } from '../../constants/theme';
import { timeAgo } from '../../lib/datetime';


const ROLE_LABELS: Record<string, string> = {
  HR: 'HR',
  MANAGER: 'Manager',
  TEAM_LEADER: 'Team Leader',
  WORKER: 'Worker',
};

function initialsOf(name: string): string {
  return name.split(' ').map((n) => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
}

function AnnouncementCard({ item }: { item: Announcement }) {
  return (
    <View style={[a.card, item.pinned && a.cardPinned]}>
      <View style={a.titleRow}>
        {item.pinned && <PushPin size={13} color={D.emerald} weight="fill" />}
        {!item.read && <View style={a.dot} />}
        <Text style={a.title}>{item.title}</Text>
      </View>
      <Text style={a.body}>{item.body}</Text>
      <View style={a.authorRow}>
        <View style={a.avatar}>
          <Text style={a.avatarTxt}>{initialsOf(item.author.name)}</Text>
        </View>
        <Text style={a.authorTxt}>
          {item.author.name} · {ROLE_LABELS[item.author.role] ?? item.author.role} · {timeAgo(item.createdAt)}
        </Text>
      </View>
    </View>
  );
}

const a = StyleSheet.create({
  card: { backgroundColor: D.white, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: D.border, marginBottom: 12 },
  cardPinned: { borderColor: D.pinnedBorder, backgroundColor: D.pinnedBg },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: D.unreadDot },
  title: { fontSize: 15, fontWeight: '700', color: D.text, flexShrink: 1 },
  body: { fontSize: 13, color: D.muted, lineHeight: 20 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  avatar: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,95,86,0.10)', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 9, fontWeight: '700', color: D.emerald },
  authorTxt: { fontSize: 11, color: D.light, flexShrink: 1 },
});

export default function AnnouncementsScreen() {
  const router = useRouter();
  const qc = useQueryClient();

  const { data = [], isLoading, refetch } = useQuery<Announcement[]>({
    queryKey: ['announcements'],
    queryFn: getAnnouncements,
    staleTime: 30_000,
  });

  const readMutation = useMutation({
    mutationFn: markAnnouncementRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['announcements'] });
      qc.invalidateQueries({ queryKey: ['announcements', 'unread'] });
    },
  });

  // Opening this screen counts as reading — clear unread markers so the profile
  // tab badge and any login popup stop flagging announcements already seen here.
  const markedRef = useRef(new Set<string>());
  useEffect(() => {
    for (const item of data) {
      if (item.read === false && !markedRef.current.has(item.id)) {
        markedRef.current.add(item.id);
        readMutation.mutate(item.id);
      }
    }
  }, [data]);

  const unread = data.filter((n) => n.read === false).length;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
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
          <Text style={s.title}>Announcements</Text>
          {unread > 0 && (
            <View style={s.badge}>
              <Text style={s.badgeTxt}>{unread}</Text>
            </View>
          )}
        </View>
        <View style={{ width: 40 }} />
      </View>

      {isLoading ? (
        <View style={s.loadWrap}>
          <ActivityIndicator size="large" color={D.emerald} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={data.length === 0 ? s.emptyScroll : s.listScroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={D.emerald} />}
        >
          {data.length === 0 ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Megaphone size={32} color={D.light} weight="thin" />
              </View>
              <Text style={s.emptyTitle}>No announcements yet</Text>
              <Text style={s.emptySub}>Agency-wide updates from your team will appear here.</Text>
            </View>
          ) : (
            data.map((item) => <AnnouncementCard key={item.id} item={item} />)
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: D.bg },
  loadWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyScroll: { flex: 1 },
  listScroll: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 32 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 12,
  },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: D.white, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: D.border },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 20, fontWeight: '700', color: D.text },
  badge: { backgroundColor: D.emerald, borderRadius: 20, minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeTxt: { fontSize: 12, fontWeight: '700', color: '#fff' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyIcon: { width: 80, height: 80, borderRadius: 28, backgroundColor: D.white, alignItems: 'center', justifyContent: 'center', marginBottom: 16, borderWidth: 1, borderColor: D.border },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: D.text, marginBottom: 8 },
  emptySub: { fontSize: 14, color: D.muted, textAlign: 'center', lineHeight: 21 },
});
