import React, { useState } from 'react';
import { Modal, View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'phosphor-react-native';
import { getPrivacyNotice, acknowledgePrivacyNotice, PrivacyNotice } from '../services/dataRightsService';
import { NoticeText } from './NoticeText';
import { useAuthStore } from '../store/authStore';
import { D } from '../constants/theme';

/**
 * Full-screen privacy notice shown until the person acknowledges the current
 * version. If the notice can't be loaded the app is NOT blocked (offline staff
 * must still be able to clock in); it appears on a later launch.
 * Returns whether it is currently showing, so other popups can wait.
 */
export function PrivacyNoticeGate({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const logout = useAuthStore((s) => s.logout);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: notice } = useQuery<PrivacyNotice>({
    queryKey: ['privacy-notice'],
    queryFn: getPrivacyNotice,
    enabled,
    staleTime: 5 * 60_000,
  });

  const visible = enabled && !!notice && !notice.acknowledged;

  async function accept() {
    if (!notice) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await acknowledgePrivacyNotice(notice.version);
      qc.setQueryData(['privacy-notice'], updated);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        setError('The notice was just updated. Please read the latest version.');
        qc.invalidateQueries({ queryKey: ['privacy-notice'] });
      } else {
        setError('Could not save that. Check your connection and try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => {}}>
      <SafeAreaView style={st.screen} edges={['top', 'bottom']}>
        <View style={st.header}>
          <View style={st.icon}><ShieldCheck size={20} color={D.emerald} weight="regular" /></View>
          <View style={{ flex: 1 }}>
            <Text style={st.title} accessibilityRole="header">Before you continue</Text>
            <Text style={st.sub}>Please read how your information is used.</Text>
          </View>
        </View>
        <ScrollView contentContainerStyle={st.body}>
          {notice && <NoticeText text={notice.text} />}
        </ScrollView>
        <View style={st.footer}>
          {error && <Text style={st.error} accessibilityLiveRegion="polite">{error}</Text>}
          <Pressable
            onPress={accept}
            disabled={saving}
            accessibilityRole="button"
            style={({ pressed }) => [st.primary, (pressed || saving) && { opacity: 0.75 }]}
          >
            {saving ? <ActivityIndicator color={D.white} /> : <Text style={st.primaryTxt}>I have read this notice</Text>}
          </Pressable>
          <Pressable onPress={logout} accessibilityRole="button" style={st.secondary}>
            <Text style={st.secondaryTxt}>Sign out</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

export function usePrivacyNoticePending(enabled: boolean) {
  const { data } = useQuery<PrivacyNotice>({ queryKey: ['privacy-notice'], queryFn: getPrivacyNotice, enabled, staleTime: 5 * 60_000 });
  return enabled && !!data && !data.acknowledged;
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: D.white },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: D.border },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: D.mintBg, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: D.text },
  sub: { fontSize: 13, color: D.muted, marginTop: 2 },
  body: { padding: 20, paddingBottom: 32 },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, borderTopWidth: 1, borderTopColor: D.border, gap: 8 },
  error: { fontSize: 13, color: D.error },
  primary: { minHeight: 50, borderRadius: 14, backgroundColor: D.emerald, alignItems: 'center', justifyContent: 'center' },
  primaryTxt: { fontSize: 16, fontWeight: '700', color: D.white },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryTxt: { fontSize: 15, fontWeight: '600', color: D.muted },
});
