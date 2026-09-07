import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Linking, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, MapPin, Clock, Calendar, HouseLine,
  NavigationArrow, CheckCircle, Timer, SignOut,
} from 'phosphor-react-native';
import { getShiftById } from '../../services/profileService';
import { dropShift } from '../../services/rotaService';
import { useAuthStore } from '../../store/authStore';
import { Shift } from '../../types';
import { D } from '../../constants/theme';
import { fmtTime, fmtDateLong as fmtDate, fmtDurCompact as fmtDuration } from '../../lib/datetime';


function getStatus(shift: Shift): 'active' | 'upcoming' | 'completed' {
  const now = new Date();
  const start = new Date(shift.startTime);
  const end = new Date(shift.endTime);
  if (now >= start && now <= end) return 'active';
  if (now < start) return 'upcoming';
  return 'completed';
}

function openDirections(address: string, lat: number, lng: number) {
  const encoded = encodeURIComponent(address);
  const iosUrl = `maps://?q=${encoded}&ll=${lat},${lng}`;
  const androidUrl = `geo:${lat},${lng}?q=${encoded}`;
  const webUrl = `https://www.google.com/maps/search/?api=1&query=${encoded}`;

  if (Platform.OS === 'ios') {
    Alert.alert('Get Directions', 'Open with:', [
      {
        text: 'Apple Maps',
        onPress: () => Linking.openURL(iosUrl),
      },
      {
        text: 'Google Maps',
        onPress: () => Linking.openURL(`comgooglemaps://?q=${encoded}&center=${lat},${lng}`).catch(
          () => Linking.openURL(webUrl)
        ),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  } else {
    Linking.openURL(androidUrl).catch(() => Linking.openURL(webUrl));
  }
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={ir.row}>
      <View style={ir.iconBox}>{icon}</View>
      <View style={ir.text}>
        <Text style={ir.label}>{label}</Text>
        <Text style={ir.value}>{value}</Text>
      </View>
    </View>
  );
}

const ir = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#EEF2F1' },
  iconBox: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(0,95,86,0.09)', alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
  label: { fontSize: 11, fontWeight: '600', color: D.light, letterSpacing: 0.3, marginBottom: 2 },
  value: { fontSize: 14, fontWeight: '600', color: D.text },
});

