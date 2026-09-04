import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView,
  ActivityIndicator, Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Envelope, Lock, Eye, EyeSlash, ArrowRight, ArrowLeft,
  ShieldCheck, CheckSquare, Square,
} from 'phosphor-react-native';
import { useSignIn } from '@clerk/clerk-expo';
import { registerForPushNotifications } from '../../services/pushNotifications';
import { D } from '../../constants/theme';

// ─── Tokens ───────────────────────────────────────────────────────────────────

// Clerk instance password policy minimum (User & Authentication → Password).
const MIN_PASSWORD_LENGTH = 8;

type Step = 'credentials' | 'code' | 'forgot' | 'reset';
type FocusField = 'email' | 'pw' | 'code' | 'newPw' | null;
type PendingFactor =
  | 'first-email'
  | 'second-email'
  | 'second-phone'
  | 'second-totp'
  | 'second-backup'
  | null;

// ─── Input Field ──────────────────────────────────────────────────────────────
function Field({
  label, icon, placeholder, value, onChangeText,
  secure, showToggle, onToggle, shown,
  keyboardType, returnKeyType, onSubmitEditing, focused, onFocus, onBlur,
}: {
  label: string;
  icon: React.ReactNode;
  placeholder: string;
  value: string;
  onChangeText: (t: string) => void;
  secure?: boolean;
  showToggle?: boolean;
  onToggle?: () => void;
  shown?: boolean;
  keyboardType?: any;
  returnKeyType?: any;
  onSubmitEditing?: () => void;
  focused?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  return (
    <View style={f.wrap}>
      <Text style={f.label}>{label}</Text>
      <View style={[f.inputRow, focused && f.inputFocused]}>
        <View style={f.iconBox}>{icon}</View>
        <TextInput
          style={f.input}
          placeholder={placeholder}
          placeholderTextColor={D.light}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secure && !shown}
          autoCapitalize="none"
          keyboardType={keyboardType ?? 'default'}
          returnKeyType={returnKeyType ?? 'next'}
          onSubmitEditing={onSubmitEditing}
          onFocus={onFocus}
          onBlur={onBlur}
        />
        {showToggle && (
          <Pressable onPress={onToggle} style={f.toggle}>
            {shown
              ? <EyeSlash size={18} color={D.muted} weight="regular" />
              : <Eye size={18} color={D.muted} weight="regular" />}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const f = StyleSheet.create({
  wrap: { marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '600', color: D.muted, marginBottom: 8, letterSpacing: 0.2 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: D.inputBg, borderWidth: 1.5, borderColor: D.inputBorder,
    borderRadius: 14, overflow: 'hidden',
  },
  inputFocused: { borderColor: D.inputFocus, backgroundColor: D.white },
  iconBox: { paddingLeft: 14, paddingRight: 4 },
  input: { flex: 1, paddingVertical: 14, paddingHorizontal: 10, fontSize: 15, color: D.text },
  toggle: { paddingHorizontal: 14, paddingVertical: 14 },
});

const CARD_COPY: Record<Step, { title: string; sub: (email: string) => string }> = {
  credentials: { title: 'Welcome back', sub: () => 'Sign in to your account' },
  code: { title: 'Check your email', sub: (e) => `Enter the code we sent to ${e || 'your email'}` },
  forgot: { title: 'Reset your password', sub: () => "Enter your email and we'll send a reset code" },
  reset: { title: 'Set a new password', sub: (e) => `Enter the code sent to ${e || 'your email'} and choose a new password` },
};

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function LoginScreen() {
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [code, setCode]               = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [step, setStep]               = useState<Step>('credentials');
  const [error, setError]             = useState<string | null>(null);
  const [notice, setNotice]           = useState<string | null>(null);
  const [loading, setLoading]         = useState(false);
  const [pwVisible, setPwVisible]     = useState(false);
  const [newPwVisible, setNewPwVisible] = useState(false);
  const [remember, setRemember]       = useState(false);
  const [focusedField, setFocusedField] = useState<FocusField>(null);
  const [pendingFactor, setPendingFactor] = useState<PendingFactor>(null);
  const { signIn, setActive, isLoaded } = useSignIn();

  async function completeSignIn(sessionId: string) {
    await setActive!({ session: sessionId });
    try { await registerForPushNotifications(); } catch { /* non-critical */ }
  }

  function clearBanners() {
    setError(null);
    setNotice(null);
  }

  /**
   * After a correct password, Clerk may still require a first- or second-factor
   * step (new device, "verify at sign-in" instance setting, or real MFA).
   * Prepares whichever factor is available and returns which one is pending,
   * or null if this app can't complete it.
   */
  async function beginChallenge(result: Awaited<ReturnType<NonNullable<typeof signIn>['create']>>): Promise<PendingFactor> {
    if (!signIn) return null;
    const targetEmail = email.trim().toLowerCase();

    if (result.status === 'needs_first_factor') {
      const f = result.supportedFirstFactors?.find((x) => x.strategy === 'email_code');
      if (!f) return null;
      await signIn.prepareFirstFactor({ strategy: 'email_code', emailAddressId: (f as { emailAddressId: string }).emailAddressId });
      setNotice(`We've emailed a verification code to ${targetEmail}.`);
      return 'first-email';
    }

    if (result.status === 'needs_second_factor') {
      const factors = result.supportedSecondFactors ?? [];
      const emailF = factors.find((x) => x.strategy === 'email_code');
      const phoneF = factors.find((x) => x.strategy === 'phone_code');
      const totpF = factors.find((x) => x.strategy === 'totp');
      const backupF = factors.find((x) => x.strategy === 'backup_code');

      if (emailF) {
        await signIn.prepareSecondFactor({ strategy: 'email_code', emailAddressId: (emailF as { emailAddressId?: string }).emailAddressId });
        setNotice(`We've emailed a verification code to ${targetEmail}.`);
        return 'second-email';
      }
      if (phoneF) {
        await signIn.prepareSecondFactor({ strategy: 'phone_code', phoneNumberId: (phoneF as { phoneNumberId?: string }).phoneNumberId });
        setNotice("We've texted a verification code to your phone.");
        return 'second-phone';
      }
      if (totpF) {
        setNotice('Enter the 6-digit code from your authenticator app.');
        return 'second-totp';
      }
      if (backupF) {
        setNotice('Enter one of your backup codes.');
        return 'second-backup';
      }
      return null;
    }

    return null;
  }

  async function handleLogin() {
    if (!isLoaded) return;
    if (!email || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setLoading(true);
    clearBanners();
    try {
      const result = await signIn.create({ identifier: email.trim().toLowerCase(), password });

      if (result.status === 'complete' && result.createdSessionId) {
        await completeSignIn(result.createdSessionId);
        return;
      }

      const pending = await beginChallenge(result);
      if (pending) {
        setPendingFactor(pending);
        setCode('');
        setStep('code');
      } else {
        setError(`This account needs a verification step this app can't complete yet (${result.status}). Please sign in on the web.`);
      }
    } catch (e: any) {
      setError(e.errors?.[0]?.longMessage ?? e.errors?.[0]?.message ?? 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResendLoginCode() {
    if (!isLoaded || !signIn || loading) return;
    setLoading(true);
    clearBanners();
    try {
      const f = signIn.supportedFirstFactors?.find((x) => x.strategy === 'email_code');
      if (pendingFactor === 'first-email' && f) {
        await signIn.prepareFirstFactor({ strategy: 'email_code', emailAddressId: (f as { emailAddressId: string }).emailAddressId });
        setNotice('A new code is on its way.');
      } else if (pendingFactor === 'second-email') {
        await signIn.prepareSecondFactor({ strategy: 'email_code' });
        setNotice('A new code is on its way.');
      } else if (pendingFactor === 'second-phone') {
        await signIn.prepareSecondFactor({ strategy: 'phone_code' });
        setNotice('A new code has been texted to you.');
      } else {
        setNotice('This method has no code to resend.');
      }
    } catch (e: any) {
      setError(e.errors?.[0]?.longMessage ?? e.errors?.[0]?.message ?? "Couldn't resend the code.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode() {
    if (!isLoaded || !signIn || !code.trim()) return;
    setLoading(true);
    clearBanners();
    const c = code.trim();
    try {
      let result;
      switch (pendingFactor) {
        case 'second-email':
          result = await signIn.attemptSecondFactor({ strategy: 'email_code', code: c });
          break;
        case 'second-phone':
          result = await signIn.attemptSecondFactor({ strategy: 'phone_code', code: c });
          break;
        case 'second-totp':
          result = await signIn.attemptSecondFactor({ strategy: 'totp', code: c });
          break;
        case 'second-backup':
          result = await signIn.attemptSecondFactor({ strategy: 'backup_code', code: c });
          break;
        case 'first-email':
        default:
          result = await signIn.attemptFirstFactor({ strategy: 'email_code', code: c });
      }
      if (result.status === 'complete' && result.createdSessionId) {
        await completeSignIn(result.createdSessionId);
      } else {
        setError('Verification incomplete. Please try again.');
      }
    } catch (e: any) {
      setError(e.errors?.[0]?.longMessage ?? e.errors?.[0]?.message ?? 'Invalid or expired code.');
    } finally {
      setLoading(false);
    }
  }

  // ── Password reset ──────────────────────────────────────────────────────────
  function openForgotPassword() {
    clearBanners();
    setCode('');
    setNewPassword('');
    setStep('forgot');
  }

  async function handleSendResetCode() {
    if (!isLoaded) return;
    const identifier = email.trim().toLowerCase();
    if (!identifier) {
      setError('Enter the email address for your account.');
      return;
    }
    setLoading(true);
    clearBanners();
    try {
      await signIn.create({ strategy: 'reset_password_email_code', identifier });
      setNotice(`We've emailed a reset code to ${identifier}.`);
      setStep('reset');
    } catch (e: any) {
      setError(e.errors?.[0]?.longMessage ?? e.errors?.[0]?.message ?? "Couldn't send a reset code. Check the email address.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword() {
    if (!isLoaded) return;
    if (!code.trim()) {
      setError('Enter the code from your email.');
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setLoading(true);
    clearBanners();
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code: code.trim(),
        password: newPassword,
      });
      if (result.status === 'complete' && result.createdSessionId) {
        await completeSignIn(result.createdSessionId);
      } else if (result.status === 'needs_second_factor') {
        setNotice('Password updated. Enter your two-factor code to finish.');
        setStep('code');
      } else {
        setError('Password reset incomplete. Please try again.');
      }
    } catch (e: any) {
      setError(e.errors?.[0]?.longMessage ?? e.errors?.[0]?.message ?? 'Invalid or expired code.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResendResetCode() {
    if (!isLoaded || loading) return;
    setLoading(true);
    clearBanners();
    try {
      await signIn.create({ strategy: 'reset_password_email_code', identifier: email.trim().toLowerCase() });
      setNotice('A new reset code is on its way.');
    } catch (e: any) {
      setError(e.errors?.[0]?.longMessage ?? e.errors?.[0]?.message ?? "Couldn't resend the code.");
    } finally {
      setLoading(false);
    }
  }

  function backToSignIn() {
    clearBanners();
    setCode('');
    setNewPassword('');
    setPendingFactor(null);
    setStep('credentials');
  }

  const codeCopy =
    pendingFactor === 'second-totp'
      ? { label: 'Authenticator code', placeholder: '6-digit code from your app' }
      : pendingFactor === 'second-backup'
      ? { label: 'Backup code', placeholder: 'One of your saved backup codes' }
      : pendingFactor === 'second-phone'
      ? { label: 'Verification code', placeholder: 'Code we texted you' }
      : { label: 'Verification code', placeholder: 'Code we emailed you' };

  const primary: Record<Step, { label: string; action: () => void }> = {
    credentials: { label: 'Sign In', action: handleLogin },
    code: { label: 'Verify', action: handleVerifyCode },
    forgot: { label: 'Send reset code', action: handleSendResetCode },
    reset: { label: 'Reset password & sign in', action: handleResetPassword },
  };
  const copy = CARD_COPY[step];

  return (
    <View style={s.root}>
      {/* Subtle top gradient arc */}
      <LinearGradient
        colors={[D.emeraldDark, D.emerald, 'transparent']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={s.topGrad}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={s.kav}
      >
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── Logo Section ── */}
          <View style={s.logoSection}>
            <View style={s.logoWrap}>
              <Image
                source={require('../../assets/icon.png')}
                style={s.logo}
                resizeMode="contain"
              />
            </View>
            <Text style={s.appName}>ShiftGO</Text>
            <Text style={s.tagline}>GPS-powered shift attendance</Text>
          </View>

          {/* ── Login Card ── */}
          <View style={s.card}>

            {step !== 'credentials' && (
              <Pressable onPress={backToSignIn} style={s.backRow} hitSlop={8}>
                <ArrowLeft size={15} color={D.emerald} weight="bold" />
                <Text style={s.backTxt}>Back to sign in</Text>
              </Pressable>
            )}

            <Text style={s.cardTitle}>{copy.title}</Text>
            <Text style={s.cardSub}>{copy.sub(email)}</Text>

            {/* Notice */}
            {notice && !error && (
              <View style={s.noticeBox}>
                <ShieldCheck size={14} color={D.successText} weight="fill" />
                <Text style={s.noticeTxt}>{notice}</Text>
              </View>
            )}

            {/* Error */}
            {error && (
              <View style={s.errorBox}>
                <ShieldCheck size={14} color={D.error} weight="fill" />
                <Text style={s.errorTxt}>{error}</Text>
              </View>
            )}

            {/* ── Fields per step ── */}
            {step === 'credentials' && (
              <>
                <Field
                  label="Email"
                  icon={<Envelope size={18} color={focusedField === 'email' ? D.emerald : D.light} weight="regular" />}
                  placeholder="you@company.com"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  returnKeyType="next"
                  focused={focusedField === 'email'}
                  onFocus={() => setFocusedField('email')}
                  onBlur={() => setFocusedField(null)}
                />

                <Field
                  label="Password"
                  icon={<Lock size={18} color={focusedField === 'pw' ? D.emerald : D.light} weight="regular" />}
                  placeholder="Enter your password"
                  value={password}
                  onChangeText={setPassword}
                  secure
                  showToggle
                  shown={pwVisible}
                  onToggle={() => setPwVisible(v => !v)}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  focused={focusedField === 'pw'}
                  onFocus={() => setFocusedField('pw')}
                  onBlur={() => setFocusedField(null)}
                />

                <View style={s.optionsRow}>
                  <Pressable style={s.rememberRow} onPress={() => setRemember(r => !r)}>
                    {remember
                      ? <CheckSquare size={18} color={D.emerald} weight="fill" />
                      : <Square size={18} color={D.light} weight="regular" />}
                    <Text style={s.rememberTxt}>Remember me</Text>
                  </Pressable>
                  <Pressable onPress={openForgotPassword} hitSlop={8}>
                    <Text style={s.forgotTxt}>Forgot password?</Text>
                  </Pressable>
                </View>
              </>
            )}

            {step === 'code' && (
              <>
                <Field
                  label={codeCopy.label}
                  icon={<ShieldCheck size={18} color={focusedField === 'code' ? D.emerald : D.light} weight="regular" />}
                  placeholder={codeCopy.placeholder}
                  value={code}
                  onChangeText={setCode}
                  keyboardType={pendingFactor === 'second-backup' ? 'default' : 'number-pad'}
                  returnKeyType="done"
                  onSubmitEditing={handleVerifyCode}
                  focused={focusedField === 'code'}
                  onFocus={() => setFocusedField('code')}
                  onBlur={() => setFocusedField(null)}
                />
                <Pressable onPress={handleResendLoginCode} disabled={loading} hitSlop={8} style={s.resendRow}>
                  <Text style={s.resendTxt}>Didn&apos;t get a code? Resend</Text>
                </Pressable>
              </>
            )}

            {step === 'forgot' && (
              <Field
                label="Email"
                icon={<Envelope size={18} color={focusedField === 'email' ? D.emerald : D.light} weight="regular" />}
                placeholder="you@company.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                returnKeyType="send"
                onSubmitEditing={handleSendResetCode}
                focused={focusedField === 'email'}
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField(null)}
              />
            )}

            {step === 'reset' && (
              <>
                <Field
                  label="Reset code"
                  icon={<ShieldCheck size={18} color={focusedField === 'code' ? D.emerald : D.light} weight="regular" />}
                  placeholder="6-digit code from your email"
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  returnKeyType="next"
                  focused={focusedField === 'code'}
                  onFocus={() => setFocusedField('code')}
                  onBlur={() => setFocusedField(null)}
                />
                <Field
                  label="New password"
                  icon={<Lock size={18} color={focusedField === 'newPw' ? D.emerald : D.light} weight="regular" />}
                  placeholder="Choose a strong password"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secure
                  showToggle
                  shown={newPwVisible}
                  onToggle={() => setNewPwVisible(v => !v)}
                  returnKeyType="done"
                  onSubmitEditing={handleResetPassword}
                  focused={focusedField === 'newPw'}
                  onFocus={() => setFocusedField('newPw')}
                  onBlur={() => setFocusedField(null)}
                />
                <Pressable onPress={handleResendResetCode} disabled={loading} hitSlop={8} style={s.resendRow}>
                  <Text style={s.resendTxt}>Didn't get a code? Resend</Text>
                </Pressable>
              </>
            )}

            {/* Primary Button */}
            <Pressable
              onPress={primary[step].action}
              disabled={loading || !isLoaded}
              style={({ pressed }) => [s.signInBtn, pressed && { opacity: 0.88 }, (loading || !isLoaded) && { opacity: 0.7 }]}
            >
              <LinearGradient
                colors={[D.emerald, D.emeraldLight]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={s.signInGrad}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <>
                      <Text style={s.signInTxt}>{primary[step].label}</Text>
                      <ArrowRight size={18} color="#fff" weight="bold" />
                    </>}
              </LinearGradient>
            </Pressable>

          </View>

          {/* ── Security Badge ── */}
          <View style={s.securityCard}>
            <View style={s.securityIcon}>
              <ShieldCheck size={18} color={D.emerald} weight="fill" />
            </View>
            <View>
              <Text style={s.securityTitle}>Your data is secure</Text>
              <Text style={s.securitySub}>Encrypted &amp; GDPR compliant</Text>
            </View>
          </View>

          {/* ── Footer ── */}
          <Text style={s.footer}>
            New to ShiftGO?{' '}
            <Text style={s.footerLink}>Contact your administrator</Text>
          </Text>

        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: D.bg },

  topGrad: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 280,
    borderBottomLeftRadius: 48,
    borderBottomRightRadius: 48,
  },

  kav: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },

  // Logo
  logoSection: { alignItems: 'center', paddingTop: 64, paddingBottom: 28 },
  logoWrap: {
    width: 88, height: 88, borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.30)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18, shadowRadius: 20, elevation: 10,
  },
  logo: { width: 60, height: 60, borderRadius: 16 },
  appName: { fontSize: 28, fontWeight: '800', color: D.white, letterSpacing: -0.5, marginBottom: 4 },
  tagline: { fontSize: 13, color: 'rgba(255,255,255,0.72)', fontWeight: '500' },

  // Card
  card: {
    backgroundColor: D.white, borderRadius: 28,
    padding: 24, marginBottom: 16,
    shadowColor: '#00534822', shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 1, shadowRadius: 32, elevation: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)',
  },
  cardTitle: { fontSize: 22, fontWeight: '700', color: D.text, letterSpacing: -0.3, marginBottom: 4 },
  cardSub: { fontSize: 14, color: D.muted, marginBottom: 22 },

  // Back link
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  backTxt: { fontSize: 13, fontWeight: '600', color: D.emerald },

  // Error
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: D.errorBg, borderRadius: 12, padding: 12,
    marginBottom: 16, borderWidth: 1, borderColor: D.errorBorder,
  },
  errorTxt: { fontSize: 13, color: D.error, fontWeight: '500', flex: 1 },

  // Notice
  noticeBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: D.successBg, borderRadius: 12, padding: 12,
    marginBottom: 16, borderWidth: 1, borderColor: D.successBorder,
  },
  noticeTxt: { fontSize: 13, color: D.successText, fontWeight: '500', flex: 1 },

  // Options row
  optionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rememberTxt: { fontSize: 13, color: D.muted, fontWeight: '500' },
  forgotTxt: { fontSize: 13, color: D.emerald, fontWeight: '600' },

  // Resend
  resendRow: { alignSelf: 'flex-start', marginTop: -4, marginBottom: 18 },
  resendTxt: { fontSize: 13, color: D.emerald, fontWeight: '600' },

  // Sign In
  signInBtn: { borderRadius: 14, overflow: 'hidden', marginBottom: 22, shadowColor: D.emerald, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 8 },
  signInGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16 },
  signInTxt: { fontSize: 16, fontWeight: '700', color: '#fff', letterSpacing: 0.2 },

  // Divider
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  dividerLine: { flex: 1, height: 1, backgroundColor: D.border },
  dividerTxt: { fontSize: 12, color: D.light, fontWeight: '500' },

  // Social
  socialRow: { flexDirection: 'row', gap: 12 },
  socialBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 13, borderRadius: 12,
    backgroundColor: D.inputBg, borderWidth: 1.5, borderColor: D.inputBorder,
  },
  socialTxt: { fontSize: 14, fontWeight: '600', color: D.text },

  // Security card
  securityCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: D.mintBg, borderRadius: 16, padding: 14,
    marginBottom: 20, borderWidth: 1, borderColor: D.mintBorder,
  },
  securityIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: 'rgba(0,95,86,0.1)', alignItems: 'center', justifyContent: 'center' },
  securityTitle: { fontSize: 13, fontWeight: '700', color: D.emerald, marginBottom: 2 },
  securitySub: { fontSize: 12, color: D.muted },

  // Footer
  footer: { fontSize: 13, color: D.muted, textAlign: 'center', lineHeight: 20 },
  footerLink: { color: D.emerald, fontWeight: '600' },
});
