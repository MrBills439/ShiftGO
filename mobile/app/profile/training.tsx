import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  ArrowLeft, BookOpen, CheckCircle, Clock, Hourglass, Warning,
} from 'phosphor-react-native';
import { getMyTraining } from '../../services/profileService';
import { Training, TrainingStatus } from '../../types';

const D = {
  bg: '#F4F6F5',
  emerald: '#005F56',
  white: '#FFFFFF',
  text: '#0D1514',
  muted: '#607370',
  light: '#96AEAB',
  border: '#E2EDEB',
};

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isExpiringSoon(iso?: string | null): boolean {
  if (!iso) return false;
  const diff = new Date(iso).getTime() - Date.now();
  return diff > 0 && diff < 30 * 24 * 60 * 60 * 1000;
}

const statusConfig: Record<TrainingStatus, { label: string; bg: string; txt: string; icon: React.ReactNode }> = {
  COMPLETED:   { label: 'Completed',   bg: 'rgba(22,163,74,0.10)',  txt: '#16A34A', icon: <CheckCircle size={14} color="#16A34A" weight="fill" /> },
  IN_PROGRESS: { label: 'In Progress', bg: 'rgba(245,158,11,0.10)', txt: '#F59E0B', icon: <Clock size={14} color="#F59E0B" weight="fill" /> },
  PENDING:     { label: 'Pending',     bg: 'rgba(96,115,112,0.11)', txt: '#607370', icon: <Hourglass size={14} color="#607370" weight="fill" /> },
  EXPIRED:     { label: 'Expired',     bg: 'rgba(239,68,68,0.10)',  txt: '#EF4444', icon: <Warning size={14} color="#EF4444" weight="fill" /> },
};

function TrainingCard({ item }: { item: Training }) {
  const cfg = statusConfig[item.status];
  const expiring = isExpiringSoon(item.expiresAt);

  return (
    <View style={tc.card}>
      <View style={tc.top}>
        <View style={tc.iconBox}>
          <BookOpen size={20} color={D.emerald} weight="regular" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={tc.title}>{item.title}</Text>
          {item.description && <Text style={tc.desc} numberOfLines={2}>{item.description}</Text>}
        </View>
        <View style={[tc.badge, { backgroundColor: cfg.bg }]}>
          {cfg.icon}
          <Text style={[tc.badgeTxt, { color: cfg.txt }]}>{cfg.label}</Text>
        </View>
      </View>

      <View style={tc.footer}>
        {item.completedAt && (
          <View style={tc.dateRow}>
            <Text style={tc.dateLabel}>Completed</Text>
            <Text style={tc.dateVal}>{fmtDate(item.completedAt)}</Text>
          </View>
        )}
        {item.expiresAt && (
          <View style={tc.dateRow}>
            <Text style={[tc.dateLabel, expiring && { color: '#F59E0B' }]}>
              {expiring ? 'Expiring soon' : 'Expires'}
            </Text>
            <Text style={[tc.dateVal, expiring && { color: '#F59E0B' }]}>{fmtDate(item.expiresAt)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const tc = StyleSheet.create({
  card: { backgroundColor: D.white, borderRadius: 18, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: D.border, shadowColor: '#00534810', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 1, shadowRadius: 12, elevation: 2 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 10 },
  iconBox: { width: 42, height: 42, borderRadius: 13, backgroundColor: 'rgba(0,95,86,0.09)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title: { fontSize: 14, fontWeight: '700', color: D.text, marginBottom: 3 },
  desc: { fontSize: 12, color: D.muted, lineHeight: 17 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5, flexShrink: 0 },
  badgeTxt: { fontSize: 11, fontWeight: '700' },
  footer: { flexDirection: 'row', gap: 16 },
  dateRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dateLabel: { fontSize: 11, color: D.light, fontWeight: '500' },
  dateVal: { fontSize: 11, color: D.muted, fontWeight: '600' },
});

export default function TrainingScreen() {
  const router = useRouter();
  const { data = [], isLoading } = useQuery<Training[]>({
    queryKey: ['training'],
    queryFn: getMyTraining,
  });

  const completed = data.filter((t) => t.status === 'COMPLETED').length;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.65 }]}
        >
          <ArrowLeft size={20} color={D.text} weight="bold" />
        </Pressable>
        <Text style={s.title}>Training</Text>
        <View style={{ width: 40 }} />
      </View>

      {isLoading ? (
        <View style={s.loadWrap}><ActivityIndicator size="large" color={D.emerald} /></View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

          {/* Summary pill */}
          <View style={s.summaryRow}>
            <View style={s.summaryPill}>
              <CheckCircle size={16} color={D.emerald} weight="fill" />
              <Text style={s.summaryTxt}>{completed} of {data.length} completed</Text>
            </View>
          </View>

          {data.length === 0 ? (
            <View style={s.empty}>
              <BookOpen size={40} color={D.light} weight="thin" />
              <Text style={s.emptyTxt}>No training records found.</Text>
            </View>
          ) : (
            data.map((item) => <TrainingCard key={item.id} item={item} />)
          )}

        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: D.bg },
  scroll: { paddingHorizontal: 18, paddingBottom: 40 },
  loadWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: D.white, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: D.border },
  title: { fontSize: 17, fontWeight: '700', color: D.text },
  summaryRow: { alignItems: 'flex-start', marginBottom: 14 },
  summaryPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,95,86,0.09)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  summaryTxt: { fontSize: 13, fontWeight: '600', color: D.emerald },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyTxt: { fontSize: 15, color: D.muted },
});
