import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, ActivityIndicator, ScrollView, Alert, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  Bell, CalendarBlank, MapPin, CheckCircle,
  NavigationArrow, ShieldCheck, ArrowsClockwise, Cpu,
} from 'phosphor-react-native';
import { useUpcomingShifts } from '../../hooks/useShifts';
import { RightToWorkBanner } from '../../components/RightToWorkBanner';
import { getUnreadCount } from '../../services/notificationsService';
import { useClockStatus } from '../../hooks/useClockStatus';
import { useAuthStore } from '../../store/authStore';
import { getMe } from '../../services/profileService';
import { API_BASE_URL } from '../../services/api';
import { Shift } from '../../types';
import { D } from '../../constants/theme';
import { fmtTime as fmt, relativeDayLabel as fmtDate, getGreeting } from '../../lib/datetime';
import { shiftTypeLabel } from '../../lib/shiftTypes';
import { useTabBarHeight } from '../../lib/useTabBarHeight';
import * as Haptics from 'expo-haptics';

// ─── Tokens ───────────────────────────────────────────────────────────────────

// ─── Helpers ──────────────────────────────────────────────────────────────────
const countdown = (iso: string) => {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Now';
  const h = Math.floor(diff / 3_600_000), m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const dur = (s: Shift) => `${Math.round((new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3_600_000)}h`;
const prog = (s: Shift) => {
  const start = new Date(s.startTime).getTime(), end = new Date(s.endTime).getTime(), now = Date.now();
  const pct = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
  const fms = (ms: number) => { const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000); return h > 0 ? `${h}h ${m}m` : `${m}m`; };
  const done = Math.max(0, Math.min(now - start, end - start));
  return { pct, elapsed: fms(done), remaining: fms(Math.max(0, (end - start) - done)) };
};
const getActive = (shifts: Shift[]) => { const now = new Date(); return shifts.find(s => new Date(s.startTime) <= now && new Date(s.endTime) >= now) ?? null; };
const getNext = (shifts: Shift[], active: Shift | null) => shifts.find(s => new Date(s.startTime) > new Date() && s.id !== active?.id) ?? null;
const gpsConfidenceLabel = (accuracy?: number | null) => {
  if (accuracy == null || accuracy > 100) return 'GPS unreliable';
  if (accuracy > 50) return 'Weak GPS';
  return 'Good GPS';
};
const requiresManualGpsConfirmation = (accuracy?: number | null) => accuracy != null && accuracy > 50 && accuracy <= 100;

// ─── Status Pill ──────────────────────────────────────────────────────────────
function Pill({ icon, label, on = true }: { icon: React.ReactNode; label: string; on?: boolean }) {
  return (
    <View style={[p.wrap, !on && p.off]}>
      {icon}
      <Text style={[p.txt, !on && p.txtOff]}>{label}</Text>
      {on && <View style={p.dot} />}
    </View>
  );
}
const p = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: D.mintBg, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: D.mintBorder },
  off: { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.12)' },
  txt: { fontSize: 10, fontWeight: '600', color: D.mint, letterSpacing: 0.2 },
  txtOff: { color: 'rgba(255,255,255,0.45)' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: D.mint, marginLeft: 1 },
});

