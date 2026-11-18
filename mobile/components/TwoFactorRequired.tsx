import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, Linking, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShieldCheck } from 'phosphor-react-native';
import { authClient, authErrorMessage } from '../services/authClient';
import { useAuthStore } from '../store/authStore';
import { D } from '../constants/theme';

type Step = 'password' | 'add' | 'codes';

/**
 * HR and managers must turn on two-step verification before the API will
 * serve them anything. On a phone the authenticator app is usually on the same
 * device, so we offer "Open authenticator app" (otpauth:// link) and the key
 * to type in, instead of a QR code.
 */
export function TwoFactorRequired() {
  const retrySync = useAuthStore((s) => s.retrySync);
  const logout = useAuthStore((s) => s.logout);
  const [step, setStep] = useState<Step>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [uri, setUri] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const secret = (uri.match(/[?&]secret=([^&]+)/)?.[1] ?? '').replace(/(.{4})/g, '$1 ').trim();

  async function start() {
    setBusy(true); setError(null);
    const { data, error: err } = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (err || !data || !('totpURI' in data)) { setError(authErrorMessage(err, 'Could not start set-up.')); return; }
    setUri(data.totpURI);
    setBackupCodes(data.backupCodes);
    setPassword('');
    setStep('add');
  }

  async function confirm() {
    setBusy(true); setError(null);
    const { error: err } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, '') });
    setBusy(false);
    if (err) { setError('That code is not right. Check the time on your phone and try the newest code.'); return; }
    setStep('codes');
  }

  return (
    <SafeAreaView style={s.root}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.card}>
            <ShieldCheck size={36} color={D.emerald} weight="fill" />
            <Text style={s.title} accessibilityRole="header">Turn on two-step verification</Text>
            <Text style={s.body}>
              Because you can see staff records, your account needs a code from an authenticator app as well as your password.
            </Text>

            {error && <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text>}

            {step === 'password' && (
              <>
                <Text style={s.label}>Your password</Text>
                <TextInput
                  accessibilityLabel="Your password" style={s.input} secureTextEntry autoCapitalize="none"
                  value={password} onChangeText={setPassword} onSubmitEditing={start} returnKeyType="next"
                />
                <Primary label="Continue" busy={busy} disabled={!password} onPress={start} />
              </>
            )}

            {step === 'add' && (
              <>
                <Text style={s.body}>1. Add ShiftGO to an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).</Text>
                <Pressable accessibilityRole="button" style={s.secondary} onPress={() => Linking.openURL(uri).catch(() => setError('No authenticator app found. Type the key below into your app instead.'))}>
                  <Text style={s.secondaryTxt}>Open authenticator app</Text>
                </Pressable>
                <Text style={s.label}>Or type this key</Text>
                <Text selectable style={s.key}>{secret}</Text>
                <Text style={[s.body, { marginTop: 16 }]}>2. Enter the 6-digit code the app shows.</Text>
                <TextInput
                  accessibilityLabel="6-digit code" style={s.input} keyboardType="number-pad" maxLength={7}
                  textContentType="oneTimeCode" value={code} onChangeText={setCode} onSubmitEditing={confirm}
                />
                <Primary label="Turn on" busy={busy} disabled={code.replace(/\s/g, '').length !== 6} onPress={confirm} />
              </>
            )}

            {step === 'codes' && (
              <>
                <Text style={s.body}>
                  Two-step verification is on. Write down or screenshot these backup codes — each one signs you in once if you lose your phone.
                </Text>
                <View style={s.codes} accessibilityLabel="Backup codes">
                  {backupCodes.map((c) => <Text selectable key={c} style={s.codeTxt}>{c}</Text>)}
                </View>
                <Primary label="I've saved them" onPress={retrySync} />
              </>
            )}

            <Pressable accessibilityRole="button" onPress={logout} style={s.signOut} hitSlop={8}>
              <Text style={s.signOutTxt}>Sign out</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Primary({ label, onPress, busy, disabled }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button" accessibilityState={{ disabled: !!(busy || disabled), busy: !!busy }}
      onPress={onPress} disabled={busy || disabled} style={[s.primary, (busy || disabled) && { opacity: 0.6 }]}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryTxt}>{label}</Text>}
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: D.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  card: { backgroundColor: D.white, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: D.border },
  title: { fontSize: 20, fontWeight: '700', color: D.text, marginTop: 12 },
  body: { fontSize: 14, color: D.muted, marginTop: 8, lineHeight: 20 },
  label: { fontSize: 12, fontWeight: '600', color: D.muted, marginTop: 18, marginBottom: 8 },
  input: {
    backgroundColor: D.inputBg, borderWidth: 1.5, borderColor: D.inputBorder, borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 14, fontSize: 16, color: D.text, marginTop: 8,
  },
  key: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 15, color: D.text, backgroundColor: D.inputBg, padding: 12, borderRadius: 12 },
  error: { marginTop: 14, color: D.error, backgroundColor: D.errorBg, borderColor: D.errorBorder, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 13 },
  primary: { marginTop: 20, backgroundColor: D.emerald, borderRadius: 14, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  primaryTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondary: { marginTop: 12, borderRadius: 14, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: D.emerald },
  secondaryTxt: { color: D.emerald, fontSize: 15, fontWeight: '600' },
  codes: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14, backgroundColor: D.inputBg, borderRadius: 12, padding: 12 },
  codeTxt: { width: '50%', fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 15, color: D.text, paddingVertical: 4 },
  signOut: { alignSelf: 'center', marginTop: 20, minHeight: 44, justifyContent: 'center' },
  signOutTxt: { color: D.muted, fontSize: 14, fontWeight: '600' },
});
