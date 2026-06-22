import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Funnel, ClockCountdown, CalendarBlank, CalendarCheck,
  CaretRight, Archive, CheckCircle,
} from 'phosphor-react-native';
import { useTimesheets } from '../../hooks/useTimesheets';
import { Timesheet } from '../../types';

// ─── Tokens ───────────────────────────────────────────────────────────────────
const D = {
  bg: '#F4F6F5',
  emerald: '#005F56',
  eDark: '#002E28',
  eMid: '#004A42',
  eLight: '#0A7060',
  mint: '#52D6B5',
  mintBg: 'rgba(82,214,181,0.14)',
  mintBorder: 'rgba(82,214,181,0.28)',
  white: '#FFFFFF',
  text: '#0D1514',
  muted: '#607370',
  light: '#96AEAB',
  border: '#E2EDEB',
  activeTabBg: 'rgba(0,95,86,0.10)',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getWeekStart(ref = new Date()): Date {
  const d = new Date(ref);
  const day = d.getDay(); // 0=Sun, 1=Mon…
  d.setDate(d.getDate() - ((day + 6) % 7)); // shift to Monday
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtH(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h 00m`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function fmtShortDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function fmtDayLabel(d: Date): string {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtWeekRange(start: Date): string {
  const end = new Date(start); end.setDate(start.getDate() + 6);
  return `${fmtShortDate(start)} – ${fmtShortDate(end)} ${end.getFullYear()}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

type Filter = 'week' | 'month' | 'custom';

// ─── Day Row ──────────────────────────────────────────────────────────────────
function DayRow({ day, ts, isWeekend }: { day: Date; ts: Timesheet | undefined; isWeekend: boolean }) {
  const hasEntry = !!ts && ts.totalHours != null && ts.totalHours > 0;
  const confirmed = ts ? !!(ts.confirmedAt || ts.autoConfirmed) : false;
  const hours = ts?.totalHours ?? 0;

  return (
    <View style={dr.row}>
      <View style={[dr.iconBox, isWeekend && dr.iconBoxOff, !isWeekend && hasEntry && dr.iconBoxOn]}>
        {hasEntry
          ? <CalendarCheck size={14} color={D.emerald} weight="fill" />
          : <CalendarBlank size={14} color={isWeekend ? '#C4D0CE' : D.light} weight="regular" />}
      </View>
      <View style={dr.mid}>
        <Text style={[dr.day, (isWeekend || !hasEntry) && dr.dayOff]}>{fmtDayLabel(day)}</Text>
        {ts?.shift && !isWeekend
          ? <Text style={dr.time}>{fmtTime(ts.shift.startTime)} – {fmtTime(ts.shift.endTime)}</Text>
          : <Text style={dr.timeFaint}>{isWeekend ? 'Rest day' : 'No shift'}</Text>}
      </View>
      <View style={dr.right}>
        <Text style={[dr.hours, (isWeekend || !hasEntry) && dr.hoursOff]}>
          {hasEntry ? fmtH(hours) : '0h 00m'}
        </Text>
        {confirmed
          ? <CheckCircle size={16} color={D.emerald} weight="fill" style={dr.check} />
          : <View style={[dr.check, dr.checkEmpty]} />}
      </View>
    </View>
  );
}

const dr = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EEF2F1' },
  iconBox: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#EEF2F1', alignItems: 'center', justifyContent: 'center' },
  iconBoxOn: { backgroundColor: 'rgba(0,95,86,0.09)' },
  iconBoxOff: { backgroundColor: '#F4F6F5' },
  mid: { flex: 1 },
  day: { fontSize: 13, fontWeight: '600', color: D.text, marginBottom: 2 },
  dayOff: { color: D.light },
  time: { fontSize: 11, color: D.muted },
  timeFaint: { fontSize: 11, color: '#C4D0CE' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hours: { fontSize: 13, fontWeight: '700', color: D.text },
  hoursOff: { color: D.light },
  check: { marginLeft: 2 },
  checkEmpty: { width: 16, height: 16 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function TimesheetsScreen() {
  const { data, isLoading, refetch } = useTimesheets();
  const [filter, setFilter] = useState<Filter>('week');

  const now = new Date();
  const weekStart = getWeekStart(now);

  const filtered = useMemo<Timesheet[]>(() => {
    if (!data) return [];
    if (filter === 'week') {
      const end = new Date(weekStart); end.setDate(weekStart.getDate() + 7);
      return data.filter(t => {
        const d = new Date(t.shift.startTime);
        return d >= weekStart && d < end;
      });
    }
    if (filter === 'month') {
      return data.filter(t => {
        const d = new Date(t.shift.startTime);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      });
    }
    return data;
  }, [data, filter, weekStart]);

  const totalHours = filtered.reduce((acc, t) => acc + (t.totalHours ?? 0), 0);
  const overtime = Math.max(0, totalHours - 40);

  // Generate Mon–Sun for weekly view
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  // Map timesheets by date string for quick lookup
  const tsByDay = useMemo(() => {
    const map = new Map<string, Timesheet>();
    filtered.forEach(t => {
      const key = new Date(t.shift.startTime).toDateString();
      if (!map.has(key)) map.set(key, t);
    });
    return map;
  }, [filtered]);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'custom', label: 'Custom' },
  ];

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
            <Text style={s.title}>Timesheets</Text>
            <Text style={s.subtitle}>Track and review your work hours</Text>
          </View>
          <Pressable style={s.filterBtn}>
            <Funnel size={18} color={D.muted} weight="regular" />
          </Pressable>
        </View>

        {/* ── Filter Tabs ── */}
        <View style={s.tabRow}>
          {FILTERS.map(f => (
            <Pressable
              key={f.key}
              style={[s.tab, filter === f.key && s.tabActive]}
              onPress={() => {
                if (f.key === 'custom') {
                  Alert.alert('Custom Range', 'Date range picker coming soon.');
                  return;
                }
                setFilter(f.key);
              }}
            >
              <Text style={[s.tabTxt, filter === f.key && s.tabTxtActive]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>

        {isLoading ? (
          <View style={s.loadWrap}><ActivityIndicator size="large" color={D.emerald} /></View>
        ) : (
          <>
            {/* ── Summary Gradient Card ── */}
            <LinearGradient
              colors={[D.eDark, D.eMid, D.eLight]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={s.summaryCard}
            >
              <View style={[s.decoC, { width: 180, height: 180, top: -70, right: -50 }]} />
              <View style={[s.decoC, { width: 100, height: 100, bottom: -40, left: -20 }]} />

              {/* Left */}
              <View style={s.sumLeft}>
                <Text style={s.sumLabel}>Total Hours</Text>
                <Text style={s.sumValue}>{fmtH(totalHours)}</Text>
                <Text style={s.sumSub}>{filter === 'week' ? 'This week' : filter === 'month' ? 'This month' : 'All time'}</Text>
              </View>

              {/* Center icon */}
              <View style={s.sumCenter}>
                <View style={s.clockIconWrap}>
                  <ClockCountdown size={28} color="rgba(255,255,255,0.9)" weight="thin" />
                </View>
              </View>

              {/* Right */}
              <View style={s.sumRight}>
                <Text style={s.sumLabel}>Overtime</Text>
                <Text style={s.sumValue}>{fmtH(overtime)}</Text>
                <Pressable><Text style={s.sumLink}>View breakdown</Text></Pressable>
              </View>
            </LinearGradient>

            {/* ── Weekly Summary Card ── */}
            <View style={s.weekCard}>
              {/* Card header */}
              <View style={s.weekHeader}>
                <View>
                  <Text style={s.weekTitle}>Weekly Summary</Text>
                  <Text style={s.weekRange}>{fmtWeekRange(weekStart)}</Text>
                </View>
                <View style={s.weekTotalPill}>
                  <Text style={s.weekTotalTxt}>{fmtH(totalHours)}</Text>
                </View>
              </View>

              {/* Daily rows */}
              <View style={s.dayList}>
                {weekDays.map((day, i) => {
                  const isWeekend = i >= 5; // Sat=5, Sun=6
                  const ts = tsByDay.get(day.toDateString());
                  return <DayRow key={day.toDateString()} day={day} ts={ts} isWeekend={isWeekend} />;
                })}
                {/* Remove last border */}
                <View style={s.dayListEnd} />
              </View>
            </View>

            {/* ── History Button ── */}
            <Pressable
              style={({ pressed }) => [s.historyCard, pressed && { opacity: 0.7 }]}
              onPress={() => Alert.alert('Timesheet History', 'Full history view coming soon.')}
            >
              <View style={s.historyIcon}>
                <Archive size={18} color={D.emerald} weight="regular" />
              </View>
              <Text style={s.historyTxt}>View Timesheet History</Text>
              <CaretRight size={16} color={D.light} weight="bold" />
            </Pressable>
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

  // Filter Tabs
  tabRow: { flexDirection: 'row', backgroundColor: D.white, borderRadius: 14, padding: 4, marginBottom: 16, borderWidth: 1, borderColor: D.border },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: D.activeTabBg },
  tabTxt: { fontSize: 13, fontWeight: '600', color: D.muted },
  tabTxtActive: { color: D.emerald },

  // Summary Card
  summaryCard: { borderRadius: 24, padding: 24, marginBottom: 16, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  decoC: { position: 'absolute', borderRadius: 9999, backgroundColor: 'rgba(255,255,255,0.05)' },
  sumLeft: { flex: 1 },
  sumRight: { flex: 1, alignItems: 'flex-end' },
  sumCenter: { width: 64, alignItems: 'center' },
  clockIconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.20)', alignItems: 'center', justifyContent: 'center' },
  sumLabel: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.55)', letterSpacing: 0.8, marginBottom: 6 },
  sumValue: { fontSize: 22, fontWeight: '700', color: '#fff', letterSpacing: -0.4 },
  sumSub: { fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 4 },
  sumLink: { fontSize: 11, color: D.mint, fontWeight: '600', marginTop: 4, textDecorationLine: 'underline' },

  // Weekly Summary
  weekCard: { backgroundColor: D.white, borderRadius: 22, marginBottom: 14, borderWidth: 1, borderColor: D.border, overflow: 'hidden', shadowColor: '#00534810', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 16, elevation: 3 },
  weekHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#EEF2F1' },
  weekTitle: { fontSize: 15, fontWeight: '700', color: D.text, marginBottom: 2 },
  weekRange: { fontSize: 12, color: D.muted },
  weekTotalPill: { backgroundColor: D.activeTabBg, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  weekTotalTxt: { fontSize: 13, fontWeight: '700', color: D.emerald },
  dayList: {},
  dayListEnd: { height: 1 }, // absorbs the last row's border

  // History
  historyCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.white, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: D.border, shadowColor: '#00534810', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 10, elevation: 2 },
  historyIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(0,95,86,0.09)', alignItems: 'center', justifyContent: 'center' },
  historyTxt: { flex: 1, fontSize: 14, fontWeight: '600', color: D.text },
});
