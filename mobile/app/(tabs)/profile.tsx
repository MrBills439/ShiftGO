import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Alert, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  Gear, PencilSimple, CaretRight, SignOut,
  Bell, ShieldCheck, Sun, User, Phone, Envelope,
  BookOpen, IdentificationCard, SlidersHorizontal,
} from 'phosphor-react-native';
import { useAuthStore } from '../../store/authStore';
import { getMe, getMyTraining, getMyDbs } from '../../services/profileService';
import { UserProfile, Training, DbsCheck } from '../../types';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

// ─── Tokens ───────────────────────────────────────────────────────────────────
const D = {
  bg: '#F4F6F5',
  emerald: '#005F56',
  eDark: '#002E28',
  eMid: '#004A42',
  eLight: '#0A7060',
  white: '#FFFFFF',
  text: '#0D1514',
  muted: '#607370',
  light: '#96AEAB',
  border: '#E2EDEB',
  greenBadgeBg: '#DCFCE7',
  greenBadgeTxt: '#16A34A',
  verifiedBg: 'rgba(0,95,86,0.10)',
};

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

  const displayUser = profile ?? user;
  const firstName = displayUser?.name?.split(' ')[0] ?? 'User';
  const initials = displayUser?.name?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() ?? 'U';
  const roleLabel = ROLE_LABELS[displayUser?.role ?? ''] ?? displayUser?.role ?? 'Staff';

  const completedTraining = trainings.filter((t) => t.status === 'COMPLETED').length;
  const dbsLabel = dbs ? (dbs.status === 'CLEAR' ? 'Verified' : dbs.status) : 'Pending';
  const dbsVerified = dbs?.status === 'CLEAR';

  const avatarUri = profile?.profilePicture ? `${BASE_URL}${profile.profilePicture}` : null;

  function handleLogout() {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: logout },
    ]);
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

        {/* ── Header ── */}
        <View style={s.header}>
          <View>
            <Text style={s.title}>My Profile</Text>
            <Text style={s.subtitle}>Manage your account and preferences</Text>
          </View>
          <Pressable style={s.gearBtn} onPress={() => Alert.alert('Settings', 'Settings coming soon.')}>
            <Gear size={20} color={D.muted} weight="regular" />
          </Pressable>
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
                onPress={() => router.push('/profile/personal' as any)}
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
              <View style={s.profileDetailRow}>
                <Phone size={12} color={D.light} weight="regular" />
                <Text style={s.profileDetailTxt}>{profile?.phone ?? '+44 —'}</Text>
              </View>
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
            { value: `${completedTraining}`, label: 'Trainings done' },
            { value: dbsLabel, label: 'DBS Status' },
            { value: '98%', label: 'Attendance' },
            { value: '4.9', label: 'Rating' },
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

        {/* ── Work Section ── */}
        <Text style={s.sectionLabel}>WORK</Text>
        <View style={s.card}>
          <MenuRow
            iconBg="rgba(0,95,86,0.09)"
            icon={<User size={18} color={D.emerald} weight="regular" />}
            title="Personal Information"
            subtitle="Update your personal details"
            onPress={() => router.push('/profile/personal' as any)}
          />
          <MenuRow
            iconBg="rgba(245,158,11,0.10)"
            icon={<BookOpen size={18} color="#F59E0B" weight="regular" />}
            title="Training"
            subtitle={`${completedTraining} of ${trainings.length} completed`}
            onPress={() => router.push('/profile/training' as any)}
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
            onPress={() => router.push('/profile/dbs' as any)}
          />
        </View>

        {/* ── Preferences Section ── */}
        <Text style={s.sectionLabel}>PREFERENCES</Text>
        <View style={s.card}>
          <MenuRow
            iconBg="rgba(99,102,241,0.10)"
            icon={<Bell size={18} color="#6366F1" weight="regular" />}
            title="Notifications"
            subtitle="Manage your notification preferences"
            onPress={() => router.push('/notifications' as any)}
          />
          <MenuRow
            iconBg="rgba(0,95,86,0.09)"
            icon={<ShieldCheck size={18} color={D.emerald} weight="regular" />}
            title="Privacy & Security"
            subtitle="Manage privacy and security settings"
            onPress={() => Alert.alert('Privacy & Security', 'Coming soon.')}
          />
          <MenuRow
            iconBg="rgba(245,158,11,0.10)"
            icon={<Sun size={18} color="#F59E0B" weight="regular" />}
            title="Appearance"
            subtitle="Choose your display mode"
            badge={<Text style={s.valueTxt}>Light</Text>}
            last
            onPress={() => Alert.alert('Appearance', 'Theme settings coming soon.')}
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
  scroll: { paddingHorizontal: 18, paddingBottom: 110 },

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
  valueTxt: { fontSize: 12, fontWeight: '600', color: D.muted, marginRight: 6 },

  // Logout
  logoutCard: { marginBottom: 12 },
  logoutRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  logoutTxt: { fontSize: 15, fontWeight: '600', color: '#EF4444', flex: 1 },

  version: { fontSize: 11, color: D.light, textAlign: 'center', marginBottom: 8 },
});
