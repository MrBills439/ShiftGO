import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Modal, TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, X } from 'phosphor-react-native';
import {
  getPrivacyNotice, getMyDeletionRequest, requestAccountDeletion, cancelAccountDeletion,
  PrivacyNotice, DeletionRequest,
} from '../../services/dataRightsService';
import { apiErrorMessage } from '../../services/api';
import { NoticeText } from '../../components/NoticeText';
import { D } from '../../constants/theme';

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export default function PrivacyScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: notice } = useQuery<PrivacyNotice>({ queryKey: ['privacy-notice'], queryFn: getPrivacyNotice });
  const { data: deletion, isLoading } = useQuery<DeletionRequest | null>({
    queryKey: ['my-deletion-request'], queryFn: getMyDeletionRequest,
  });
  const pending = deletion?.status === 'PENDING';

  async function submit() {
    setBusy(true);
    try {
      await requestAccountDeletion(reason.trim() || undefined);
      await qc.invalidateQueries({ queryKey: ['my-deletion-request'] });
      setDeleteOpen(false);
      setReason('');
      Alert.alert('Request sent', 'HR will contact you about deleting your account.');
    } catch (err) {
      Alert.alert('Could not send the request', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function confirmCancel() {
    Alert.alert('Cancel your request?', 'Your account will stay open.', [
      { text: 'Keep request', style: 'cancel' },
      {
        text: 'Cancel request',
        style: 'destructive',
        onPress: async () => {
          try {
            await cancelAccountDeletion();
            await qc.invalidateQueries({ queryKey: ['my-deletion-request'] });
          } catch (err) {
            Alert.alert('Could not cancel', apiErrorMessage(err));
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back"
          style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.65 }]}>
          <ArrowLeft size={20} color={D.text} weight="bold" />
        </Pressable>
        <Text style={s.title} accessibilityRole="header">Privacy & your data</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.content}>
        <View style={s.card}>
          <Text style={s.cardTitle}>Privacy notice</Text>
          <Text style={s.body}>
            {notice?.acknowledgedAt ? `You read the current notice on ${fmt(notice.acknowledgedAt)}.` : 'How your employer uses your information.'}
          </Text>
          <Pressable onPress={() => setNoticeOpen(true)} accessibilityRole="button" style={s.linkBtn}>
            <Text style={s.linkTxt}>Read privacy notice</Text>
          </Pressable>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Get a copy of your data</Text>
          <Text style={s.body}>
            Sign in to the ShiftGO web portal and go to Profile → Your data → Download my data.
            You can also ask HR for a copy.
          </Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Delete your account</Text>
          {isLoading ? <ActivityIndicator color={D.emerald} /> : (
            <>
              <Text style={s.body}>
                {pending && `You asked on ${fmt(deletion!.createdAt)}. HR will contact you.`}
                {deletion?.status === 'REJECTED' && `HR replied: ${deletion.resolutionNote}`}
                {deletion?.status === 'COMPLETED' && 'Your request was completed.'}
                {(!deletion || deletion.status === 'CANCELLED') &&
                  'HR will close your account and delete what they no longer need. By law some records, such as timesheets and right-to-work checks, are kept for a set time.'}
              </Text>
              {pending ? (
                <Pressable onPress={confirmCancel} accessibilityRole="button" style={s.linkBtn}>
                  <Text style={s.linkTxt}>Cancel request</Text>
                </Pressable>
              ) : deletion?.status !== 'COMPLETED' && (
                <Pressable onPress={() => setDeleteOpen(true)} accessibilityRole="button" style={[s.linkBtn, s.dangerBtn]}>
                  <Text style={[s.linkTxt, { color: D.error }]}>Request account deletion</Text>
                </Pressable>
              )}
            </>
          )}
        </View>
      </ScrollView>

      <Modal visible={noticeOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setNoticeOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: D.white }} edges={['top', 'bottom']}>
          <View style={s.sheetHeader}>
            <Text style={s.title}>Privacy notice</Text>
            <Pressable onPress={() => setNoticeOpen(false)} accessibilityRole="button" accessibilityLabel="Close" style={s.backBtn}>
              <X size={18} color={D.text} weight="bold" />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            {notice && <NoticeText text={notice.text} />}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={deleteOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDeleteOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: D.white }} edges={['top', 'bottom']}>
          <View style={s.sheetHeader}>
            <Text style={s.title}>Request account deletion</Text>
            <Pressable onPress={() => setDeleteOpen(false)} accessibilityRole="button" accessibilityLabel="Close" style={s.backBtn}>
              <X size={18} color={D.text} weight="bold" />
            </Pressable>
          </View>
          <View style={{ padding: 20, gap: 14 }}>
            <Text style={s.body}>
              HR will close your account and delete your contact details, photo, notifications, location points and DBS record.
            </Text>
            <Text style={s.label}>Reason (optional)</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              multiline
              maxLength={1000}
              style={s.input}
              accessibilityLabel="Reason (optional)"
              placeholder="Tell HR why, if you like"
              placeholderTextColor={D.light}
            />
            <Pressable onPress={submit} disabled={busy} accessibilityRole="button"
              style={({ pressed }) => [s.primary, (pressed || busy) && { opacity: 0.75 }]}>
              {busy ? <ActivityIndicator color={D.white} /> : <Text style={s.primaryTxt}>Send request to HR</Text>}
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: D.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: D.border },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: D.white, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: D.border },
  title: { fontSize: 17, fontWeight: '700', color: D.text },
  content: { padding: 18, gap: 14, paddingBottom: 40 },
  card: { backgroundColor: D.white, borderRadius: 16, borderWidth: 1, borderColor: D.border, padding: 16, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: D.text },
  body: { fontSize: 14, lineHeight: 21, color: D.muted },
  label: { fontSize: 12, fontWeight: '700', color: D.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  linkBtn: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  dangerBtn: {},
  linkTxt: { fontSize: 15, fontWeight: '700', color: D.emerald },
  input: { minHeight: 96, borderRadius: 12, borderWidth: 1, borderColor: D.border, padding: 12, fontSize: 15, color: D.text, textAlignVertical: 'top' },
  primary: { minHeight: 50, borderRadius: 14, backgroundColor: D.emerald, alignItems: 'center', justifyContent: 'center' },
  primaryTxt: { fontSize: 16, fontWeight: '700', color: D.white },
});
