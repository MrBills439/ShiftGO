import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Alert, Image, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTabBarHeight } from '../../lib/useTabBarHeight';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PencilSimple, CaretRight, SignOut,
  Bell, User, Phone, Envelope, CalendarDots,
  BookOpen, IdentificationCard, Megaphone, ShieldCheck,
} from 'phosphor-react-native';
import { useAuthStore } from '../../store/authStore';
import { getMe, getMyTraining, getMyDbs } from '../../services/profileService';
import { getUnreadAnnouncements } from '../../services/announcementsService';
import { getUnreadCount } from '../../services/notificationsService';
import { getLeaveBalance } from '../../services/leaveRequestService';
import { getMyShareCode } from '../../services/rightToWorkService';
import { API_BASE_URL } from '../../services/api';
import { UserProfile, Training, DbsCheck, Announcement, LeaveBalanceSummary, ShareCode } from '../../types';
import { D } from '../../constants/theme';
import { fmtLeaveDays } from '../../lib/leave';

const BASE_URL = API_BASE_URL;

// ─── Tokens ───────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  HR: 'HR / Super Admin',
  MANAGER: 'Manager',
  TEAM_LEADER: 'Team Leader',
  WORKER: 'Care Support Worker',
};

// ─── Menu Row ─────────────────────────────────────────────────────────────────
function MenuRow({
  iconBg, icon, title, subtitle, badge, last, onPress,
}: {
  iconBg: string; icon: React.ReactNode; title: string; subtitle: string;
  badge?: React.ReactNode; last?: boolean; onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [r.row, last && r.last, pressed && { opacity: 0.65 }]}
    >
      <View style={[r.icon, { backgroundColor: iconBg }]}>{icon}</View>
      <View style={r.info}>
        <Text style={r.title}>{title}</Text>
        <Text style={r.sub}>{subtitle}</Text>
      </View>
      {badge}
      <CaretRight size={15} color={D.light} weight="bold" />
    </Pressable>
  );
}

