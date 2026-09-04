import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, ScrollView } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, PushPin, X } from 'phosphor-react-native';
import { getUnreadAnnouncements, markAnnouncementRead } from '../services/announcementsService';
import { Announcement } from '../types';

const D = {
  emerald: '#005F56',
  white: '#FFFFFF',
  text: '#0D1514',
  muted: '#607370',
  light: '#96AEAB',
  border: '#E2EDEB',
  pinnedBg: 'rgba(0,95,86,0.05)',
  pinnedBorder: 'rgba(0,95,86,0.25)',
};

const ROLE_LABELS: Record<string, string> = {
  HR: 'HR',
  MANAGER: 'Manager',
  TEAM_LEADER: 'Team Leader',
  WORKER: 'Worker',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function initialsOf(name: string): string {
  return name.split(' ').map((n) => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
}

/**
 * Shows a one-time modal after login listing announcements the worker hasn't
 * seen yet. Closing it marks them all read (mirrors the web AnnouncementsPopup).
 * `enabled` is driven by AuthGate so it only runs once the profile sync settles.
 */
export function AnnouncementsPopup({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const [dismissed, setDismissed] = useState(false);
  const [closing, setClosing] = useState(false);

  const { data: unread = [] } = useQuery<Announcement[]>({
    queryKey: ['announcements', 'unread'],
    queryFn: getUnreadAnnouncements,
    enabled,
    staleTime: 30_000,
  });

  // Reset when the session ends so a fresh login shows unseen announcements again.
  useEffect(() => {
    if (!enabled) {
      setDismissed(false);
      setClosing(false);
    }
  }, [enabled]);

  const open = enabled && !dismissed && unread.length > 0;

  function handleClose() {
    if (closing) return;
    setClosing(true);
    Promise.all(unread.map((item) => markAnnouncementRead(item.id)))
      .catch(() => {})
      .finally(() => {
        qc.invalidateQueries({ queryKey: ['announcements'] });
        qc.invalidateQueries({ queryKey: ['announcements', 'unread'] });
        setDismissed(true);
        setClosing(false);
      });
  }

  if (!open) return null;

  const heading = unread.length === 1 ? 'New Announcement' : `${unread.length} New Announcements`;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleClose}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <View style={s.header}>
            <View style={s.headerLeft}>
              <View style={s.headerIcon}>
                <Megaphone size={16} color={D.emerald} weight="fill" />
              </View>
              <Text style={s.heading}>{heading}</Text>
            </View>
            <Pressable onPress={handleClose} hitSlop={8}>
              <X size={20} color={D.muted} weight="bold" />
            </Pressable>
          </View>

          <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
            {unread.map((item) => (
              <View key={item.id} style={[s.item, item.pinned && s.itemPinned]}>
                <View style={s.titleRow}>
                  {item.pinned && <PushPin size={12} color={D.emerald} weight="fill" />}
                  <Text style={s.title}>{item.title}</Text>
                </View>
                <Text style={s.body}>{item.body}</Text>
                <View style={s.authorRow}>
                  <View style={s.avatar}>
                    <Text style={s.avatarTxt}>{initialsOf(item.author.name)}</Text>
                  </View>
                  <Text style={s.authorTxt}>
                    {item.author.name} · {ROLE_LABELS[item.author.role] ?? item.author.role} · {timeAgo(item.createdAt)}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>

          <Pressable
            onPress={handleClose}
            disabled={closing}
            style={({ pressed }) => [s.btn, (pressed || closing) && { opacity: 0.7 }]}
          >
            <Text style={s.btnTxt}>{closing ? 'Closing…' : 'Got it'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, maxHeight: '80%', backgroundColor: D.white, borderRadius: 22, padding: 18 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  headerIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: 'rgba(0,95,86,0.10)', alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 16, fontWeight: '700', color: D.text, flexShrink: 1 },

  scroll: { flexGrow: 0 },
  scrollContent: { gap: 12, paddingBottom: 4 },

  item: { backgroundColor: D.white, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: D.border },
  itemPinned: { borderColor: D.pinnedBorder, backgroundColor: D.pinnedBg },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 },
  title: { fontSize: 14, fontWeight: '700', color: D.text, flexShrink: 1 },
  body: { fontSize: 13, color: D.muted, lineHeight: 19 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  avatar: { width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,95,86,0.10)', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 8, fontWeight: '700', color: D.emerald },
  authorTxt: { fontSize: 11, color: D.light, flexShrink: 1 },

  btn: { marginTop: 16, backgroundColor: D.emerald, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  btnTxt: { fontSize: 15, fontWeight: '700', color: D.white },
});