export default function ShiftDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);

  const { data: shift, isLoading } = useQuery<Shift>({
    queryKey: ['shift', id],
    queryFn: () => getShiftById(id),
    enabled: !!id,
  });

  const status = shift ? getStatus(shift) : null;
  const canDrop = !!shift && status === 'upcoming' && shift.workerId === userId && shift.status === 'SCHEDULED';

  const drop = useMutation({
    mutationFn: () => dropShift(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shift', id] });
      qc.invalidateQueries({ queryKey: ['shifts'] });
      qc.invalidateQueries({ queryKey: ['open-shifts'] });
      Alert.alert('Shift dropped', 'Your manager and team leader have been notified, and the shift is open for cover.');
      router.back();
    },
    onError: (e: any) => Alert.alert('Could not drop shift', e.response?.data?.message ?? 'Please try again.'),
  });

  function confirmDrop() {
    if (!shift) return;
    Alert.alert(
      'Drop this shift?',
      `Your shift at ${shift.house.name} will be released for cover, and your manager and team leader will be notified.`,
      [
        { text: 'Keep shift', style: 'cancel' },
        { text: 'Drop shift', style: 'destructive', onPress: () => drop.mutate() },
      ],
    );
  }

  const statusMap = {
    active:    { label: 'Active Now', bg: 'rgba(0,95,86,0.11)',    txt: D.emerald },
    upcoming:  { label: 'Upcoming',   bg: 'rgba(22,163,74,0.11)',  txt: '#16A34A' },
    completed: { label: 'Completed',  bg: 'rgba(96,115,112,0.11)', txt: '#607370' },
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={s.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.65 }]}
        >
          <ArrowLeft size={20} color={D.text} weight="bold" />
        </Pressable>
        <Text style={s.headerTitle}>Shift Details</Text>
        <View style={{ width: 40 }} />
      </View>

      {isLoading ? (
        <View style={s.loadWrap}>
          <ActivityIndicator size="large" color={D.emerald} />
        </View>
      ) : !shift ? (
        <View style={s.loadWrap}>
          <Text style={s.errorTxt}>Shift not found.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

          {/* Hero card */}
          <View style={s.heroCard}>
            <View style={s.heroTop}>
              <View style={s.houseIconWrap}>
                <HouseLine size={28} color={D.emerald} weight="regular" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.houseName}>{shift.house.name}</Text>
                <Text style={s.roleLabel}>Care Support Shift</Text>
              </View>
              {status && (
                <View style={[s.statusBadge, { backgroundColor: statusMap[status].bg }]}>
                  <Text style={[s.statusTxt, { color: statusMap[status].txt }]}>
                    {statusMap[status].label}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Details card */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Shift Information</Text>
            <InfoRow
              icon={<Calendar size={18} color={D.emerald} weight="regular" />}
              label="DATE"
              value={fmtDate(shift.startTime)}
            />
            <InfoRow
              icon={<Clock size={18} color={D.emerald} weight="regular" />}
              label="TIME"
              value={`${fmtTime(shift.startTime)} – ${fmtTime(shift.endTime)}`}
            />
            <InfoRow
              icon={<Timer size={18} color={D.emerald} weight="regular" />}
              label="DURATION"
              value={fmtDuration(shift.startTime, shift.endTime)}
            />
            <View style={[ir.row, { borderBottomWidth: 0 }]}>
              <View style={ir.iconBox}>
                <MapPin size={18} color={D.emerald} weight="regular" />
              </View>
              <View style={ir.text}>
                <Text style={ir.label}>ADDRESS</Text>
                <Text style={ir.value}>{shift.house.address}</Text>
              </View>
            </View>
          </View>

          {/* Location card */}
          <View style={s.locationCard}>
            <View style={s.locationInfo}>
              <MapPin size={16} color={D.emerald} weight="fill" />
              <Text style={s.locationTxt} numberOfLines={2}>{shift.house.address}</Text>
            </View>
            <Pressable
              style={({ pressed }) => [s.dirBtn, pressed && { opacity: 0.8 }]}
              onPress={() => openDirections(shift.house.address, shift.house.latitude, shift.house.longitude)}
            >
              <NavigationArrow size={18} color={D.white} weight="fill" />
              <Text style={s.dirTxt}>Get Directions</Text>
            </Pressable>
          </View>

          {/* Requirements card */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Requirements</Text>
            {[
              'Valid DBS check',
              'Personal protective equipment (PPE)',
              'Care support qualification',
            ].map((req, i, arr) => (
              <View key={req} style={[s.reqRow, i === arr.length - 1 && { borderBottomWidth: 0 }]}>
                <CheckCircle size={16} color={D.emerald} weight="fill" />
                <Text style={s.reqTxt}>{req}</Text>
              </View>
            ))}
          </View>

          {canDrop && (
            <Pressable
              onPress={confirmDrop}
              disabled={drop.isPending}
              style={({ pressed }) => [s.dropBtn, (drop.isPending || pressed) && { opacity: 0.6 }]}
            >
              <SignOut size={17} color={D.error} weight="bold" />
              <Text style={s.dropTxt}>{drop.isPending ? 'Dropping…' : 'Drop this shift'}</Text>
            </Pressable>
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
  errorTxt: { fontSize: 15, color: D.muted },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 12,
    backgroundColor: D.bg,
  },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: D.white, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: D.border },
  headerTitle: { fontSize: 17, fontWeight: '700', color: D.text },

  heroCard: {
    backgroundColor: D.white, borderRadius: 22, padding: 18, marginBottom: 12, marginTop: 4,
    borderWidth: 1, borderColor: D.border,
    shadowColor: '#00534812', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 1, shadowRadius: 20, elevation: 4,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  houseIconWrap: { width: 54, height: 54, borderRadius: 16, backgroundColor: 'rgba(0,95,86,0.09)', alignItems: 'center', justifyContent: 'center' },
  houseName: { fontSize: 18, fontWeight: '700', color: D.text, marginBottom: 3 },
  roleLabel: { fontSize: 13, color: D.muted },
  statusBadge: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  statusTxt: { fontSize: 12, fontWeight: '700' },

  card: {
    backgroundColor: D.white, borderRadius: 22, padding: 18, marginBottom: 12,
    borderWidth: 1, borderColor: D.border,
    shadowColor: '#00534810', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 16, elevation: 3,
  },
  cardTitle: { fontSize: 13, fontWeight: '700', color: D.muted, letterSpacing: 0.4, marginBottom: 4, textTransform: 'uppercase' },

  locationCard: {
    backgroundColor: D.white, borderRadius: 22, padding: 18, marginBottom: 12,
    borderWidth: 1, borderColor: D.border,
    shadowColor: '#00534810', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 16, elevation: 3,
    gap: 14,
  },
  locationInfo: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  locationTxt: { fontSize: 14, color: D.muted, flex: 1, lineHeight: 20 },
  dirBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: D.emerald, borderRadius: 14, paddingVertical: 14,
  },
  dirTxt: { fontSize: 15, fontWeight: '700', color: D.white },

  reqRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#EEF2F1' },
  reqTxt: { fontSize: 14, color: D.text, fontWeight: '500' },

  dropBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: D.errorBg, borderWidth: 1, borderColor: D.errorBorder,
    borderRadius: 14, paddingVertical: 14, marginTop: 4,
  },
  dropTxt: { fontSize: 15, fontWeight: '700', color: D.error },
});
