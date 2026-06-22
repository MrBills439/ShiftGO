import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MapPin, Clock, CaretRight, CalendarBlank, Funnel, CheckCircle } from 'phosphor-react-native';
import { useUpcomingShifts } from '../../hooks/useShifts';
import { Shift } from '../../types';

// ─── Tokens ───────────────────────────────────────────────────────────────────
const D = {
  bg: '#F4F6F5',
  emerald: '#005F56',
  white: '#FFFFFF',
  text: '#0D1514',
  muted: '#607370',
  light: '#96AEAB',
  border: '#E2EDEB',
  confirmedBg: 'rgba(22,163,74,0.11)',
  confirmedTxt: '#16A34A',
  activeBg: 'rgba(0,95,86,0.11)',
  activeTxt: '#005F56',
  completedBg: 'rgba(96,115,112,0.11)',
  completedTxt: '#607370',
};

type Filter = 'upcoming' | 'past' | 'all';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function shiftDur(start: string, end: string) {
  const h = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 3_600_000);
  return `${h}h`;
}

function getStatus(shift: Shift): 'active' | 'upcoming' | 'completed' {
  const now = new Date();
  const start = new Date(shift.startTime);
  const end = new Date(shift.endTime);
  if (now >= start && now <= end) return 'active';
  if (now < start) return 'upcoming';
  return 'completed';
}

function dateParts(iso: string) {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase(),
    num: d.getDate(),
    mon: d.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase(),
  };
}

