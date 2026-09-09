import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowsClockwise, HandHeart, CheckCircle, XCircle } from 'phosphor-react-native';
import {
  getMyShiftChanges, respondToShiftChange, cancelShiftChange,
  type ShiftChangeRequest, type ShiftChangeShift,
} from '../../services/shiftChangeService';
import { D } from '../../constants/theme';

function fmtShift(s: ShiftChangeShift | null) {
  if (!s) return '—';
  const d = new Date(s.startTime);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const start = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const end = new Date(s.endTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${start}–${end} · ${s.house?.name ?? 'a service'}`;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING_RECIPIENT: 'Waiting for teammate',
  PENDING_MANAGER: 'Waiting for manager approval',
  APPROVED: 'Approved',
  REJECTED: 'Declined',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

export default function ShiftRequestsScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['shift-change', 'me'], queryFn: getMyShiftChanges, staleTime: 15_000 });

  const respond = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'ACCEPT' | 'DECLINE' }) => respondToShiftChange(id, decision),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shift-change'] });
      qc.invalidateQueries({ queryKey: ['shifts'] });
    },
    onError: (e: any) => Alert.alert('Could not respond', e.response?.data?.message ?? 'Please try again.'),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelShiftChange(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shift-change'] }),
    onError: (e: any) => Alert.alert('Could not cancel', e.response?.data?.message ?? 'Please try again.'),
  });

  const incoming = data?.incoming.items ?? [];
  const sent = data?.sent.items ?? [];

  function confirmRespond(req: ShiftChangeRequest, decision: 'ACCEPT' | 'DECLINE') {
    const verb = decision === 'ACCEPT' ? 'Accept' : 'Decline';
    Alert.alert(
      `${verb} this request?`,
      decision === 'ACCEPT'
        ? 'Your manager still has to approve it before anything changes.'
        : 'The requester will be told you cannot take it.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: verb, style: decision === 'DECLINE' ? 'destructive' : 'default', onPress: () => respond.mutate({ id: req.id, decision }) },
      ],
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.65 }]}>
          <ArrowLeft size={20} color={D.text} weight="bold" />
        </Pressable>
        <Text style={s.title}>Shift Requests</Text>
        <View style={{ width: 40 }} />
      </View>

      {isLoading ? (
        <View style={s.center}><ActivityIndicator size="large" color={D.emerald} /></View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <Text style={s.sectionLabel}>ASKED OF YOU</Text>
          {incoming.length === 0 && <Text style={s.empty}>Nothing needs your response.</Text>}
          {incoming.map((req) => (
            <View key={req.id} style={s.card}>
              <View style={s.cardTop}>
                {req.type === 'SWAP' ? <ArrowsClockwise size={16} color={D.emerald} weight="bold" /> : <HandHeart size={16} color={D.emerald} weight="bold" />}
                <Text style={s.cardType}>{req.type === 'SWAP' ? 'Shift swap' : 'Shift cover'}</Text>
              </View>
              <Text style={s.line}>
                <Text style={s.who}>{req.requester?.name}</Text>
                {req.type === 'SWAP' ? ' wants to swap:' : ' wants you to cover:'}
              </Text>
              <Text style={s.shiftLine}>{fmtShift(req.primaryShift)}</Text>
              {req.type === 'SWAP' && (
                <>
                  <Text style={[s.line, { marginTop: 6 }]}>for your shift:</Text>
                  <Text style={s.shiftLine}>{fmtShift(req.swapShift)}</Text>
                </>
              )}
              {req.requesterReason ? <Text style={s.reason}>“{req.requesterReason}”</Text> : null}
              {req.status === 'PENDING_RECIPIENT' && !req.expired ? (
                <View style={s.actions}>
                  <Pressable style={s.acceptBtn} disabled={respond.isPending} onPress={() => confirmRespond(req, 'ACCEPT')}>
                    <CheckCircle size={16} color="#fff" weight="fill" />
                    <Text style={s.acceptTxt}>Accept</Text>
                  </Pressable>
                  <Pressable style={s.declineBtn} disabled={respond.isPending} onPress={() => confirmRespond(req, 'DECLINE')}>
                    <XCircle size={16} color={D.error} weight="fill" />
                    <Text style={s.declineTxt}>Decline</Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={s.statusTag}>{req.expired ? 'Expired' : STATUS_LABEL[req.status]}</Text>
              )}
            </View>
          ))}

          <Text style={[s.sectionLabel, { marginTop: 24 }]}>YOU REQUESTED</Text>
          {sent.length === 0 && <Text style={s.empty}>You haven’t asked anyone to cover or swap.</Text>}
          {sent.map((req) => (
            <View key={req.id} style={s.card}>
              <View style={s.cardTop}>
                {req.type === 'SWAP' ? <ArrowsClockwise size={16} color={D.emerald} weight="bold" /> : <HandHeart size={16} color={D.emerald} weight="bold" />}
                <Text style={s.cardType}>{req.type === 'SWAP' ? 'Shift swap' : 'Shift cover'} · {req.targetWorker?.name}</Text>
              </View>
              <Text style={s.shiftLine}>{fmtShift(req.primaryShift)}</Text>
              <Text style={s.statusTag}>{req.expired ? 'Expired' : STATUS_LABEL[req.status]}</Text>
              {(req.status === 'PENDING_RECIPIENT' || req.status === 'PENDING_MANAGER') && !req.expired && (
                <Pressable style={s.cancelBtn} disabled={cancel.isPending} onPress={() => cancel.mutate(req.id)}>
                  <Text style={s.cancelTxt}>Cancel request</Text>
                </Pressable>
              )}
            </View>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: D.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: D.white, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: D.border },
  title: { fontSize: 17, fontWeight: '700', color: D.text },
  scroll: { paddingHorizontal: 18, paddingBottom: 24 },
  sectionLabel: { fontSize: 10, fontWeight: '700', color: D.light, letterSpacing: 1.2, marginBottom: 10 },
  empty: { fontSize: 13, color: D.muted, marginBottom: 8 },
  card: { backgroundColor: D.white, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: D.border, marginBottom: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  cardType: { fontSize: 13, fontWeight: '700', color: D.text },
  line: { fontSize: 13, color: D.muted },
  who: { fontWeight: '700', color: D.text },
  shiftLine: { fontSize: 13.5, fontWeight: '600', color: D.text, marginTop: 2 },
  reason: { fontSize: 12.5, color: D.muted, fontStyle: 'italic', marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  acceptBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: D.emerald, borderRadius: 12, paddingVertical: 11 },
  acceptTxt: { fontSize: 14, fontWeight: '700', color: '#fff' },
  declineBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: D.errorBg, borderWidth: 1, borderColor: D.errorBorder, borderRadius: 12, paddingVertical: 11 },
  declineTxt: { fontSize: 14, fontWeight: '700', color: D.error },
  statusTag: { fontSize: 12, fontWeight: '700', color: D.muted, marginTop: 10 },
  cancelBtn: { marginTop: 12, alignSelf: 'flex-start' },
  cancelTxt: { fontSize: 13, fontWeight: '700', color: D.error },
});
