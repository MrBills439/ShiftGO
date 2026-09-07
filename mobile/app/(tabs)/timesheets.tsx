import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTabBarHeight } from '../../lib/useTabBarHeight';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ClockCountdown, CalendarBlank, CalendarCheck, CheckCircle,
} from 'phosphor-react-native';
import { useTimesheets } from '../../hooks/useTimesheets';
import { Skeleton, SkeletonCard } from '../../components/Skeleton';
import { Timesheet } from '../../types';
import { D } from '../../constants/theme';
import { getWeekStart, fmtHM as fmtH, fmtTime, fmtShortDate, fmtDayLabel, fmtWeekRange } from '../../lib/datetime';

// ─── Tokens ───────────────────────────────────────────────────────────────────

// ─── Helpers ──────────────────────────────────────────────────────────────────
type Filter = 'week' | 'month' | 'all';

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
  const tabBarHeight = useTabBarHeight();
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
  // TODO: source the weekly overtime threshold from agency config when available.
  const OVERTIME_THRESHOLD_HOURS = 40;
  const overtime = Math.max(0, totalHours - OVERTIME_THRESHOLD_HOURS);

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
    { key: 'all', label: 'All Time' },
  ];

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: tabBarHeight + 24 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={D.emerald} />}
      >

        {/* ── Header ── */}
        <View style={s.header}>
          <View>
            <Text style={s.title}>Timesheets</Text>
            <Text style={s.subtitle}>Track and review your work hours</Text>
          </View>
        </View>

        {/* ── Filter Tabs ── */}
        <View style={s.tabRow}>
          {FILTERS.map(f => (
            <Pressable
              key={f.key}
              style={[s.tab, filter === f.key && s.tabActive]}
              onPress={() => setFilter(f.key)}
            >
              <Text style={[s.tabTxt, filter === f.key && s.tabTxtActive]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>

        {isLoading ? (
          <>
            <SkeletonCard style={{ marginBottom: 16 }}>
              <Skeleton width={100} height={12} />
              <Skeleton width={130} height={24} />
              <Skeleton width={90} height={10} />
            </SkeletonCard>
            <SkeletonCard style={{ padding: 0, gap: 0 }}>
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <View key={i} style={dr.row}>
                  <Skeleton width={34} height={34} radius={10} />
                  <View style={{ flex: 1, gap: 7 }}>
                    <Skeleton width="45%" height={12} />
                    <Skeleton width="60%" height={10} />
                  </View>
                  <Skeleton width={46} height={13} />
                </View>
              ))}
            </SkeletonCard>
          </>
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
                <Text style={s.sumSub}>over 40h / week</Text>
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
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: D.bg },
  scroll: { paddingHorizontal: 18 },

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