function fmtHours(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return m > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h 00m`;
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
function Badge({ status }: { status: 'active' | 'upcoming' | 'completed' }) {
  const map = {
    active:    { bg: D.activeBg,    txt: D.activeTxt,    label: 'Active' },
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

// ─── Shift Card ───────────────────────────────────────────────────────────────
function ShiftCard({ shift, onPress }: { shift: Shift; onPress: () => void }) {
  const status = getStatus(shift);
  const { day, num, mon } = dateParts(shift.startTime);
  const isActive = status === 'active';
  const isPast = status === 'completed';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [sc.card, isActive && sc.cardActive, pressed && { opacity: 0.85 }]}
    >
      {/* Date Block */}
      <View style={[sc.dateBlock, isPast && sc.dateBlockOff]}>
        <Text style={[sc.dateDay, isPast && sc.dateFaint]}>{day}</Text>
        <Text style={[sc.dateNum, isPast && sc.dateFaint]}>{num}</Text>
        <Text style={[sc.dateMon, isPast && sc.dateFaint]}>{mon}</Text>
      </View>

      {/* Divider */}
      <View style={[sc.divider, isPast && sc.dividerOff]} />

      {/* Content */}
      <View style={sc.content}>
        <Text style={sc.house}>{shift.house.name}</Text>
        <Text style={sc.role}>Care Support Shift</Text>

        <View style={sc.timeRow}>
          <Clock size={12} color={isPast ? D.light : D.emerald} weight="regular" />
          <Text style={[sc.time, isPast && sc.timeFaint]}>
            {fmtTime(shift.startTime)} – {fmtTime(shift.endTime)}
            <Text style={sc.dur}> ({shiftDur(shift.startTime, shift.endTime)})</Text>
          </Text>
        </View>

        <View style={sc.addrRow}>
          <MapPin size={11} color={D.light} weight="regular" />
          <Text style={sc.addr} numberOfLines={1}>{shift.house.address}</Text>
        </View>

        {isPast && (
          <View style={sc.hoursRow}>
            <CheckCircle size={12} color={D.light} weight="fill" />
            <Text style={sc.hoursLabel}>{fmtHours(shift.startTime, shift.endTime)} worked</Text>
          </View>
        )}
      </View>

      {/* Right */}
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
    backgroundColor: D.white, borderRadius: 20, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: D.border,
    shadowColor: '#00534810', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 16, elevation: 3,
  },
  cardActive: { borderColor: D.emerald, borderWidth: 1.5 },

  dateBlock: { width: 48, alignItems: 'center', marginRight: 4 },
  dateBlockOff: { opacity: 0.55 },
  dateDay: { fontSize: 10, fontWeight: '700', color: D.emerald, letterSpacing: 0.6 },
  dateNum: { fontSize: 28, fontWeight: '800', color: D.text, lineHeight: 32, letterSpacing: -0.5 },
  dateMon: { fontSize: 10, fontWeight: '700', color: D.muted, letterSpacing: 0.6 },
  dateFaint: { color: D.light },

  divider: { width: 1, height: 60, backgroundColor: D.border, marginHorizontal: 14 },
  dividerOff: { backgroundColor: '#EEF2F1' },

  content: { flex: 1 },
  house: { fontSize: 15, fontWeight: '700', color: D.text, marginBottom: 2 },
  role: { fontSize: 12, color: D.muted, marginBottom: 7 },

  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  time: { fontSize: 12, fontWeight: '600', color: D.emerald },
  timeFaint: { color: D.muted },
  dur: { fontWeight: '500', color: D.light },

  addrRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addr: { fontSize: 11, color: D.light, flex: 1 },

  hoursRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  hoursLabel: { fontSize: 11, color: D.light, fontWeight: '500' },

  right: { alignItems: 'flex-end', justifyContent: 'space-between', alignSelf: 'stretch', paddingLeft: 8 },
  caret: { marginTop: 'auto' as any },
});

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ShiftsScreen() {
  const [filter, setFilter] = useState<Filter>('upcoming');
  const { upcoming, past, isLoading, refetch } = useUpcomingShifts();
  const router = useRouter();

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'upcoming', label: `Upcoming` },
    { key: 'past',     label: `Past` },
    { key: 'all',      label: 'All' },
  ];

  const allShifts = [...upcoming, ...past].sort(
    (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
  );

  const displayUpcoming = filter === 'upcoming' || filter === 'all' ? upcoming : [];
  const displayPast     = filter === 'past'     || filter === 'all' ? past     : [];

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={D.emerald} />}
      >

        {/* ── Header ── */}
        <View style={s.header}>
          <View>
            <Text style={s.title}>Shifts</Text>
            <Text style={s.subtitle}>View your upcoming and past shifts</Text>
          </View>
          <Pressable style={s.filterBtn}>
            <Funnel size={18} color={D.muted} weight="regular" />
          </Pressable>
        </View>

        {/* ── Filter Tabs ── */}
        <View style={s.tabWrap}>
          {FILTERS.map(f => (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[s.tab, filter === f.key && s.tabActive]}
            >
              <Text style={[s.tabTxt, filter === f.key && s.tabTxtActive]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>

        {isLoading ? (
          <View style={s.loadWrap}><ActivityIndicator size="large" color={D.emerald} /></View>
        ) : (
          <>
            {/* ── Upcoming Shifts ── */}
            {displayUpcoming.length > 0 && (
              <>
                <Text style={s.sectionTitle}>Upcoming Shifts</Text>
                {displayUpcoming.map(shift => <ShiftCard key={shift.id} shift={shift} onPress={() => router.push(`/shift/${shift.id}` as any)} />)}

                {/* View Full Rota */}
                <Pressable
                  style={({ pressed }) => [s.rotaBtn, pressed && { opacity: 0.75 }]}
                  onPress={() => Alert.alert('Full Rota', 'Rota view coming soon.')}
                >
                  <View style={s.rotaIcon}><CalendarBlank size={18} color={D.emerald} weight="regular" /></View>
                  <Text style={s.rotaTxt}>View Full Rota</Text>
                  <CaretRight size={16} color={D.light} weight="bold" />
                </Pressable>
              </>
            )}

            {/* ── Past Shifts ── */}
            {displayPast.length > 0 && (
              <>
                <Text style={[s.sectionTitle, displayUpcoming.length > 0 && { marginTop: 24 }]}>
                  {filter === 'all' ? 'Recent Past Shifts' : 'Past Shifts'}
                </Text>
                {displayPast.map(shift => <ShiftCard key={shift.id} shift={shift} onPress={() => router.push(`/shift/${shift.id}` as any)} />)}
              </>
            )}

            {/* ── Empty ── */}
            {displayUpcoming.length === 0 && displayPast.length === 0 && (
              <View style={s.empty}>
                <View style={s.emptyIcon}>
                  <CalendarBlank size={32} color={D.light} weight="thin" />
                </View>
                <Text style={s.emptyTitle}>No shifts found</Text>
                <Text style={s.emptySub}>
                  {filter === 'upcoming'
                    ? 'You have no upcoming shifts scheduled.'
                    : filter === 'past'
                    ? 'No past shifts to display.'
                    : 'No shifts found.'}
                </Text>
              </View>
            )}
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: D.bg },
  scroll: { paddingHorizontal: 18, paddingBottom: 110 },
  loadWrap: { paddingTop: 80, alignItems: 'center' },

  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingTop: 12, marginBottom: 16 },
  title: { fontSize: 26, fontWeight: '700', color: D.text, letterSpacing: -0.4 },
  subtitle: { fontSize: 13, color: D.muted, marginTop: 3 },
  filterBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: D.white, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: D.border, marginTop: 4 },

  // Filter tabs — active uses solid emerald pill + white text
  tabWrap: { flexDirection: 'row', backgroundColor: D.white, borderRadius: 14, padding: 4, marginBottom: 20, borderWidth: 1, borderColor: D.border, gap: 4 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: D.emerald },
  tabTxt: { fontSize: 13, fontWeight: '600', color: D.muted },
  tabTxtActive: { color: D.white },

  sectionTitle: { fontSize: 13, fontWeight: '700', color: D.muted, letterSpacing: 0.4, marginBottom: 12, textTransform: 'uppercase' },

  // Rota button
  rotaBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.white, borderRadius: 18, padding: 16, marginTop: 4, borderWidth: 1, borderColor: D.border, shadowColor: '#00534810', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 10, elevation: 2 },
  rotaIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(0,95,86,0.09)', alignItems: 'center', justifyContent: 'center' },
  rotaTxt: { flex: 1, fontSize: 14, fontWeight: '600', color: D.text },

  // Empty state
  empty: { alignItems: 'center', paddingTop: 60, paddingBottom: 40 },
  emptyIcon: { width: 72, height: 72, borderRadius: 24, backgroundColor: D.white, alignItems: 'center', justifyContent: 'center', marginBottom: 16, borderWidth: 1, borderColor: D.border },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: D.text, marginBottom: 8 },
  emptySub: { fontSize: 14, color: D.muted, textAlign: 'center', lineHeight: 21, paddingHorizontal: 24 },
});
