import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  TextInput, Linking, Platform, Alert, KeyboardAvoidingView, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  ArrowLeft, ShieldCheck, ShieldWarning, Warning, ArrowSquareOut,
  FileArrowUp, FileText, CheckCircle,
} from 'phosphor-react-native';
import {
  getMyShareCode, updateMyShareCode, uploadShareCodeDocument, RIGHT_TO_WORK_URL,
} from '../../services/rightToWorkService';
import { apiErrorMessage } from '../../services/api';
import { ShareCode, RightToWorkStatus } from '../../types';
import { D } from '../../constants/theme';

function fmtDate(iso?: string | null) {
  if (!iso) return 'Select date';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Strip everything but letters/digits and uppercase — the value we send/store. */
export function normaliseShareCode(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/** Readable "WE4 PWW 7D6" grouping for display, from any input. */
export function formatShareCode(raw: string): string {
  return (normaliseShareCode(raw).match(/.{1,3}/g) ?? []).join(' ');
}

const STATUS_META: Record<RightToWorkStatus, {
  grad: [string, string];
  icon: React.ReactNode;
  label: string;
  sub: string;
}> = {
  CURRENT: {
    grad: ['#005F56', '#0A7060'],
    icon: <ShieldCheck size={38} color="#fff" weight="fill" />,
    label: 'Up to date',
    sub: 'Your Right-to-Work share code is on file and current.',
  },
  STALE: {
    grad: ['#92400E', '#B45309'],
    icon: <Warning size={38} color="#fff" weight="fill" />,
    label: 'Needs updating',
    sub: 'Your share code is more than 90 days old. Generate a fresh one and update it here.',
  },
  MISSING: {
    grad: ['#7F1D1D', '#991B1B'],
    icon: <ShieldWarning size={38} color="#fff" weight="fill" />,
    label: 'Not provided',
    sub: 'Add your Right-to-Work share code so HR can verify your status.',
  },
};

export default function RightToWorkScreen() {
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<ShareCode>({
    queryKey: ['right-to-work'],
    queryFn: getMyShareCode,
    staleTime: 30_000,
  });

  const [code, setCode] = useState('');
  const [shareDate, setShareDate] = useState<Date | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Seed the form from the server record once it loads (readable grouping).
  React.useEffect(() => {
    if (data && !dirty) {
      setCode(data.code ? formatShareCode(data.code) : '');
      setShareDate(data.shareDate ? new Date(data.shareDate) : null);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      updateMyShareCode({
        code: normaliseShareCode(code),
        shareDate: (shareDate as Date).toISOString(),
      }),
    onSuccess: (updated) => {
      qc.setQueryData(['right-to-work'], updated);
      qc.invalidateQueries({ queryKey: ['right-to-work'] });
      setCode(updated.code ? formatShareCode(updated.code) : '');
      setDirty(false);
      setError(null);
    },
    // Surface the real reason (format / date / server), never a blanket message.
    onError: (e: any) => setError(apiErrorMessage(e, 'Could not save your share code.')),
  });

  const upload = useMutation({
    mutationFn: (file: { uri: string; name?: string | null }) => uploadShareCodeDocument(file),
    onSuccess: (updated) => {
      qc.setQueryData(['right-to-work'], updated);
      qc.invalidateQueries({ queryKey: ['right-to-work'] });
    },
    onError: (e: any) => Alert.alert('Upload failed', e.response?.data?.message ?? 'Could not upload the document.'),
  });

  // PDF documents only — this deliberately does NOT open the photo library.
  async function pickDocument() {
    // Loaded lazily: `expo-document-picker`'s native module throws at import time
    // when it isn't compiled into the running binary (dev build predating the
    // package). Degrade to a clear message instead of crashing the screen.
    let DocumentPicker: typeof import('expo-document-picker');
    try {
      DocumentPicker = require('expo-document-picker');
    } catch {
      Alert.alert(
        'Update required',
        'Uploading a document needs a newer build of the ShiftGO app. Please update the app, then try again. You can still save your share code above.',
      );
      return;
    }

    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) return;
    if (asset.mimeType && asset.mimeType !== 'application/pdf') {
      Alert.alert('PDF required', 'Right-to-Work proof must be a PDF document.');
      return;
    }
    upload.mutate({ uri: asset.uri, name: asset.name });
  }

  function onSave() {
    Keyboard.dismiss();
    setError(null);
    const cleaned = normaliseShareCode(code);
    if (!/^[A-Z0-9]{9}$/.test(cleaned)) {
      setError('Share code must be 9 letters and numbers (e.g. W3E W7A 5X2).');
      return;
    }
    if (!shareDate) {
      setError('Add the date you generated the share code.');
      return;
    }
    save.mutate();
  }

  if (isLoading || !data) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.center}><ActivityIndicator size="large" color={D.emerald} /></View>
      </SafeAreaView>
    );
  }

  const meta = STATUS_META[data.status];
  const canSave = !save.isPending && (dirty || data.status === 'MISSING');

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
        <Text style={s.title}>Right to Work</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {/* Status hero */}
        <LinearGradient colors={meta.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
          {meta.icon}
          <Text style={s.heroLabel}>{meta.label}</Text>
          <Text style={s.heroSub}>{meta.sub}</Text>
          {data.status === 'CURRENT' && data.daysUntilStale != null && (
            <Text style={s.heroMeta}>Due for renewal in {data.daysUntilStale} days</Text>
          )}
        </LinearGradient>

        {/* gov.uk link */}
        <Pressable
          onPress={() => Linking.openURL(RIGHT_TO_WORK_URL)}
          style={({ pressed }) => [s.linkRow, pressed && { opacity: 0.7 }]}
        >
          <View style={s.linkIcon}><ArrowSquareOut size={16} color={D.emerald} weight="bold" /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.linkTitle}>Get your share code</Text>
            <Text style={s.linkSub}>Opens gov.uk · “Prove your right to work to an employer”</Text>
          </View>
        </Pressable>

        {/* Form */}
        <Text style={s.sectionLabel}>SHARE CODE</Text>
        <View style={s.card}>
          <Text style={s.fieldLabel}>9-character share code — spaces optional</Text>
          <TextInput
            style={s.input}
            value={code}
            onChangeText={(t) => { setCode(t.toUpperCase()); setDirty(true); }}
            onBlur={() => setCode((c) => (c.trim() ? formatShareCode(c) : c))}
            placeholder="e.g. WE4 PWW 7D6"
            placeholderTextColor={D.light}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            returnKeyType="done"
            onSubmitEditing={onSave}
            maxLength={13}
          />

          <Text style={[s.fieldLabel, { marginTop: 14 }]}>Date you generated it</Text>
          <Pressable onPress={() => setShowPicker(true)} style={s.input}>
            <Text style={{ color: shareDate ? D.text : D.light, fontSize: 15 }}>
              {fmtDate(shareDate ? shareDate.toISOString() : null)}
            </Text>
          </Pressable>
          {showPicker && (
            <DateTimePicker
              value={shareDate ?? new Date()}
              mode="date"
              maximumDate={new Date()}
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={(event, selected) => {
                if (Platform.OS !== 'ios') setShowPicker(false);
                if (event.type === 'set' && selected) { setShareDate(selected); setDirty(true); }
              }}
            />
          )}
          {Platform.OS === 'ios' && showPicker && (
            <Pressable onPress={() => setShowPicker(false)} style={s.doneBtn}>
              <Text style={s.doneTxt}>Done</Text>
            </Pressable>
          )}

          {error && <Text style={s.errTxt}>{error}</Text>}

          <Pressable
            onPress={onSave}
            disabled={!canSave}
            style={({ pressed }) => [s.saveBtn, (!canSave || pressed) && { opacity: 0.6 }]}
          >
            <Text style={s.saveTxt}>{save.isPending ? 'Saving…' : 'Save share code'}</Text>
          </Pressable>
        </View>

        {/* Document */}
        <Text style={s.sectionLabel}>PROOF DOCUMENT</Text>
        <View style={s.card}>
          {data.hasDocument ? (
            <View style={s.docRow}>
              <View style={s.docIcon}><FileText size={18} color={D.emerald} weight="fill" /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.docName} numberOfLines={1}>{data.documentName ?? 'Document on file'}</Text>
                <View style={s.docBadge}>
                  <CheckCircle size={11} color={D.success} weight="fill" />
                  <Text style={s.docBadgeTxt}>Uploaded</Text>
                </View>
              </View>
            </View>
          ) : (
            <Text style={s.docHint}>
              Upload a PDF of your Right-to-Work check result so HR can keep it on file.
            </Text>
          )}

          <Pressable
            onPress={pickDocument}
            disabled={upload.isPending}
            style={({ pressed }) => [s.uploadBtn, (upload.isPending || pressed) && { opacity: 0.6 }]}
          >
            <FileArrowUp size={16} color={D.emerald} weight="bold" />
            <Text style={s.uploadTxt}>
              {upload.isPending ? 'Uploading…' : data.hasDocument ? 'Replace document' : 'Upload document'}
            </Text>
          </Pressable>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: D.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 18, paddingBottom: 24 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 12,
  },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: D.white, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: D.border },
  title: { fontSize: 20, fontWeight: '700', color: D.text },

  hero: { borderRadius: 20, padding: 20, alignItems: 'center', marginBottom: 14 },
  heroLabel: { fontSize: 18, fontWeight: '800', color: '#fff', marginTop: 10 },
  heroSub: { fontSize: 13, color: 'rgba(255,255,255,0.82)', textAlign: 'center', lineHeight: 19, marginTop: 6 },
  heroMeta: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.9)', marginTop: 10 },

  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: D.white, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: D.border, marginBottom: 22,
  },
  linkIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(0,95,86,0.09)', alignItems: 'center', justifyContent: 'center' },
  linkTitle: { fontSize: 14, fontWeight: '700', color: D.text },
  linkSub: { fontSize: 11, color: D.muted, marginTop: 1 },

  sectionLabel: { fontSize: 10, fontWeight: '700', color: D.light, letterSpacing: 1.2, marginBottom: 8, marginLeft: 4 },
  card: { backgroundColor: D.white, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: D.border, marginBottom: 22 },

  fieldLabel: { fontSize: 12, fontWeight: '600', color: D.muted, marginBottom: 6 },
  input: {
    borderWidth: 1.5, borderColor: D.inputBorder, backgroundColor: D.inputBg,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: D.text,
    justifyContent: 'center', minHeight: 46,
  },
  doneBtn: { alignSelf: 'flex-end', paddingHorizontal: 14, paddingVertical: 8, marginTop: 4 },
  doneTxt: { fontSize: 13, fontWeight: '700', color: D.emerald },
  errTxt: { fontSize: 12, color: D.error, marginTop: 10 },

  saveBtn: { marginTop: 16, backgroundColor: D.emerald, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  saveTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },

  docRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  docIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: 'rgba(0,95,86,0.09)', alignItems: 'center', justifyContent: 'center' },
  docName: { fontSize: 14, fontWeight: '600', color: D.text },
  docBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  docBadgeTxt: { fontSize: 11, fontWeight: '700', color: D.success },
  docHint: { fontSize: 13, color: D.muted, lineHeight: 19, marginBottom: 14 },

  uploadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1.5, borderColor: D.inputBorder, borderRadius: 12, paddingVertical: 12,
  },
  uploadTxt: { fontSize: 14, fontWeight: '700', color: D.emerald },
});
