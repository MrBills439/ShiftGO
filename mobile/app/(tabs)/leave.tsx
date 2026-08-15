import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, TextInput, Modal, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, CalendarBlank, CheckCircle, XCircle, Clock } from 'phosphor-react-native';
import { getLeaveRequests, createLeaveRequest, cancelLeaveRequest } from '../../services/leaveRequestService';
import { LeaveRequest } from '../../types';

const D = {
  bg: '#F4F6F5',
  emerald: '#005F56',
  white: '#FFFFFF',
  text: '#0D1514',
  muted: '#607370',
  light: '#96AEAB',
  border: '#E2EDEB',
  error: '#EF4444',
  success: '#10B981',
  warning: '#F59E0B',
};

export default function LeaveScreen() {
  const qc = useQueryClient();
  const { data: requests = [], isLoading, error } = useQuery<LeaveRequest[]>({
    queryKey: ['leave-requests'],
    queryFn: getLeaveRequests,
    staleTime: 30_000,
  });

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ startDate: '', endDate: '', reason: '' });
  const [formError, setFormError] = useState('');

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => createLeaveRequest(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave-requests'] });
      setShowModal(false);
      setForm({ startDate: '', endDate: '', reason: '' });
      setFormError('');
    },
    onError: (err: any) => {
      setFormError(err.response?.data?.message || 'Failed to create leave request');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelLeaveRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave-requests'] });
    },
  });

  const handleCreateLeave = () => {
    setFormError('');
    if (!form.startDate || !form.endDate || !form.reason) {
      setFormError('All fields are required');
      return;
    }

    if (new Date(form.endDate) < new Date(form.startDate)) {
      setFormError('End date must be after start date');
      return;
    }

    if (form.reason.length < 3) {
      setFormError('Reason must be at least 3 characters');
      return;
    }

    createMutation.mutate(form);
  };

  const statusColor = (status: LeaveRequest['status']) => {
    switch (status) {
      case 'PENDING': return D.warning;
      case 'APPROVED': return D.success;
      case 'REJECTED': return D.error;
      case 'CANCELLED': return D.muted;
      default: return D.muted;
    }
  };

  const statusIcon = (status: LeaveRequest['status']) => {
    switch (status) {
      case 'PENDING': return <Clock size={16} color={statusColor(status)} weight="bold" />;
      case 'APPROVED': return <CheckCircle size={16} color={statusColor(status)} weight="fill" />;
      case 'REJECTED': return <XCircle size={16} color={statusColor(status)} weight="fill" />;
      case 'CANCELLED': return <X size={16} color={statusColor(status)} weight="bold" />;
      default: return null;
    }
  };

  const canCancel = (req: LeaveRequest) => req.status === 'PENDING';

  if (isLoading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <ActivityIndicator size="large" color={D.emerald} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.title}>Leave Requests</Text>
            <Text style={s.subtitle}>Manage your time off</Text>
          </View>
          <Pressable style={s.addBtn} onPress={() => setShowModal(true)}>
            <Plus size={20} color={D.white} weight="bold" />
          </Pressable>
        </View>

        {error && (
          <View style={s.errorBox}>
            <Text style={s.errorTxt}>Failed to load leave requests</Text>
          </View>
        )}

        {/* Leave Requests List */}
        {requests.length > 0 ? (
          <View style={s.list}>
            {requests.map((req) => (
              <View key={req.id} style={s.card}>
                <View style={s.cardTop}>
                  <View style={{ flex: 1 }}>
                    <View style={s.statusRow}>
                      {statusIcon(req.status)}
                      <Text style={[s.status, { color: statusColor(req.status), marginLeft: 6 }]}>
                        {req.status.charAt(0) + req.status.slice(1).toLowerCase()}
                      </Text>
                    </View>
                    <Text style={s.dates}>
                      {new Date(req.startDate).toLocaleDateString()} – {new Date(req.endDate).toLocaleDateString()}
                    </Text>
                  </View>

                  {canCancel(req) && (
                    <Pressable
                      style={s.cancelBtn}
                      onPress={() => cancelMutation.mutate(req.id)}
                      disabled={cancelMutation.isPending}
                    >
                      <X size={16} color={D.error} weight="bold" />
                    </Pressable>
                  )}
                </View>

                <Text style={s.reason}>{req.reason}</Text>

                {req.status === 'REJECTED' && req.rejectionReason && (
                  <View style={s.rejectionBox}>
                    <Text style={s.rejectionLabel}>Rejection reason:</Text>
                    <Text style={s.rejectionTxt}>{req.rejectionReason}</Text>
                  </View>
                )}

                {req.reviewedAt && (
                  <Text style={s.reviewed}>
                    {req.status === 'APPROVED' ? 'Approved' : 'Reviewed'} on {new Date(req.reviewedAt).toLocaleDateString()}
                  </Text>
                )}
              </View>
            ))}
          </View>
        ) : (
          <View style={s.empty}>
            <CalendarBlank size={48} color={D.light} weight="regular" />
            <Text style={s.emptyTitle}>No leave requests yet</Text>
            <Text style={s.emptySub}>Request time off whenever you need it</Text>
          </View>
        )}
      </ScrollView>

      {/* Create Leave Modal */}
      <Modal visible={showModal} transparent animationType="slide">
        <SafeAreaView style={s.modalSafe}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Request Leave</Text>
              <Pressable onPress={() => setShowModal(false)}>
                <X size={24} color={D.text} weight="bold" />
              </Pressable>
            </View>

            {formError && <View style={s.formError}><Text style={s.formErrorTxt}>{formError}</Text></View>}

            <View style={s.form}>
              <View style={s.formGroup}>
                <Text style={s.label}>Start Date *</Text>
                <TextInput
                  style={s.input}
                  placeholder="YYYY-MM-DD"
                  value={form.startDate}
                  onChangeText={(v) => setForm({ ...form, startDate: v })}
                  placeholderTextColor={D.light}
                />
              </View>

              <View style={s.formGroup}>
                <Text style={s.label}>End Date *</Text>
                <TextInput
                  style={s.input}
                  placeholder="YYYY-MM-DD"
                  value={form.endDate}
                  onChangeText={(v) => setForm({ ...form, endDate: v })}
                  placeholderTextColor={D.light}
                />
              </View>

              <View style={s.formGroup}>
                <Text style={s.label}>Reason *</Text>
                <TextInput
                  style={[s.input, s.textarea]}
                  placeholder="Why do you need leave?"
                  value={form.reason}
                  onChangeText={(v) => setForm({ ...form, reason: v })}
                  placeholderTextColor={D.light}
                  multiline
                  numberOfLines={4}
                />
              </View>

              <View style={s.formActions}>
                <Pressable style={s.cancelBtnModal} onPress={() => setShowModal(false)}>
                  <Text style={s.cancelBtnTxt}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[s.submitBtn, createMutation.isPending && s.submitBtnDisabled]}
                  onPress={handleCreateLeave}
                  disabled={createMutation.isPending}
                >
                  <Text style={s.submitBtnTxt}>
                    {createMutation.isPending ? 'Creating...' : 'Request Leave'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: D.bg },
  scroll: { paddingHorizontal: 16, paddingBottom: 80 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 16 },
  title: { fontSize: 24, fontWeight: '700', color: D.text },
  subtitle: { fontSize: 13, color: D.muted, marginTop: 2 },
  addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: D.emerald, alignItems: 'center', justifyContent: 'center' },

  errorBox: { backgroundColor: '#FEE2E2', borderRadius: 8, padding: 12, marginBottom: 16 },
  errorTxt: { color: D.error, fontSize: 13 },

  list: { gap: 12 },
  card: { backgroundColor: D.white, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: D.border },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  status: { fontSize: 12, fontWeight: '600' },
  dates: { fontSize: 13, color: D.muted, marginTop: 4 },
  reason: { fontSize: 13, color: D.text, marginVertical: 8 },
  cancelBtn: { padding: 6 },
  rejectionBox: { backgroundColor: '#FEF3C7', borderRadius: 6, padding: 8, marginTop: 8 },
  rejectionLabel: { fontSize: 11, fontWeight: '600', color: '#78350F' },
  rejectionTxt: { fontSize: 12, color: '#78350F', marginTop: 2 },
  reviewed: { fontSize: 11, color: D.light, marginTop: 8 },

  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: D.text, marginTop: 16 },
  emptySub: { fontSize: 13, color: D.muted, marginTop: 4 },

  modalSafe: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { flex: 1, backgroundColor: D.white, marginTop: '20%', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: D.border },
  modalTitle: { fontSize: 18, fontWeight: '700', color: D.text },

  form: { marginTop: 20 },
  formGroup: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: D.text, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: D.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: D.text },
  textarea: { paddingVertical: 12, textAlignVertical: 'top' },
  formError: { backgroundColor: '#FEE2E2', borderRadius: 8, padding: 12, marginBottom: 12 },
  formErrorTxt: { color: D.error, fontSize: 13 },

  formActions: { flexDirection: 'row', gap: 12, marginTop: 24, marginBottom: 40 },
  cancelBtnModal: { flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: D.border, alignItems: 'center' },
  cancelBtnTxt: { fontSize: 14, fontWeight: '600', color: D.text },
  submitBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: D.emerald, alignItems: 'center' },
  submitBtnTxt: { fontSize: 14, fontWeight: '600', color: D.white },
  submitBtnDisabled: { opacity: 0.5 },
});
