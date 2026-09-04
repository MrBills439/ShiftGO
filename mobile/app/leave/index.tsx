import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView,
  Modal, RefreshControl, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, CalendarBlank, CheckCircle, XCircle, Clock, ArrowLeft, CalendarDots } from 'phosphor-react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { getLeaveRequests, getLeaveBalance, createLeaveRequest, cancelLeaveRequest } from '../../services/leaveRequestService';
import { apiErrorMessage } from '../../services/api';
import { LeaveBalanceSummary, LeaveRequest } from '../../types';
import { D } from '../../constants/theme';
import { weekdaysInRange, fmtDate } from '../../lib/datetime';
import { fmtLeaveDays, nextDayCaption } from '../../lib/leave';
import { Skeleton } from '../../components/Skeleton';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LEAVE_TYPE = 'Annual Leave';

/** Date -> "YYYY-MM-DD" (local, no timezone shift). */
function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const isYmd = (v: string) => DATE_RE.test(v);

// ─── Date field ──────────────────────────────────────────────────────────────
function DateField({
  label, value, min, onChange,
}: {
  label: string;
  value: string;
  min?: string;
  onChange: (ymd: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const asDate = value && isYmd(value) ? new Date(`${value}T00:00:00`) : new Date();

  const handle = (e: DateTimePickerEvent, picked?: Date) => {
    if (Platform.OS === 'android') setOpen(false);
    if (e.type === 'set' && picked) onChange(toYMD(picked));
  };

  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Pressable style={s.control} onPress={() => setOpen((o) => !o)}>
        <Text style={value ? s.controlValue : s.controlPlaceholder}>
          {value ? fmtDate(`${value}T00:00:00`) : 'Select a date'}
        </Text>
        <CalendarDots size={17} color={D.muted} weight="regular" />
      </Pressable>
      {open && (
        <DateTimePicker
          value={asDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          minimumDate={min && isYmd(min) ? new Date(`${min}T00:00:00`) : undefined}
          onChange={handle}
        />
      )}
    </View>
  );
}

// ─── Balance summary card (top of screen) ────────────────────────────────────
function BalanceCard({ balance, loading }: { balance?: LeaveBalanceSummary; loading?: boolean }) {
  if (!balance) {
    if (!loading) return null;
    return (
      <View style={bs.card}>
        <View style={bs.headRow}>
          <View style={{ gap: 8 }}>
            <Skeleton width={90} height={9} />
            <Skeleton width={110} height={28} />
          </View>
          <View style={{ alignItems: 'flex-end', gap: 8 }}>
            <Skeleton width={54} height={9} />
            <Skeleton width={70} height={16} />
          </View>
        </View>
        <View style={[bs.breakdown, { borderTopWidth: 1, borderTopColor: '#EEF2F1' }]}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={bs.bcol}>
              <Skeleton width={40} height={9} />
              <Skeleton width={30} height={12} style={{ marginTop: 6 }} />
            </View>
          ))}
        </View>
      </View>
    );
  }
  if (!balance.hasConfiguredProfile) {
    return (
      <View style={bs.card}>
        <Text style={bs.noPolicyTitle}>No allowance policy set</Text>
        <Text style={bs.noPolicySub}>
          Your agency hasn&apos;t configured an accrual policy yet, so requests aren&apos;t limited by a balance.
        </Text>
      </View>
    );
  }
  const negative = balance.netUsableBalance < 0;
  const dh = balance.dailyHours;
  const caption = nextDayCaption(balance.netUsableBalance, dh);
  return (
    <View style={bs.card}>
      <View style={bs.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={bs.kicker}>Available to book</Text>
          <Text style={[bs.big, negative && { color: D.error }]}>{fmtLeaveDays(balance.netUsableBalance, dh)}</Text>
          {caption && <Text style={bs.caption}>{caption}</Text>}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={bs.kicker}>Accrued</Text>
          <Text style={bs.mid}>{fmtLeaveDays(balance.grossAvailable, dh)}</Text>
          {balance.ceilingApplied && balance.balanceCeilingHours != null && (
            <Text style={bs.cap}>capped at {fmtLeaveDays(balance.balanceCeilingHours, dh)}</Text>
          )}
        </View>
      </View>
      <View style={bs.breakdown}>
        {([
          ['Carried over', fmtLeaveDays(balance.carriedOverHours, dh)],
          ['Accrued', fmtLeaveDays(balance.accruedToDate, dh)],
          ['Taken', `−${fmtLeaveDays(balance.approvedTaken, dh)}`],
          ['Pending', `−${fmtLeaveDays(balance.pendingScheduled, dh)}`],
        ] as [string, string][]).map(([k, v]) => (
          <View key={k} style={bs.bcol}>
            <Text style={bs.bk}>{k}</Text>
            <Text style={bs.bv}>{v}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const bs = StyleSheet.create({
  card: { backgroundColor: D.white, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: D.border, marginBottom: 16 },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  kicker: { fontSize: 10, fontWeight: '700', color: D.light, letterSpacing: 0.6, textTransform: 'uppercase' },
  big: { fontSize: 30, fontWeight: '800', color: D.text, marginTop: 3, letterSpacing: -0.6 },
  caption: { fontSize: 11, color: D.muted, marginTop: 4, fontWeight: '600' },
  mid: { fontSize: 16, fontWeight: '700', color: D.text, marginTop: 3 },
  cap: { fontSize: 10, color: D.warning, marginTop: 2 },
  breakdown: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, paddingTop: 13, borderTopWidth: 1, borderTopColor: '#EEF2F1' },
  bcol: { alignItems: 'center', flex: 1 },
  bk: { fontSize: 9, color: D.light, letterSpacing: 0.4, textTransform: 'uppercase' },
  bv: { fontSize: 12, fontWeight: '700', color: D.text, marginTop: 3 },
  noPolicyTitle: { fontSize: 13, fontWeight: '700', color: D.text },
  noPolicySub: { fontSize: 12, color: D.muted, marginTop: 4, lineHeight: 17 },
});

// ─── Screen ─────────────────────────────────────────────────────────────────
export default function LeaveScreen() {
  const router = useRouter();
  const qc = useQueryClient();

  const { data: requests = [], isLoading, error, refetch } = useQuery<LeaveRequest[]>({
    queryKey: ['leave-requests'],
    queryFn: getLeaveRequests,
    staleTime: 30_000,
  });
  const { data: balance, isLoading: balanceLoading } = useQuery<LeaveBalanceSummary>({
    queryKey: ['leave-balance'],
    queryFn: getLeaveBalance,
    staleTime: 30_000,
  });

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ startDate: '', endDate: '' });
  const [formError, setFormError] = useState('');
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: { startDate: string; endDate: string }) => createLeaveRequest(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave-requests'] });
      qc.invalidateQueries({ queryKey: ['leave-balance'] });
      closeModal();
    },
    onError: (err) => setFormError(apiErrorMessage(err, 'Failed to submit request')),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelLeaveRequest(id),
    onMutate: (id: string) => setWithdrawingId(id),
    onSettled: () => setWithdrawingId(null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave-requests'] });
      qc.invalidateQueries({ queryKey: ['leave-balance'] });
    },
  });

  function closeModal() {
    setShowModal(false);
    setForm({ startDate: '', endDate: '' });
    setFormError('');
  }

  // ── projected duration / balance for the form ──
  const projection = useMemo(() => {
    const ready =
      isYmd(form.startDate) && isYmd(form.endDate) && new Date(form.endDate) >= new Date(form.startDate);
    if (!ready) return null;
    const days = weekdaysInRange(form.startDate, form.endDate);
    const cost = round1(days * (balance?.dailyHours ?? 7.5));
    const configured = !!balance?.hasConfiguredProfile;
    const startBalance = configured ? balance!.netUsableBalance : null;
    const endBalance = startBalance != null ? round1(startBalance - cost) : null;
    return { days, cost, configured, startBalance, endBalance };
  }, [form.startDate, form.endDate, balance]);

  function handleSubmit() {
    setFormError('');
    if (!isYmd(form.startDate) || !isYmd(form.endDate)) {
      setFormError('Choose a start and end date.');
      return;
    }
    if (new Date(form.endDate) < new Date(form.startDate)) {
      setFormError('The end date must be on or after the start date.');
      return;
    }
    createMutation.mutate({ startDate: form.startDate, endDate: form.endDate });
  }

  const statusColor = (status: LeaveRequest['status']) =>
    status === 'PENDING' ? D.warning
      : status === 'APPROVED' ? D.success
      : status === 'REJECTED' ? D.error
      : D.muted;

  const statusIcon = (status: LeaveRequest['status']) => {
    const c = statusColor(status);
    switch (status) {
      case 'PENDING': return <Clock size={15} color={c} weight="bold" />;
      case 'APPROVED': return <CheckCircle size={15} color={c} weight="fill" />;
      case 'REJECTED': return <XCircle size={15} color={c} weight="fill" />;
      default: return <X size={15} color={c} weight="bold" />;
    }
  };

  const canSubmit =
    isYmd(form.startDate) && isYmd(form.endDate) &&
    new Date(form.endDate) >= new Date(form.startDate) &&
    !createMutation.isPending;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.6 }]}
          hitSlop={8}
        >
          <ArrowLeft size={20} color={D.text} weight="bold" />
        </Pressable>
        <Text style={s.title}>Time Off</Text>
        <Pressable
          style={({ pressed }) => [s.addBtn, pressed && { opacity: 0.85 }]}
          onPress={() => setShowModal(true)}
          accessibilityRole="button"
          accessibilityLabel="Request time off"
        >
          <Plus size={20} color={D.white} weight="bold" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={D.emerald} />}
      >
        <BalanceCard balance={balance} loading={balanceLoading} />

        {error && (
          <View style={s.loadError}><Text style={s.loadErrorTxt}>Couldn&apos;t load your requests. Pull to refresh.</Text></View>
        )}

        {isLoading ? (
          <View style={s.list}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={s.reqCard}>
                <View style={s.reqTop}>
                  <View style={{ flex: 1, gap: 8 }}>
                    <Skeleton width={80} height={10} />
                    <Skeleton width="65%" height={15} />
                  </View>
                  <Skeleton width={82} height={24} radius={12} />
                </View>
                <View style={[s.reqMetaRow, { marginTop: 12 }]}>
                  <Skeleton width={54} height={11} />
                  <Skeleton width={90} height={11} />
                </View>
              </View>
            ))}
          </View>
        ) : requests.length > 0 ? (
          <View style={s.list}>
            {requests.map((req) => (
              <View key={req.id} style={s.reqCard}>
                <View style={s.reqTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.reqType}>{LEAVE_TYPE}</Text>
                    <Text style={s.reqDates}>
                      {new Date(req.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      {'  –  '}
                      {new Date(req.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </Text>
                  </View>
                  <View style={[s.statusPill, { backgroundColor: `${statusColor(req.status)}1A` }]}>
                    {statusIcon(req.status)}
                    <Text style={[s.statusTxt, { color: statusColor(req.status) }]}>
                      {req.status.charAt(0) + req.status.slice(1).toLowerCase()}
                    </Text>
                  </View>
                </View>

                <View style={s.reqMetaRow}>
                  {req.totalHours > 0 && <Text style={s.reqMeta}>{fmtLeaveDays(req.totalHours, balance?.dailyHours)}</Text>}
                  <Text style={s.reqMeta}>
                    Requested {new Date(req.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </Text>
                </View>

                {req.status === 'REJECTED' && req.rejectionReason && (
                  <View style={s.rejectionBox}>
                    <Text style={s.rejectionLabel}>Rejection reason</Text>
                    <Text style={s.rejectionTxt}>{req.rejectionReason}</Text>
                  </View>
                )}

                {req.status === 'PENDING' && (
                  <Pressable
                    style={({ pressed }) => [s.withdrawBtn, pressed && { opacity: 0.6 }]}
                    onPress={() => cancelMutation.mutate(req.id)}
                    disabled={cancelMutation.isPending}
                  >
                    {withdrawingId === req.id ? (
                      <View style={s.withdrawBusy}>
                        <ActivityIndicator size="small" color={D.error} />
                        <Text style={s.withdrawTxt}>Withdrawing…</Text>
                      </View>
                    ) : (
                      <Text style={s.withdrawTxt}>Withdraw request</Text>
                    )}
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        ) : (
          <View style={s.empty}>
            <CalendarBlank size={44} color={D.light} weight="regular" />
            <Text style={s.emptyTitle}>No requests yet</Text>
            <Text style={s.emptySub}>Tap + to request time off.</Text>
          </View>
        )}
      </ScrollView>

      {/* ── Request Time Off ── */}
      <Modal visible={showModal} transparent animationType="slide" onRequestClose={closeModal}>
        <View style={s.modalRoot}>
          <View style={s.sheet}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>Request Time Off</Text>
              <Pressable onPress={closeModal} hitSlop={10} accessibilityLabel="Close">
                <X size={22} color={D.text} weight="bold" />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={s.sheetBody} showsVerticalScrollIndicator={false}>
              {/* Leave type — single type in this system */}
              <View style={s.field}>
                <Text style={s.fieldLabel}>Leave type</Text>
                <View style={[s.control, s.controlReadonly]}>
                  <Text style={s.controlValue}>{LEAVE_TYPE}</Text>
                </View>
              </View>

              <DateField
                label="From"
                value={form.startDate}
                onChange={(v) =>
                  setForm((f) => ({ ...f, startDate: v, endDate: f.endDate && f.endDate < v ? v : f.endDate }))
                }
              />
              <DateField
                label="To"
                value={form.endDate}
                min={form.startDate}
                onChange={(v) => setForm((f) => ({ ...f, endDate: v }))}
              />

              {/* Duration — computed */}
              <View style={s.field}>
                <Text style={s.fieldLabel}>Duration</Text>
                <View style={[s.control, s.controlReadonly]}>
                  <Text style={projection ? s.controlValue : s.controlPlaceholder}>
                    {projection
                      ? `${projection.days} working ${projection.days === 1 ? 'day' : 'days'}`
                      : 'Select dates'}
                  </Text>
                </View>
              </View>

              {/* Projected balance */}
              <Text style={s.sectionLabel}>Projected balance</Text>
              <View style={s.balancePanel}>
                {projection?.configured ? (
                  <>
                    <View style={s.balRow}>
                      <Text style={s.balKey}>Current balance</Text>
                      <Text style={s.balVal}>{fmtLeaveDays(projection.startBalance!, balance?.dailyHours)}</Text>
                    </View>
                    <View style={s.balRow}>
                      <Text style={s.balKey}>This request</Text>
                      <Text style={[s.balVal, { color: D.muted }]}>−{fmtLeaveDays(projection.cost, balance?.dailyHours)}</Text>
                    </View>
                    <View style={[s.balRow, s.balRowTotal]}>
                      <Text style={s.balKeyTotal}>Balance after</Text>
                      <Text style={[s.balValTotal, projection.endBalance! < 0 && { color: D.error }]}>
                        {fmtLeaveDays(projection.endBalance!, balance?.dailyHours)}
                      </Text>
                    </View>
                  </>
                ) : projection ? (
                  <Text style={s.balMuted}>No allowance policy set — this request isn&apos;t limited by a balance.</Text>
                ) : (
                  <Text style={s.balMuted}>Pick your dates to see the projected balance.</Text>
                )}
              </View>

              {formError ? (
                <View style={s.formError}><Text style={s.formErrorTxt}>{formError}</Text></View>
              ) : null}
            </ScrollView>

            <View style={s.sheetFooter}>
              <Pressable style={s.secondaryBtn} onPress={closeModal}>
                <Text style={s.secondaryBtnTxt}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[s.primaryBtn, !canSubmit && s.primaryBtnDisabled]}
                onPress={handleSubmit}
                disabled={!canSubmit}
              >
                {createMutation.isPending ? (
                  <View style={s.primaryBtnBusy}>
                    <ActivityIndicator size="small" color={D.white} />
                    <Text style={s.primaryBtnTxt}>Submitting…</Text>
                  </View>
                ) : (
                  <Text style={s.primaryBtnTxt}>Submit Request</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: D.bg },
  scroll: { paddingHorizontal: 16, paddingBottom: 40 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
  },
  iconBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: D.white, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: D.border },
  title: { fontSize: 20, fontWeight: '700', color: D.text },
  addBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: D.emerald, alignItems: 'center', justifyContent: 'center' },

  loadError: { backgroundColor: D.errorBg, borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: D.errorBorder },
  loadErrorTxt: { color: D.error, fontSize: 13 },

  // Request list
  list: { gap: 12 },
  reqCard: { backgroundColor: D.white, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: D.border },
  reqTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  reqType: { fontSize: 11, fontWeight: '700', color: D.emerald, letterSpacing: 0.3, textTransform: 'uppercase' },
  reqDates: { fontSize: 15, fontWeight: '700', color: D.text, marginTop: 3 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5 },
  statusTxt: { fontSize: 11, fontWeight: '700' },
  reqMetaRow: { flexDirection: 'row', gap: 14, marginTop: 8 },
  reqMeta: { fontSize: 12, color: D.muted },
  rejectionBox: { backgroundColor: '#FEF3C7', borderRadius: 8, padding: 10, marginTop: 10 },
  rejectionLabel: { fontSize: 10, fontWeight: '700', color: '#78350F', letterSpacing: 0.4, textTransform: 'uppercase' },
  rejectionTxt: { fontSize: 12, color: '#78350F', marginTop: 3 },
  withdrawBtn: { alignSelf: 'flex-start', marginTop: 10 },
  withdrawBusy: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  withdrawTxt: { fontSize: 13, fontWeight: '600', color: D.error },

  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 64 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: D.text, marginTop: 14 },
  emptySub: { fontSize: 13, color: D.muted, marginTop: 4 },

  // Sheet
  modalRoot: { flex: 1, backgroundColor: 'rgba(13,21,20,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: D.white, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '92%' },
  sheetHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#EEF2F1',
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: D.text, letterSpacing: -0.3 },
  sheetBody: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8 },
  sheetFooter: {
    flexDirection: 'row', gap: 12, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 26,
    borderTopWidth: 1, borderTopColor: '#EEF2F1',
  },

  // Form controls
  field: { marginBottom: 16 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: D.muted, letterSpacing: 0.3, marginBottom: 7, textTransform: 'uppercase' },
  control: {
    minHeight: 46, borderWidth: 1, borderColor: D.inputBorder, borderRadius: 12,
    paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: D.white,
  },
  controlReadonly: { backgroundColor: '#F3F5F5', borderColor: '#E7ECEB' },
  controlValue: { fontSize: 14, color: D.text, fontWeight: '500' },
  controlPlaceholder: { fontSize: 14, color: D.light },

  sectionLabel: { fontSize: 13, fontWeight: '800', color: D.text, marginTop: 4, marginBottom: 10 },
  balancePanel: { backgroundColor: '#F3F7F6', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#E3EDEB' },
  balRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  balRowTotal: { marginTop: 4, paddingTop: 9, borderTopWidth: 1, borderTopColor: '#DCE7E5' },
  balKey: { fontSize: 13, color: D.muted },
  balVal: { fontSize: 13, fontWeight: '700', color: D.text },
  balKeyTotal: { fontSize: 13, fontWeight: '700', color: D.text },
  balValTotal: { fontSize: 16, fontWeight: '800', color: D.emerald },
  balMuted: { fontSize: 12.5, color: D.muted, lineHeight: 18 },

  formError: { backgroundColor: D.errorBg, borderRadius: 10, padding: 11, marginTop: 4, borderWidth: 1, borderColor: D.errorBorder },
  formErrorTxt: { color: D.error, fontSize: 13 },

  secondaryBtn: { flex: 1, height: 48, borderRadius: 14, borderWidth: 1, borderColor: D.border, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnTxt: { fontSize: 15, fontWeight: '700', color: D.text },
  primaryBtn: { flex: 1.4, height: 48, borderRadius: 14, backgroundColor: D.emerald, alignItems: 'center', justifyContent: 'center' },
  primaryBtnDisabled: { backgroundColor: '#B9C9C6' },
  primaryBtnBusy: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  primaryBtnTxt: { fontSize: 15, fontWeight: '700', color: D.white },
});
