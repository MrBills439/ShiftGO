import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, TextInput,
  ActivityIndicator, RefreshControl, Alert, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTabBarHeight } from '../../lib/useTabBarHeight';
import {
  MapPin, Clock, CaretRight, CalendarBlank, CheckCircle, Users,
  MagnifyingGlass, X,
} from 'phosphor-react-native';
import { useUpcomingShifts, categorizeShift } from '../../hooks/useShifts';
import { useOpenShifts, useClaimShift } from '../../hooks/useOpenShifts';
import { apiErrorMessage } from '../../services/api';
import { Skeleton } from '../../components/Skeleton';
import { Shift } from '../../types';
import { D } from '../../constants/theme';
import { fmtTime, fmtDur as shiftDur, dateParts, fmtDurLong as fmtHours } from '../../lib/datetime';
import { shiftTypeLabel } from '../../lib/shiftTypes';

type Tab = 'available' | 'upcoming' | 'past';

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Badge status from the shift's real attendance/shift state, not device time.
function cardStatus(shift: Shift): 'active' | 'upcoming' | 'completed' {
  const c = categorizeShift(shift);
  return c === 'past' ? 'completed' : c === 'active' ? 'active' : 'upcoming';
}

function matchesQuery(shift: Shift, q: string): boolean {
  if (!q) return true;
  const hay = `${shift.house?.name ?? ''} ${shift.house?.address ?? ''} ${shiftTypeLabel(shift.shiftType)}`.toLowerCase();
  return hay.includes(q);
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
function Badge({ status }: { status: 'active' | 'upcoming' | 'completed' }) {
  const map = {
    active:    { bg: D.activeBg,    txt: D.activeTxt,    label: 'On shift' },
    upcoming:  { bg: D.confirmedBg, txt: D.confirmedTxt, label: 'Confirmed' },
    completed: { bg: D.completedBg, txt: D.completedTxt, label: 'Completed' },
  };
  const { bg, txt, label } = map[status];
  return (
    <View style={[b.wrap, { backgroundColor: bg }]}>
      {status === 'upcoming' && <View style={[b.dot, { backgroundColor: txt }]} />}
      <Text style={[b.txt, { color: txt }]}>{label}</Text>
    </View>
  );
}
const b = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  txt: { fontSize: 11, fontWeight: '700' },
});

// ─── Scheduled shift card ─────────────────────────────────────────────────────
function ShiftCard({ shift, onPress }: { shift: Shift; onPress: () => void }) {
  const status = cardStatus(shift);
  const { day, num, mon } = dateParts(shift.startTime);
  const isActive = status === 'active';
  const isPast = status === 'completed';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [sc.card, isActive && sc.cardActive, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityLabel={`Shift at ${shift.house?.name}, ${day} ${num} ${mon}`}
    >
      <View style={[sc.dateBlock, isPast && sc.dateBlockOff]}>
        <Text style={[sc.dateDay, isPast && sc.dateFaint]}>{day}</Text>
        <Text style={[sc.dateNum, isPast && sc.dateFaint]}>{num}</Text>
        <Text style={[sc.dateMon, isPast && sc.dateFaint]}>{mon}</Text>
      </View>

      <View style={[sc.divider, isPast && sc.dividerOff]} />

      <View style={sc.content}>
        <Text style={sc.house} numberOfLines={1}>{shift.house?.name}</Text>
        <Text style={sc.role}>{shiftTypeLabel(shift.shiftType)}</Text>

        <View style={sc.timeRow}>
          <Clock size={12} color={isPast ? D.light : D.emerald} weight="regular" />
          <Text style={[sc.time, isPast && sc.timeFaint]}>
            {fmtTime(shift.startTime)} – {fmtTime(shift.endTime)}
            <Text style={sc.dur}> ({shiftDur(shift.startTime, shift.endTime)})</Text>
          </Text>
        </View>

        <View style={sc.addrRow}>
          <MapPin size={11} color={D.light} weight="regular" />
          <Text style={sc.addr} numberOfLines={1}>{shift.house?.address}</Text>
        </View>

        {isPast && (
          <View style={sc.hoursRow}>
            <CheckCircle size={12} color={D.light} weight="fill" />
            <Text style={sc.hoursLabel}>{fmtHours(shift.startTime, shift.endTime)} worked</Text>
          </View>
        )}
      </View>

      <View style={sc.right}>
        <Badge status={status} />
        <CaretRight size={15} color={D.light} weight="bold" style={sc.caret} />
      </View>
    </Pressable>
  );
}