// ─── Glow Clock Button ────────────────────────────────────────────────────────
function ClockBtn({ isClockedIn, isLoading, onPress }: { isClockedIn: boolean; isLoading: boolean; onPress: () => void }) {
  const r1 = useRef(new Animated.Value(0)).current;
  const r2 = useRef(new Animated.Value(0)).current;
  const color = isClockedIn ? D.amber : D.emerald;

  useEffect(() => {
    const make = (a: Animated.Value, delay: number) =>
      Animated.loop(Animated.sequence([
        Animated.delay(delay),
        Animated.timing(a, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(a, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ]));
    const a1 = make(r1, 0), a2 = make(r2, 600);
    a1.start(); a2.start();
    return () => { a1.stop(); a2.stop(); };
  }, [isClockedIn]);

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={isLoading}
      accessibilityRole="button"
      accessibilityLabel={isClockedIn ? 'Clock out of your shift' : 'Clock in to your shift'}
      style={({ pressed }) => [cb.wrap, pressed && { transform: [{ scale: 0.95 }] }]}
    >
      <Animated.View style={[cb.r1, { borderColor: color, opacity: r1.interpolate({ inputRange: [0,1], outputRange: [0.07,0.22] }) }]} />
      <Animated.View style={[cb.r2, { borderColor: color, opacity: r2.interpolate({ inputRange: [0,1], outputRange: [0.11,0.28] }) }]} />
      <View style={[cb.btn, { backgroundColor: color, shadowColor: color }]}>
        {isLoading
          ? <ActivityIndicator color="#fff" size="large" />
          : <>
              <Text style={cb.sub}>{isClockedIn ? 'Currently' : 'Ready to'}</Text>
              <Text style={cb.main}>{isClockedIn ? 'Clock Out' : 'Clock In'}</Text>
              <Text style={cb.hint}>{isClockedIn ? 'Tap to clock out' : 'Tap to clock in'}</Text>
            </>}
      </View>
    </Pressable>
  );
}
const cb = StyleSheet.create({
  wrap: { width: 196, height: 196, alignItems: 'center', justifyContent: 'center' },
  r1: { position: 'absolute', width: 196, height: 196, borderRadius: 98, borderWidth: 1.5 },
  r2: { position: 'absolute', width: 168, height: 168, borderRadius: 84, borderWidth: 1.5 },
  btn: { width: 140, height: 140, borderRadius: 70, alignItems: 'center', justifyContent: 'center', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.38, shadowRadius: 24, elevation: 12 },
  sub: { fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: '500', marginBottom: 2 },
  main: { fontSize: 20, color: '#fff', fontWeight: '700', letterSpacing: -0.3 },
  hint: { fontSize: 10, color: 'rgba(255,255,255,0.55)', fontWeight: '500', marginTop: 3 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ClockScreen() {
  const { active, upcoming, isLoading: shiftsLoading } = useUpcomingShifts();
  const user = useAuthStore(s => s.user);
  const router = useRouter();
  const tabBarHeight = useTabBarHeight();
  // A shift the worker has clocked into (`active`) wins; otherwise the shift
  // whose time window is open right now (the one they can clock into).
  const activeShift = active ?? getActive(upcoming);
  const nextShift = getNext(upcoming, activeShift);
  const {
    isClockedIn,
    isLoading: statusLoading,
    isActing,
    error,
    syncMessage,
    queueSummary,
    prompt,
    confirmStillWorking,
    dismissPrompt,
    clockIn,
    clockOut,
    retrySync,
  } = useClockStatus(activeShift);
  const [gps, setGps] = useState<boolean | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [, tick] = useState(0);
  const { data: unreadCount = 0 } = useQuery<number>({
    queryKey: ['notif-count'],
    queryFn: getUnreadCount,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  // Same authoritative current-user record the profile screens use. Reading the
  // shared ['me'] cache here means an avatar upload / removal / profile edit
  // (which update this cache) is reflected in the header with no restart.
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: getMe, staleTime: 30_000 });

  useEffect(() => { const id = setInterval(() => tick(t => t + 1), 30_000); return () => clearInterval(id); }, []);

  // Foreground GPS readout only. Background attendance monitoring is started by
  // useClockStatus AFTER a successful clock-in and stopped on clock-out — it is
  // never started here just because the screen mounted.
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        setGps(status === 'granted');
        if (status === 'granted') {
          try {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            setGpsAccuracy(loc.coords.accuracy ?? null);
          } catch {
            setGpsAccuracy(null);
          }
        }
      } catch { setGps(false); }
    })();
  }, []);

  // Server-driven prompts: "you've left the service" / "your shift has ended".
  useEffect(() => {
    if (!prompt || !activeShift) return;
    const ended = prompt !== 'LEFT_GEOFENCE_STILL_WORKING';
    Alert.alert(
      ended ? 'Your scheduled shift has ended' : "You've left the service",
      ended
        ? `Your shift at ${activeShift.house.name} was due to finish. Are you still working?`
        : `You seem to have left ${activeShift.house.name}. Are you still working?`,
      [
        { text: 'End shift', style: 'destructive', onPress: () => { dismissPrompt(); clockOut(); } },
        { text: "Yes, still working", onPress: confirmStillWorking },
      ],
    );
  }, [prompt, activeShift?.id]);

  const currentUser = me ?? user;
  const firstName = currentUser?.name?.split(' ')[0] ?? 'there';
  const avatarUri = currentUser?.profilePicture ? `${API_BASE_URL}${currentUser.profilePicture}` : null;
  const p2 = activeShift ? prog(activeShift) : null;
  const isLoading = shiftsLoading || statusLoading;

  // Clock-in goes straight through. Clock-out after the scheduled end time asks
  // for confirmation first — otherwise it clocks out immediately.
  const handleClockPress = () => {
    if (!activeShift) return;
    if (!isClockedIn) { clockIn(); return; }
    const shiftEnded = Date.now() > new Date(activeShift.endTime).getTime();
    if (shiftEnded) {
      Alert.alert(
        'Shift has ended',
        `Your shift at ${activeShift.house.name} was scheduled to finish at ${fmt(activeShift.endTime)}. Do you want to clock out now?`,
        [
          { text: 'Not yet', style: 'cancel' },
          { text: 'Clock Out', style: 'destructive', onPress: clockOut },
        ],
      );
      return;
    }
    clockOut();
  };

  if (isLoading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}><ActivityIndicator size="large" color={D.emerald} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: tabBarHeight + 24 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Header ── */}
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.greet}>{getGreeting()}, {firstName} 👋</Text>
            <Text style={s.greetSub}>{activeShift ? `Shift at ${activeShift.house.name}` : 'No shift scheduled today'}</Text>
          </View>
          <View style={s.headerRight}>
            <Pressable
              style={s.iconBtn}
              onPress={() => router.push('/notifications')}
              accessibilityRole="button"
              accessibilityLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
            >
              <Bell size={18} color={D.muted} weight="regular" />
              {unreadCount > 0 && (
                <View style={s.bellBadge}>
                  <Text style={s.bellBadgeTxt}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                </View>
              )}
            </Pressable>
            {avatarUri
              ? <Image source={{ uri: avatarUri }} style={s.avatarImg} />
              : <View style={s.avatar}><Text style={s.avatarTxt}>{firstName[0]?.toUpperCase() ?? 'U'}</Text></View>}
          </View>
        </View>

        <RightToWorkBanner />

        {/* ── Next Shift Slim Card ── */}
        {nextShift && (
          <View style={s.nextCard}>
            <View style={s.nextIcon}><CalendarBlank size={14} color={D.emerald} weight="bold" /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.nextLabel}>NEXT SHIFT</Text>
              <Text style={s.nextDetail} numberOfLines={1}>
                {fmtDate(nextShift.startTime)}, {fmt(nextShift.startTime)}–{fmt(nextShift.endTime)} · {nextShift.house.name}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.cdLabel}>Starts in</Text>
              <Text style={s.cdValue}>{countdown(nextShift.startTime)}</Text>
            </View>
          </View>
        )}

        {/* ── Hero Card — flex grows to fill remaining space ── */}
        {activeShift ? (
          <LinearGradient colors={[D.eDark, D.eMid, D.eLight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
            <View style={[s.deco, { width: 200, height: 200, top: -70, right: -50 }]} />
            <View style={[s.deco, { width: 120, height: 120, bottom: -40, left: -20 }]} />

            <View style={s.badge}>
              <View style={s.badgeDot} />
              <Text style={s.badgeTxt}>{isClockedIn ? 'Clocked In' : 'Scheduled'}</Text>
            </View>

            <Text style={s.heroLabel}>TODAY'S SHIFT</Text>
            <Text style={s.heroHouse}>{activeShift.house.name}</Text>
            <Text style={s.heroType}>{shiftTypeLabel(activeShift.shiftType)}</Text>

            <View style={s.heroTimeRow}>
              <Text style={s.heroTime}>{fmt(activeShift.startTime)} – {fmt(activeShift.endTime)}</Text>
              <View style={s.durPill}><Text style={s.durTxt}>{dur(activeShift)} shift</Text></View>
            </View>

            <View style={s.heroAddr}>
              <MapPin size={11} color="rgba(255,255,255,0.55)" weight="fill" />
              <Text style={s.heroAddrTxt} numberOfLines={1}>{activeShift.house.address}</Text>
            </View>

            {/* Pills */}
            <View style={s.pills}>
              <Pill icon={<CheckCircle size={10} color={gps && gpsAccuracy != null && gpsAccuracy <= 50 ? D.mint : 'rgba(255,255,255,0.4)'} weight="fill" />} label={gps ? gpsConfidenceLabel(gpsAccuracy) : 'GPS unreliable'} on={gps === true && gpsAccuracy != null && gpsAccuracy <= 50} />
              <Pill icon={<Cpu size={10} color={requiresManualGpsConfirmation(gpsAccuracy) ? D.amber : D.mint} weight="bold" />} label={requiresManualGpsConfirmation(gpsAccuracy) ? 'Manual confirmation required' : 'Auto Clock-In'} on={!requiresManualGpsConfirmation(gpsAccuracy)} />
            </View>
          </LinearGradient>
        ) : (
          <View style={[s.hero, s.noShift]}>
            <Text style={s.noShiftTitle}>No Active Shift</Text>
            <Text style={s.noShiftSub}>Check the Shifts tab for your upcoming schedule.</Text>
          </View>
        )}

        {/* ── Shift Progress (separate card) ── */}
        {activeShift && p2 && (
          <View style={s.progCard}>
            <View style={s.progTop}>
              <Text style={s.progLabel}>SHIFT PROGRESS</Text>
              <Text style={s.progTimes}>{p2.elapsed} done · <Text style={s.progRemain}>{p2.remaining} left</Text></Text>
            </View>
            <View style={s.progTrack}>
              <View style={[s.progFill, { width: `${p2.pct.toFixed(1)}%` as any }]} />
            </View>
          </View>
        )}

        {/* ── Clock Button ── */}
        <View style={s.clockArea}>
          <ClockBtn isClockedIn={isClockedIn} isLoading={isActing} onPress={handleClockPress} />
          {error && (
            <Text style={s.errTxt}>
              {error.message}
              {error.code === 'OUTSIDE_GEOFENCE' && error.distanceMeters != null
                ? `\nYou're about ${Math.round(error.distanceMeters)} m away (allowed: ${error.geofenceRadius ?? '?'} m).`
                : ''}
            </Text>
          )}
          {syncMessage && (
            <View style={s.syncRow}>
              <Text style={[
                s.syncTxt,
                queueSummary.failedCount > 0 && s.syncFailed,
                queueSummary.pendingCount > 0 && s.syncPending,
              ]}>
                {syncMessage}
              </Text>
              {(queueSummary.pendingCount > 0 || queueSummary.failedCount > 0) && (
                <Pressable onPress={retrySync} style={s.retryBtn}>
                  <Text style={s.retryTxt}>Retry sync</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>

        {/* ── Status Strip ── */}
        {activeShift && (
          <View style={s.strip}>
            <View style={s.si}>
              <View style={s.siIcon}><NavigationArrow size={12} color={gps === true ? D.emerald : D.error} weight="fill" /></View>
              <View><Text style={s.siV}>GPS Status</Text><Text style={s.siS}>{gps === true ? 'GPS enabled' : 'GPS unavailable'}</Text></View>
            </View>
            <View style={s.sl} />
            <View style={s.si}>
              <View style={s.siIcon}><ShieldCheck size={12} color={gpsAccuracy != null && gpsAccuracy <= 100 ? D.emerald : D.error} weight="fill" /></View>
              <View><Text style={s.siV}>Accuracy</Text><Text style={s.siS}>{gpsAccuracy != null ? `${Math.round(gpsAccuracy)}m` : 'Unknown'}</Text></View>
            </View>
            <View style={s.sl} />
            <View style={s.si}>
              <View style={s.siIcon}><ArrowsClockwise size={12} color={requiresManualGpsConfirmation(gpsAccuracy) ? D.amber : D.emerald} weight="bold" /></View>
              <View><Text style={s.siV}>Clock-In</Text><Text style={s.siS}>{requiresManualGpsConfirmation(gpsAccuracy) ? 'Manual needed' : 'Auto ready'}</Text></View>
            </View>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: D.bg },
  scroll: { paddingHorizontal: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: { flexDirection: 'row', alignItems: 'center', paddingTop: 10, paddingBottom: 10 },
  greet: { fontSize: 20, fontWeight: '700', color: D.text, letterSpacing: -0.3 },
  greetSub: { fontSize: 12, color: D.muted, marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 36, height: 36, borderRadius: 11, backgroundColor: D.white, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: D.border },
  bellBadge: { position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, borderWidth: 1.5, borderColor: D.white },
  bellBadgeTxt: { fontSize: 9, fontWeight: '700', color: '#fff' },
  avatar: { width: 36, height: 36, borderRadius: 11, backgroundColor: D.emerald, alignItems: 'center', justifyContent: 'center' },
  avatarImg: { width: 36, height: 36, borderRadius: 11 },
  avatarTxt: { fontSize: 14, fontWeight: '700', color: '#fff' },

  nextCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: D.white, borderRadius: 14, padding: 11, marginBottom: 10, borderWidth: 1, borderColor: D.border },
  nextIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: 'rgba(0,95,86,0.08)', alignItems: 'center', justifyContent: 'center' },
  nextLabel: { fontSize: 9, fontWeight: '700', color: D.emerald, letterSpacing: 0.8, marginBottom: 2 },
  nextDetail: { fontSize: 12, color: D.text, fontWeight: '500' },
  cdLabel: { fontSize: 10, color: D.light },
  cdValue: { fontSize: 13, color: D.emerald, fontWeight: '700' },

  hero: { borderRadius: 22, padding: 18, marginBottom: 10, overflow: 'hidden' },
  deco: { position: 'absolute', borderRadius: 9999, backgroundColor: 'rgba(255,255,255,0.04)' },

  noShift: { backgroundColor: D.white, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: D.border },
  noShiftTitle: { fontSize: 17, fontWeight: '700', color: D.text, marginBottom: 6 },
  noShiftSub: { fontSize: 13, color: D.muted, textAlign: 'center', lineHeight: 19 },

  badge: { position: 'absolute', top: 14, right: 14, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  badgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: D.mint },
  badgeTxt: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },

  heroLabel: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.5)', letterSpacing: 1.2, marginBottom: 6 },
  heroHouse: { fontSize: 22, fontWeight: '700', color: '#fff', letterSpacing: -0.3, marginBottom: 2 },
  heroType: { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 10 },
  heroTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  heroTime: { fontSize: 17, fontWeight: '700', color: '#fff' },
  durPill: { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3 },
  durTxt: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },
  heroAddr: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 },
  heroAddrTxt: { fontSize: 11, color: 'rgba(255,255,255,0.55)', flex: 1 },
  pills: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },

  progCard: { backgroundColor: D.white, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 4, borderWidth: 1, borderColor: D.border },
  progTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  progLabel: { fontSize: 9, fontWeight: '700', color: D.light, letterSpacing: 1.1 },
  progTimes: { fontSize: 11, fontWeight: '600', color: D.emerald },
  progRemain: { color: D.muted, fontWeight: '500' },
  progTrack: { height: 5, backgroundColor: '#EDF1F0', borderRadius: 999, overflow: 'hidden' },
  progFill: { height: '100%', borderRadius: 999, backgroundColor: D.emerald },

  clockArea: { alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
  errTxt: { fontSize: 12, color: D.error, marginTop: 8, textAlign: 'center' },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  syncTxt: { fontSize: 12, color: D.emerald, fontWeight: '700' },
  syncPending: { color: D.amber },
  syncFailed: { color: D.error },
  retryBtn: { borderWidth: 1, borderColor: D.border, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: D.white },
  retryTxt: { fontSize: 11, color: D.emerald, fontWeight: '700' },

  strip: { flexDirection: 'row', alignItems: 'center', backgroundColor: D.white, borderRadius: 18, padding: 12, borderWidth: 1, borderColor: D.border },
  si: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
  siIcon: { width: 26, height: 26, borderRadius: 7, backgroundColor: 'rgba(0,95,86,0.08)', alignItems: 'center', justifyContent: 'center' },
  siV: { fontSize: 11, fontWeight: '700', color: D.text },
  siS: { fontSize: 10, color: D.light, marginTop: 1 },
  sl: { width: 1, height: 28, backgroundColor: D.border, marginHorizontal: 4 },
});