const r = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#EEF2F1' },
  last: { borderBottomWidth: 0 },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1 },
  title: { fontSize: 14, fontWeight: '600', color: D.text },
  sub: { fontSize: 12, color: D.muted, marginTop: 1 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();
  const tabBarHeight = useTabBarHeight();
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all(
      ['me', 'training', 'dbs', 'announcements', 'notif-count', 'leave-balance'].map((k) =>
        qc.invalidateQueries({ queryKey: [k] })
      )
    );
    setRefreshing(false);
  }

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ['me'],
    queryFn: getMe,
    staleTime: 60_000,
  });

  const { data: trainings = [] } = useQuery<Training[]>({
    queryKey: ['training'],
    queryFn: getMyTraining,
    staleTime: 60_000,
  });

  const { data: dbs } = useQuery<DbsCheck | null>({
    queryKey: ['dbs'],
    queryFn: getMyDbs,
    staleTime: 60_000,
  });

  const { data: unreadAnnouncements = [] } = useQuery<Announcement[]>({
    queryKey: ['announcements', 'unread'],
    queryFn: getUnreadAnnouncements,
    staleTime: 30_000,
  });

  const { data: unreadNotifs = 0 } = useQuery<number>({
    queryKey: ['notif-count'],
    queryFn: getUnreadCount,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const { data: leaveBalance } = useQuery<LeaveBalanceSummary>({
    queryKey: ['leave-balance'],
    queryFn: getLeaveBalance,
    staleTime: 60_000,
  });

  const { data: shareCode } = useQuery<ShareCode>({
    queryKey: ['right-to-work'],
    queryFn: getMyShareCode,
    staleTime: 60_000,
  });

  const displayUser = profile ?? user;
  const firstName = displayUser?.name?.split(' ')[0] ?? 'User';
  const initials = displayUser?.name?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() ?? 'U';
  const roleLabel = ROLE_LABELS[displayUser?.role ?? ''] ?? displayUser?.role ?? 'Staff';

  const completedTraining = trainings.filter((t) => t.status === 'COMPLETED').length;
  const dbsLabel = dbs ? (dbs.status === 'CLEAR' ? 'Verified' : dbs.status) : 'Pending';
  const dbsVerified = dbs?.status === 'CLEAR';
  const leaveLabel =
    leaveBalance === undefined
      ? '…'
      : leaveBalance.hasConfiguredProfile
        ? fmtLeaveDays(leaveBalance.netUsableBalance, leaveBalance.dailyHours)
        : '—';

  const avatarUri = profile?.profilePicture ? `${BASE_URL}${profile.profilePicture}` : null;

  function handleLogout() {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: logout },
    ]);
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.scroll, { paddingBottom: tabBarHeight + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={D.emerald} />}
      >

        {/* ── Header ── */}
        <View style={s.header}>
          <View>
            <Text style={s.title}>My Profile</Text>
            <Text style={s.subtitle}>Manage your account and preferences</Text>
          </View>
        </View>

        {/* ── Profile Card ── */}
        <View style={s.profileCard}>
          <View style={s.profileLeft}>
            {/* Avatar with edit badge */}
            <View style={s.avatarWrap}>
              {avatarUri
                ? <Image source={{ uri: avatarUri }} style={s.avatarImg} />
                : (
                  <View style={s.avatar}>
                    <Text style={s.avatarTxt}>{initials}</Text>
                  </View>
                )}
              <Pressable
                style={s.editBadge}
                onPress={() => router.push('/profile/personal')}
              >
                <PencilSimple size={10} color={D.white} weight="bold" />
              </Pressable>
            </View>
            <View style={s.profileInfo}>
              <Text style={s.profileName}>{displayUser?.name ?? 'Unknown User'}</Text>
              <Text style={s.profileRole}>{roleLabel}</Text>
              <View style={s.profileDetailRow}>
                <Envelope size={12} color={D.light} weight="regular" />
                <Text style={s.profileDetailTxt} numberOfLines={1}>{displayUser?.email ?? '—'}</Text>
              </View>
              {profile?.phone ? (
                <View style={s.profileDetailRow}>
                  <Phone size={12} color={D.light} weight="regular" />
                  <Text style={s.profileDetailTxt}>{profile.phone}</Text>
                </View>
              ) : null}
            </View>
          </View>
          <View style={s.activeBadge}>
            <View style={s.activeDot} />
            <Text style={s.activeTxt}>Active</Text>
          </View>
        </View>

        {/* ── Stats Card ── */}
        <LinearGradient
          colors={[D.eDark, D.eMid, D.eLight]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={s.statsCard}
        >
          <View style={[s.decoCircle, { width: 160, height: 160, top: -60, right: -40 }]} />
          <View style={[s.decoCircle, { width: 90, height: 90, bottom: -35, left: -15 }]} />
          {[
            { value: leaveLabel, label: 'Leave balance' },
            { value: `${completedTraining}/${trainings.length}`, label: 'Trainings' },
            { value: dbsLabel, label: 'DBS status' },
          ].map((stat, i, arr) => (
            <React.Fragment key={stat.label}>
              <View style={s.statCol}>
                <Text style={s.statVal}>{stat.value}</Text>
                <Text style={s.statLbl}>{stat.label}</Text>
              </View>
              {i < arr.length - 1 && <View style={s.statDivider} />}
            </React.Fragment>
          ))}
        </LinearGradient>

        {/* ── Updates Section ── */}
        <Text style={s.sectionLabel}>UPDATES</Text>
        <View style={s.card}>
          <MenuRow
            iconBg="rgba(0,95,86,0.09)"
            icon={<Megaphone size={18} color={D.emerald} weight="regular" />}
            title="Announcements"
            subtitle="Agency-wide updates and news"
            badge={
              unreadAnnouncements.length > 0 ? (
                <View style={s.countBadge}>
                  <Text style={s.countTxt}>{unreadAnnouncements.length > 9 ? '9+' : unreadAnnouncements.length}</Text>
                </View>
              ) : undefined
            }
            last
            onPress={() => router.push('/announcements')}
          />
        </View>

        {/* ── Work Section ── */}
        <Text style={s.sectionLabel}>WORK</Text>
        <View style={s.card}>
          <MenuRow
            iconBg="rgba(0,95,86,0.09)"
            icon={<User size={18} color={D.emerald} weight="regular" />}
            title="Personal Information"
            subtitle="Update your personal details"
            onPress={() => router.push('/profile/personal')}
          />
          <MenuRow
            iconBg="rgba(245,158,11,0.10)"
            icon={<BookOpen size={18} color="#F59E0B" weight="regular" />}
            title="Training"
            subtitle={`${completedTraining} of ${trainings.length} completed`}
            onPress={() => router.push('/profile/training')}
          />
          <MenuRow
            iconBg="rgba(0,95,86,0.09)"
            icon={<CalendarDots size={18} color={D.emerald} weight="regular" />}
            title="Time Off"
            subtitle={
              leaveBalance?.hasConfiguredProfile
                ? `${leaveLabel} available · book and track leave`
                : 'Book and track your leave'
            }
            onPress={() => router.push('/leave')}
          />
          <MenuRow
            iconBg="rgba(37,99,235,0.10)"
            icon={<ShieldCheck size={18} color="#2563EB" weight="regular" />}
            title="Right to Work"
            subtitle="Your share code and proof document"
            badge={
              shareCode && shareCode.status !== 'CURRENT' ? (
                <View style={s.actionBadge}>
                  <Text style={s.actionBadgeTxt}>{shareCode.status === 'MISSING' ? 'Add now' : 'Update'}</Text>
                </View>
              ) : shareCode?.status === 'CURRENT' ? (
                <View style={s.verifiedBadge}>
                  <Text style={s.verifiedTxt}>Current</Text>
                </View>
              ) : undefined
            }
            onPress={() => router.push('/profile/right-to-work')}
          />
          <MenuRow
            iconBg="rgba(22,163,74,0.10)"
            icon={<IdentificationCard size={18} color="#16A34A" weight="regular" />}
            title="DBS Check"
            subtitle="View your DBS status and details"
            badge={
              <View style={[s.verifiedBadge, !dbsVerified && { backgroundColor: 'rgba(96,115,112,0.10)' }]}>
                <Text style={[s.verifiedTxt, !dbsVerified && { color: D.muted }]}>{dbsLabel}</Text>
              </View>
            }
            last
            onPress={() => router.push('/profile/dbs')}
          />
        </View>

        {/* ── Alerts Section ── */}
        <Text style={s.sectionLabel}>ALERTS</Text>
        <View style={s.card}>
          <MenuRow
            iconBg="rgba(99,102,241,0.10)"
            icon={<Bell size={18} color="#6366F1" weight="regular" />}
            title="Notifications"
            subtitle="Your shift alerts and updates"
            badge={
              unreadNotifs > 0 ? (
                <View style={s.countBadge}>
                  <Text style={s.countTxt}>{unreadNotifs > 9 ? '9+' : unreadNotifs}</Text>
                </View>
              ) : undefined
            }
            last
            onPress={() => router.push('/notifications')}
          />
        </View>

        {/* ── Logout ── */}
        <View style={[s.card, s.logoutCard]}>
          <Pressable
            onPress={handleLogout}
            style={({ pressed }) => [s.logoutRow, pressed && { opacity: 0.65 }]}
          >
            <View style={[r.icon, { backgroundColor: '#FEF2F2' }]}>
              <SignOut size={18} color="#EF4444" weight="regular" />
            </View>
            <Text style={s.logoutTxt}>Log Out</Text>
          </Pressable>
        </View>

        <Text style={s.version}>ShiftGO v1.0 · GPS Attendance Platform</Text>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: D.bg },
  scroll: { paddingHorizontal: 18 },

  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingTop: 12, marginBottom: 18 },
  title: { fontSize: 24, fontWeight: '700', color: D.text, letterSpacing: -0.4 },
  subtitle: { fontSize: 13, color: D.muted, marginTop: 3 },
  gearBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: D.white, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: D.border, marginTop: 4 },

  // Profile card
  profileCard: {
    backgroundColor: D.white, borderRadius: 20, padding: 16, marginBottom: 14,
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    borderWidth: 1, borderColor: D.border,
    shadowColor: '#00534812', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 16, elevation: 3,
  },
  profileLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, flex: 1 },
  avatarWrap: { position: 'relative' },
  avatar: { width: 64, height: 64, borderRadius: 20, backgroundColor: D.emerald, alignItems: 'center', justifyContent: 'center' },
  avatarImg: { width: 64, height: 64, borderRadius: 20 },
  avatarTxt: { fontSize: 22, fontWeight: '700', color: '#fff' },
  editBadge: { position: 'absolute', bottom: -3, right: -3, width: 20, height: 20, borderRadius: 6, backgroundColor: D.emerald, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: D.white },
  profileInfo: { flex: 1, paddingTop: 2 },
  profileName: { fontSize: 16, fontWeight: '700', color: D.text, marginBottom: 2 },
  profileRole: { fontSize: 12, color: D.emerald, fontWeight: '600', marginBottom: 8 },
  profileDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  profileDetailTxt: { fontSize: 12, color: D.muted },
  activeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: D.greenBadgeBg, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: D.greenBadgeTxt },
  activeTxt: { fontSize: 11, fontWeight: '700', color: D.greenBadgeTxt },

  // Stats card
  statsCard: {
    borderRadius: 20, paddingVertical: 20, paddingHorizontal: 14,
    marginBottom: 24, flexDirection: 'row', alignItems: 'center',
    overflow: 'hidden',
  },
  decoCircle: { position: 'absolute', borderRadius: 9999, backgroundColor: 'rgba(255,255,255,0.05)' },
  statCol: { flex: 1, alignItems: 'center' },
  statVal: { fontSize: 18, fontWeight: '700', color: '#fff', letterSpacing: -0.4, marginBottom: 4 },
  statLbl: { fontSize: 10, color: 'rgba(255,255,255,0.6)', fontWeight: '500', textAlign: 'center', lineHeight: 13 },
  statDivider: { width: 1, height: 36, backgroundColor: 'rgba(255,255,255,0.14)' },

  // Section
  sectionLabel: { fontSize: 10, fontWeight: '700', color: D.light, letterSpacing: 1.2, marginBottom: 8, marginLeft: 4 },
  card: { backgroundColor: D.white, borderRadius: 18, marginBottom: 20, borderWidth: 1, borderColor: D.border, overflow: 'hidden', shadowColor: '#00534810', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 10, elevation: 2 },

  // Badges on rows
  verifiedBadge: { backgroundColor: D.verifiedBg, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4, marginRight: 6 },
  verifiedTxt: { fontSize: 11, fontWeight: '700', color: D.emerald },
  actionBadge: { backgroundColor: '#FEF2F2', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4, marginRight: 6, borderWidth: 1, borderColor: '#FECACA' },
  actionBadgeTxt: { fontSize: 11, fontWeight: '700', color: '#EF4444' },
  countBadge: { backgroundColor: D.emerald, borderRadius: 20, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginRight: 6 },
  countTxt: { fontSize: 11, fontWeight: '700', color: '#fff' },
  valueTxt: { fontSize: 12, fontWeight: '600', color: D.muted, marginRight: 6 },

  // Logout
  logoutCard: { marginBottom: 12 },
  logoutRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  logoutTxt: { fontSize: 15, fontWeight: '600', color: '#EF4444', flex: 1 },

  version: { fontSize: 11, color: D.light, textAlign: 'center', marginBottom: 8 },
});
