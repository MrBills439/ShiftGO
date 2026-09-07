import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft, ShieldCheck, ShieldWarning, Clock, Warning,
} from 'phosphor-react-native';
import { getMyDbs } from '../../services/profileService';
import { DbsCheck, DbsStatus } from '../../types';
import { D } from '../../constants/theme';


function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

const statusConfig: Record<DbsStatus, {
  gradColors: [string, string];
  icon: React.ReactNode;
  label: string;
  sublabel: string;
}> = {
  CLEAR:   {
    gradColors: ['#005F56', '#0A7060'],
    icon: <ShieldCheck size={40} color="#fff" weight="fill" />,
    label: 'Clear',
    sublabel: 'Your DBS check is clear and valid.',
  },
  PENDING: {
    gradColors: ['#92400E', '#B45309'],
    icon: <Clock size={40} color="#fff" weight="fill" />,
    label: 'Pending',
    sublabel: 'Your DBS check is being processed.',
  },
  FLAGGED: {
    gradColors: ['#7F1D1D', '#991B1B'],
    icon: <ShieldWarning size={40} color="#fff" weight="fill" />,
    label: 'Flagged',
    sublabel: 'Please contact your administrator.',
  },
  EXPIRED: {
    gradColors: ['#374151', '#4B5563'],
    icon: <Warning size={40} color="#fff" weight="fill" />,
    label: 'Expired',
    sublabel: 'Your DBS check has expired. Please renew.',
  },
};

function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={ir.row}>
      <Text style={ir.label}>{label}</Text>
      <Text style={[ir.value, highlight && ir.valueHighlight]}>{value}</Text>
    </View>
  );
}

const ir = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#EEF2F1' },
  label: { fontSize: 13, color: D.muted, fontWeight: '500' },
  value: { fontSize: 13, color: D.text, fontWeight: '600' },
  valueHighlight: { color: D.emerald },
});

export default function DbsScreen() {
  const router = useRouter();
  const { data: dbs, isLoading } = useQuery<DbsCheck | null>({
    queryKey: ['dbs'],
    queryFn: getMyDbs,
  });

  const cfg = dbs ? statusConfig[dbs.status] : null;
  const days = dbs ? daysUntil(dbs.expiresAt) : null;

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
        <Text style={s.title}>DBS Check</Text>
        <View style={{ width: 40 }} />
      </View>

      {isLoading ? (
        <View style={s.loadWrap}><ActivityIndicator size="large" color={D.emerald} /></View>
      ) : !dbs || !cfg ? (
        <View style={s.loadWrap}>
          <ShieldCheck size={52} color={D.light} weight="thin" />
          <Text style={s.noDbsTitle}>No DBS Record</Text>
          <Text style={s.noDbsSub}>Your DBS check record has not been added yet. Contact your manager.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

          {/* Status hero */}
          <LinearGradient
            colors={cfg.gradColors}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={s.heroCard}
          >
            <View style={[s.decoC, { width: 160, height: 160, top: -60, right: -40 }]} />
            <View style={[s.decoC, { width: 90, height: 90, bottom: -35, left: -15 }]} />
            <View style={s.heroIcon}>{cfg.icon}</View>
            <Text style={s.heroLabel}>{cfg.label}</Text>
            <Text style={s.heroSub}>{cfg.sublabel}</Text>
            {days !== null && days > 0 && days <= 90 && (
              <View style={s.expiryPill}>
                <Text style={s.expiryTxt}>Expires in {days} days</Text>
              </View>
            )}
          </LinearGradient>

          {/* Details */}
          <View style={s.card}>
            <Text style={s.cardTitle}>DBS Details</Text>
            <InfoRow label="Reference" value={dbs.reference ?? '—'} highlight={!!dbs.reference} />
            <InfoRow label="Date Issued" value={fmtDate(dbs.issuedAt)} />
            <InfoRow label="Expiry Date" value={fmtDate(dbs.expiresAt)} />
            <View style={[ir.row, { borderBottomWidth: 0 }]}>
              <Text style={ir.label}>Notes</Text>
              <Text style={[ir.value, { maxWidth: '65%', textAlign: 'right' }]}>{dbs.notes ?? '—'}</Text>
            </View>
          </View>

          <Text style={s.footer}>
            DBS records are managed by your HR administrator. Contact them to update your information.
          </Text>

        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: D.bg },
  scroll: { paddingHorizontal: 18, paddingBottom: 40 },
  loadWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: D.white, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: D.border },
  title: { fontSize: 17, fontWeight: '700', color: D.text },

  heroCard: { borderRadius: 24, padding: 28, marginBottom: 16, alignItems: 'center', overflow: 'hidden' },
  decoC: { position: 'absolute', borderRadius: 9999, backgroundColor: 'rgba(255,255,255,0.06)' },
  heroIcon: { width: 80, height: 80, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  heroLabel: { fontSize: 26, fontWeight: '700', color: '#fff', letterSpacing: -0.3, marginBottom: 6 },
  heroSub: { fontSize: 14, color: 'rgba(255,255,255,0.7)', textAlign: 'center' },
  expiryPill: { marginTop: 14, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  expiryTxt: { fontSize: 12, color: '#fff', fontWeight: '600' },

  card: { backgroundColor: D.white, borderRadius: 22, padding: 18, marginBottom: 16, borderWidth: 1, borderColor: D.border, shadowColor: '#00534810', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 16, elevation: 3 },
  cardTitle: { fontSize: 13, fontWeight: '700', color: D.muted, letterSpacing: 0.4, marginBottom: 4, textTransform: 'uppercase' },

  noDbsTitle: { fontSize: 18, fontWeight: '700', color: D.text },
  noDbsSub: { fontSize: 14, color: D.muted, textAlign: 'center', lineHeight: 21 },
  footer: { fontSize: 12, color: D.light, textAlign: 'center', lineHeight: 18, paddingHorizontal: 8 },
});