const sc = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: D.white, borderRadius: 18, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: D.border,
    shadowColor: '#0053480d', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 1, shadowRadius: 10, elevation: 2,
  },
  cardActive: { borderColor: D.emerald, borderWidth: 1.5 },
  dateBlock: { width: 44, alignItems: 'center', marginRight: 2 },
  dateBlockOff: { opacity: 0.5 },
  dateDay: { fontSize: 10, fontWeight: '700', color: D.emerald, letterSpacing: 0.5 },
  dateNum: { fontSize: 26, fontWeight: '800', color: D.text, lineHeight: 30, letterSpacing: -0.5 },
  dateMon: { fontSize: 10, fontWeight: '700', color: D.muted, letterSpacing: 0.5 },
  dateFaint: { color: D.light },
  divider: { width: 1, height: 56, backgroundColor: D.border, marginHorizontal: 12 },
  dividerOff: { backgroundColor: '#EEF2F1' },
  content: { flex: 1 },
  house: { fontSize: 15, fontWeight: '700', color: D.text, marginBottom: 1 },
  role: { fontSize: 11.5, color: D.muted, marginBottom: 6 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 },
  time: { fontSize: 12, fontWeight: '600', color: D.emerald },
  timeFaint: { color: D.muted },
  dur: { fontWeight: '500', color: D.light },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addr: { fontSize: 11, color: D.light, flex: 1 },
  hoursRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  hoursLabel: { fontSize: 11, color: D.light, fontWeight: '500' },
  right: { alignItems: 'flex-end', justifyContent: 'space-between', alignSelf: 'stretch', paddingLeft: 6 },
  caret: { marginTop: 'auto' as any },
});

