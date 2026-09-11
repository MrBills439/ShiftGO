import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Linking, Platform, Alert, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, MapPin, Clock, Calendar, HouseLine,
  NavigationArrow, CheckCircle, Timer, SignOut, ArrowsClockwise, HandHeart,
} from 'phosphor-react-native';
import { getShiftById } from '../../services/profileService';
import { dropShift } from '../../services/rotaService';
import {
  getEligibleWorkers, getSwapShifts, requestCover, requestSwap,
} from '../../services/shiftChangeService';
import { useAuthStore } from '../../store/authStore';
import { Shift } from '../../types';
import { D } from '../../constants/theme';
import { fmtTime, fmtDateLong as fmtDate, fmtDurCompact as fmtDuration } from '../../lib/datetime';
import { attendanceTargetFor } from '../../lib/attendanceTarget';


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
  const target = attendanceTargetFor(shift);
  const canDrop = !!shift && status === 'upcoming' && shift.workerId === userId && shift.status === 'SCHEDULED';
  const canRequestChange = canDrop; // own, future, SCHEDULED shift

  // ── Cover / swap ──
  const [mode, setMode] = React.useState<null | 'menu' | 'cover' | 'swap'>(null);
  const [targetWorkerId, setTargetWorkerId] = React.useState<string | null>(null);
  const [targetShiftId, setTargetShiftId] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState('');

  const eligible = useQuery({
    queryKey: ['shift-change', 'eligible', id],
    queryFn: () => getEligibleWorkers(id),
    enabled: !!id && (mode === 'cover' || mode === 'swap'),
  });
  const swapShifts = useQuery({
    queryKey: ['shift-change', 'swap-shifts', id, targetWorkerId],
    queryFn: () => getSwapShifts(id, targetWorkerId as string),
    enabled: mode === 'swap' && !!targetWorkerId,
  });

  function resetChange() {
    setMode(null); setTargetWorkerId(null); setTargetShiftId(null); setReason('');
  }

  const coverMut = useMutation({
    mutationFn: () => requestCover({ shiftId: id, targetWorkerId: targetWorkerId as string, reason: reason.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shift-change'] });
      Alert.alert('Cover requested', 'Your teammate has been notified. If they accept, your manager approves before anything changes.');
      resetChange();
    },
    onError: (e: any) => Alert.alert('Could not request cover', e.response?.data?.message ?? 'Please try again.'),
  });
  const swapMut = useMutation({
    mutationFn: () => requestSwap({ shiftId: id, targetWorkerId: targetWorkerId as string, targetShiftId: targetShiftId as string, reason: reason.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shift-change'] });
      Alert.alert('Swap requested', 'Your teammate has been notified. If they accept, your manager approves before anything changes.');
      resetChange();
    },
    onError: (e: any) => Alert.alert('Could not request swap', e.response?.data?.message ?? 'Please try again.'),
  });

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
      `Your shift at ${target?.name ?? 'your shift location'} will be released for cover, and your manager and team leader will be notified.`,
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
                <Text style={s.houseName}>{target?.name ?? 'Shift location unavailable'}</Text>
                <Text style={s.roleLabel}>{target?.kind === 'LOCATION' ? 'Fixed Shift' : 'Care Support Shift'}</Text>
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
            {target?.address && (
              <View style={[ir.row, { borderBottomWidth: 0 }]}>
                <View style={ir.iconBox}>
                  <MapPin size={18} color={D.emerald} weight="regular" />
                </View>
                <View style={ir.text}>
                  <Text style={ir.label}>ADDRESS</Text>
                  <Text style={ir.value}>{target.address}</Text>
                </View>
              </View>
            )}
          </View>

          {/* Location card — only when there's an address to show */}
          {target?.address && (
            <View style={s.locationCard}>
              <View style={s.locationInfo}>
                <MapPin size={16} color={D.emerald} weight="fill" />
                <Text style={s.locationTxt} numberOfLines={2}>{target.address}</Text>
              </View>
              {target.latitude != null && target.longitude != null && (
                <Pressable
                  style={({ pressed }) => [s.dirBtn, pressed && { opacity: 0.8 }]}
                  onPress={() => openDirections(target.address as string, target.latitude as number, target.longitude as number)}
                >
                  <NavigationArrow size={18} color={D.white} weight="fill" />
                  <Text style={s.dirTxt}>Get Directions</Text>
                </Pressable>
              )}
            </View>
          )}

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

          {canRequestChange && mode === null && (
            <Pressable
              onPress={() => setMode('menu')}
              style={({ pressed }) => [s.cantBtn, pressed && { opacity: 0.75 }]}
            >
              <Text style={s.cantTxt}>Can’t work this shift?</Text>
            </Pressable>
          )}

          {mode === 'menu' && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Can’t work this shift?</Text>
              <Pressable style={s.opt} onPress={() => setMode('cover')}>
                <HandHeart size={18} color={D.emerald} weight="bold" />
                <View style={{ flex: 1 }}>
                  <Text style={s.optTitle}>Request cover</Text>
                  <Text style={s.optSub}>A teammate takes this shift (manager approves)</Text>
                </View>
              </Pressable>
              <Pressable style={s.opt} onPress={() => setMode('swap')}>
                <ArrowsClockwise size={18} color={D.emerald} weight="bold" />
                <View style={{ flex: 1 }}>
                  <Text style={s.optTitle}>Swap with a teammate</Text>
                  <Text style={s.optSub}>Trade this shift for one of theirs (manager approves)</Text>
                </View>
              </Pressable>
              <Pressable onPress={resetChange}><Text style={s.linkTxt}>Cancel</Text></Pressable>
            </View>
          )}

          {(mode === 'cover' || mode === 'swap') && (
            <View style={s.card}>
              <Text style={s.cardTitle}>{mode === 'cover' ? 'Request cover' : 'Swap shift'}</Text>
              <Text style={s.optSub}>Choose an available teammate</Text>
              {eligible.isLoading ? (
                <ActivityIndicator color={D.emerald} style={{ marginVertical: 12 }} />
              ) : (
                <View style={{ marginTop: 8 }}>
                  {(eligible.data?.workers ?? []).filter((w) => w.eligible).map((w) => (
                    <Pressable
                      key={w.id}
                      style={[s.pick, targetWorkerId === w.id && s.pickOn]}
                      onPress={() => { setTargetWorkerId(w.id); setTargetShiftId(null); }}
                    >
                      <Text style={[s.pickTxt, targetWorkerId === w.id && s.pickTxtOn]}>{w.name}</Text>
                    </Pressable>
                  ))}
                  {(eligible.data?.workers ?? []).filter((w) => w.eligible).length === 0 && (
                    <Text style={s.optSub}>No teammates are available for this shift right now.</Text>
                  )}
                </View>
              )}

              {mode === 'swap' && targetWorkerId && (
                <View style={{ marginTop: 12 }}>
                  <Text style={s.optSub}>Choose one of their future shifts to take</Text>
                  {swapShifts.isLoading ? (
                    <ActivityIndicator color={D.emerald} style={{ marginVertical: 12 }} />
                  ) : (
                    <View style={{ marginTop: 8 }}>
                      {(swapShifts.data?.shifts ?? []).map((sh) => {
                        const d = new Date(sh.startTime);
                        const label = `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ${sh.house?.name ?? ''}`;
                        return (
                          <Pressable key={sh.id} style={[s.pick, targetShiftId === sh.id && s.pickOn]} onPress={() => setTargetShiftId(sh.id)}>
                            <Text style={[s.pickTxt, targetShiftId === sh.id && s.pickTxtOn]}>{label}</Text>
                          </Pressable>
                        );
                      })}
                      {(swapShifts.data?.shifts ?? []).length === 0 && (
                        <Text style={s.optSub}>They have no swappable future shifts.</Text>
                      )}
                    </View>
                  )}
                </View>
              )}

              <TextInput
                style={s.reasonInput}
                value={reason}
                onChangeText={setReason}
                placeholder="Reason (optional)"
                placeholderTextColor={D.light}
                multiline
              />

              <View style={s.rowBtns}>
                <Pressable onPress={resetChange}><Text style={s.linkTxt}>Cancel</Text></Pressable>
                <Pressable
                  style={[s.sendBtn, ((mode === 'cover' ? !targetWorkerId : !(targetWorkerId && targetShiftId)) || coverMut.isPending || swapMut.isPending) && { opacity: 0.5 }]}
                  disabled={(mode === 'cover' ? !targetWorkerId : !(targetWorkerId && targetShiftId)) || coverMut.isPending || swapMut.isPending}
                  onPress={() => (mode === 'cover' ? coverMut.mutate() : swapMut.mutate())}
                >
                  <Text style={s.sendTxt}>
                    {coverMut.isPending || swapMut.isPending ? 'Sending…' : mode === 'cover' ? 'Send cover request' : 'Send swap request'}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

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

  cantBtn: { alignItems: 'center', paddingVertical: 13, borderRadius: 14, borderWidth: 1, borderColor: D.border, backgroundColor: D.white, marginTop: 4, marginBottom: 8 },
  cantTxt: { fontSize: 15, fontWeight: '700', color: D.emerald },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EEF2F1' },
  optTitle: { fontSize: 14, fontWeight: '700', color: D.text },
  optSub: { fontSize: 12.5, color: D.muted, marginTop: 1 },
  linkTxt: { fontSize: 13.5, fontWeight: '700', color: D.muted, paddingVertical: 12 },
  pick: { paddingVertical: 11, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: D.border, marginBottom: 6, backgroundColor: D.white },
  pickOn: { borderColor: D.emerald, backgroundColor: 'rgba(0,95,86,0.06)' },
  pickTxt: { fontSize: 13.5, color: D.text, fontWeight: '500' },
  pickTxtOn: { color: D.emerald, fontWeight: '700' },
  reasonInput: { marginTop: 12, borderWidth: 1.5, borderColor: D.inputBorder, backgroundColor: D.inputBg, borderRadius: 12, padding: 12, fontSize: 14, color: D.text, minHeight: 60, textAlignVertical: 'top' },
  rowBtns: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  sendBtn: { backgroundColor: D.emerald, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18 },
  sendTxt: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