// ─── Open (claimable) shift card ─────────────────────────────────────────────
function OpenShiftCard({ shift, onClaim, claiming }: { shift: Shift; onClaim: () => void; claiming: boolean }) {
  const { day, num, mon } = dateParts(shift.startTime);
  return (
    <View style={osc.card}>
      <View style={osc.topRow}>
        <View style={osc.dateBlock}>
          <Text style={osc.dateDay}>{day}</Text>
          <Text style={osc.dateNum}>{num}</Text>
          <Text style={osc.dateMon}>{mon}</Text>
        </View>
        <View style={osc.divider} />
        <View style={osc.content}>
          <Text style={osc.house} numberOfLines={1}>{shift.house?.name}</Text>
          <Text style={osc.role}>{shiftTypeLabel(shift.shiftType)}</Text>
          <View style={osc.timeRow}>
            <Clock size={12} color={D.emerald} weight="regular" />
            <Text style={osc.time}>
              {fmtTime(shift.startTime)} – {fmtTime(shift.endTime)}
              <Text style={osc.dur}> ({shiftDur(shift.startTime, shift.endTime)})</Text>
            </Text>
          </View>
          <View style={osc.addrRow}>
            <MapPin size={11} color={D.light} weight="regular" />
            <Text style={osc.addr} numberOfLines={1}>{shift.house?.address}</Text>
          </View>
          <View style={osc.claimsRow}>
            <Users size={12} color={D.openTxt} weight="regular" />
            <Text style={osc.claimsTxt}>{shift.claimCount ?? 0} claimed so far</Text>
          </View>
        </View>
      </View>
      <Pressable
        onPress={onClaim}
        disabled={claiming}
        style={({ pressed }) => [osc.claimBtn, pressed && { opacity: 0.85 }, claiming && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel={`Claim shift at ${shift.house?.name}`}
      >
        {claiming
          ? <ActivityIndicator color="#fff" size="small" />
          : <Text style={osc.claimTxt}>Claim shift</Text>}
      </Pressable>
    </View>
  );
}
const osc = StyleSheet.create({
  card: { backgroundColor: D.white, borderRadius: 18, padding: 14, marginBottom: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: D.openBorder },
  topRow: { flexDirection: 'row', alignItems: 'center' },
  dateBlock: { width: 44, alignItems: 'center', marginRight: 2 },
  dateDay: { fontSize: 10, fontWeight: '700', color: D.emerald, letterSpacing: 0.5 },
  dateNum: { fontSize: 26, fontWeight: '800', color: D.text, lineHeight: 30, letterSpacing: -0.5 },
  dateMon: { fontSize: 10, fontWeight: '700', color: D.muted, letterSpacing: 0.5 },
  divider: { width: 1, height: 62, backgroundColor: D.border, marginHorizontal: 12 },
  content: { flex: 1 },
  house: { fontSize: 15, fontWeight: '700', color: D.text, marginBottom: 1 },
  role: { fontSize: 11.5, color: D.muted, marginBottom: 5 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  time: { fontSize: 12, fontWeight: '600', color: D.emerald },
  dur: { fontWeight: '500', color: D.light },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  addr: { fontSize: 11, color: D.light, flex: 1 },
  claimsRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  claimsTxt: { fontSize: 11, fontWeight: '600', color: D.openTxt },
  claimBtn: { marginTop: 12, backgroundColor: D.emerald, borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  claimTxt: { fontSize: 14, fontWeight: '700', color: '#fff' },
});

// ─── Loading skeleton ───────────────────────────────────────────────────────
function ShiftSkeleton() {
  return (
    <View style={sc.card}>
      <View style={sc.dateBlock}>
        <Skeleton width={26} height={10} />
        <Skeleton width={22} height={22} style={{ marginVertical: 3 }} />
        <Skeleton width={24} height={10} />
      </View>
      <View style={sc.divider} />
      <View style={sc.content}>
        <Skeleton width="65%" height={14} />
        <Skeleton width="38%" height={11} style={{ marginTop: 7 }} />
        <Skeleton width="55%" height={11} style={{ marginTop: 8 }} />
        <Skeleton width="60%" height={10} style={{ marginTop: 8 }} />
      </View>
      <View style={sc.right}>
        <Skeleton width={62} height={22} radius={11} />
      </View>
    </View>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────────
function Empty({ tab, searching }: { tab: Tab; searching: boolean }) {
  const copy = searching
    ? { title: 'No matches', sub: 'No shifts match your search. Try a different name or address.' }
    : tab === 'available'
    ? { title: 'No open shifts', sub: 'Open shifts you can pick up will show here.' }
    : tab === 'upcoming'
    ? { title: 'Nothing scheduled', sub: 'You have no upcoming shifts.' }
    : { title: 'No past shifts', sub: 'Completed shifts will appear here.' };
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}>
        <CalendarBlank size={30} color={D.light} weight="thin" />
      </View>
      <Text style={s.emptyTitle}>{copy.title}</Text>
      <Text style={s.emptySub}>{copy.sub}</Text>
    </View>
  );
}

// ─── Screen ─────────────────────────────────────────────────────────────────
export default function ShiftsScreen() {
  const router = useRouter();
  const tabBarHeight = useTabBarHeight();
  const [tab, setTab] = useState<Tab>('available');
  const [query, setQuery] = useState('');

  const { active, upcoming, past, isLoading: schedLoading, refetch: refetchSched } = useUpcomingShifts();
  const { data: openShifts = [], isLoading: openLoading, refetch: refetchOpen } = useOpenShifts();
  const claimShift = useClaimShift();
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function handleClaim(shift: Shift) {
    setClaimingId(shift.id);
    try {
      await claimShift.mutateAsync(shift.id);
      refetchOpen();
      refetchSched();
      Alert.alert('Shift claimed', `You're now on the schedule for ${shift.house?.name}.`);
    } catch (err: any) {
      if (err?.response?.status === 409) Alert.alert('Too late', 'Another worker claimed this shift.');
      else if (err?.response?.status === 403) Alert.alert('Not eligible', "You're not eligible to claim this shift.");
      else Alert.alert('Something went wrong', apiErrorMessage(err, 'Could not claim this shift. Please try again.'));
    } finally {
      setClaimingId(null);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([refetchOpen(), refetchSched()]);
    setRefreshing(false);
  }

  const sortedUpcoming = useMemo(
    () => [...upcoming].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
    [upcoming]
  );
  const sortedPast = useMemo(
    () => [...past].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()),
    [past]
  );

  const counts = { available: openShifts.length, upcoming: upcoming.length, past: past.length };
  const TABS: { key: Tab; label: string }[] = [
    { key: 'available', label: 'Available' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'past', label: 'Past' },
  ];

  const q = query.trim().toLowerCase();
  const source = tab === 'available' ? openShifts : tab === 'upcoming' ? sortedUpcoming : sortedPast;
  const data = useMemo(() => source.filter((sh) => matchesQuery(sh, q)), [source, q]);

  const loading =
    (tab === 'available' && openLoading && openShifts.length === 0) ||
    (tab !== 'available' && schedLoading && upcoming.length === 0 && past.length === 0);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>Shifts</Text>
        <Text style={s.subtitle}>Your available, upcoming and past shifts</Text>
      </View>

      {/* Active shift is managed on the Clock tab — surfaced here, never duplicated as a card. */}
      {active && (
        <Pressable
          onPress={() => router.push('/(tabs)/clock')}
          style={({ pressed }) => [s.activeBanner, pressed && { opacity: 0.9 }]}
          accessibilityRole="button"
          accessibilityLabel={`You are on shift at ${active.house?.name}. Open the Clock tab.`}
        >
          <View style={s.activeDot} />
          <Text style={s.activeTxt} numberOfLines={1}>
            On shift at {active.house?.name} · manage on Clock
          </Text>
          <CaretRight size={15} color={D.white} weight="bold" />
        </Pressable>
      )}

      {/* Search */}
      <View style={s.searchBar}>
        <MagnifyingGlass size={17} color={D.light} weight="regular" />
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search by home or address"
          placeholderTextColor={D.light}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={Keyboard.dismiss}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
            <X size={16} color={D.muted} weight="bold" />
          </Pressable>
        )}
      </View>

      {/* Tabs */}
      <View style={s.tabWrap}>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[s.tab, on && s.tabActive]}>
              <Text style={[s.tabTxt, on && s.tabTxtActive]}>{t.label}</Text>
              {counts[t.key] > 0 && (
                <View style={[s.tabCount, on && s.tabCountActive]}>
                  <Text style={[s.tabCountTxt, on && s.tabCountTxtActive]}>{counts[t.key]}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={s.skeletonWrap}>
          {[0, 1, 2, 3, 4].map((i) => <ShiftSkeleton key={i} />)}
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[s.listContent, { paddingBottom: tabBarHeight + 24 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={D.emerald} />}
          ListEmptyComponent={<Empty tab={tab} searching={q.length > 0} />}
          renderItem={({ item }) =>
            tab === 'available' ? (
              <OpenShiftCard
                shift={item}
                claiming={claimingId === item.id}
                onClaim={() => handleClaim(item)}
              />
            ) : (
              <ShiftCard shift={item} onPress={() => router.push(`/shift/${item.id}`)} />
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: D.bg },

  header: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 14 },
  title: { fontSize: 26, fontWeight: '800', color: D.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: D.muted, marginTop: 3 },

  activeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 18, marginBottom: 12,
    backgroundColor: D.emerald, borderRadius: 13, paddingHorizontal: 14, paddingVertical: 11,
  },
  activeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: D.mint },
  activeTxt: { flex: 1, fontSize: 13, fontWeight: '700', color: D.white },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 18, marginBottom: 12,
    backgroundColor: D.white, borderRadius: 13, borderWidth: 1, borderColor: D.border,
    paddingHorizontal: 12, height: 44,
  },
  searchInput: { flex: 1, fontSize: 14, color: D.text, paddingVertical: 0 },

  tabWrap: {
    flexDirection: 'row', marginHorizontal: 18, marginBottom: 12,
    backgroundColor: D.white, borderRadius: 13, padding: 4, borderWidth: 1, borderColor: D.border, gap: 4,
  },
  tab: {
    flex: 1, flexDirection: 'row', gap: 5, paddingVertical: 9, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  tabActive: { backgroundColor: D.emerald },
  tabTxt: { fontSize: 13, fontWeight: '700', color: D.muted },
  tabTxtActive: { color: D.white },
  tabCount: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: '#EEF2F1', alignItems: 'center', justifyContent: 'center' },
  tabCountActive: { backgroundColor: 'rgba(255,255,255,0.22)' },
  tabCountTxt: { fontSize: 10, fontWeight: '800', color: D.muted },
  tabCountTxtActive: { color: D.white },

  listContent: { paddingHorizontal: 18, paddingTop: 4, flexGrow: 1 },
  skeletonWrap: { paddingHorizontal: 18, paddingTop: 4 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  emptyIcon: { width: 68, height: 68, borderRadius: 22, backgroundColor: D.white, alignItems: 'center', justifyContent: 'center', marginBottom: 14, borderWidth: 1, borderColor: D.border },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: D.text, marginBottom: 6 },
  emptySub: { fontSize: 13.5, color: D.muted, textAlign: 'center', lineHeight: 20 },
});
