import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView,
  ActivityIndicator, Image, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Envelope, Lock, Eye, EyeSlash, ArrowRight,
  ShieldCheck, GoogleLogo, AppleLogo, CheckSquare, Square,
} from 'phosphor-react-native';
import { useAuthStore } from '../../store/authStore';
import { registerForPushNotifications } from '../../services/notificationService';

// ─── Tokens ───────────────────────────────────────────────────────────────────
const D = {
  bg: '#F4F6F5',
  emerald: '#005F56',
  emeraldDark: '#003D35',
  emeraldLight: '#0A7060',
  mint: '#52D6B5',
  mintBg: 'rgba(82,214,181,0.12)',
  mintBorder: 'rgba(82,214,181,0.25)',
  white: '#FFFFFF',
  text: '#0D1514',
  muted: '#607370',
  light: '#96AEAB',
  border: '#E2EDEB',
  inputBg: '#F8FAFA',
  inputBorder: '#DDE8E6',
  inputFocus: '#005F56',
  error: '#EF4444',
  errorBg: '#FEF2F2',
  errorBorder: '#FECACA',
};

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

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function LoginScreen() {
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [error, setError]         = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const [pwVisible, setPwVisible] = useState(false);
  const [remember, setRemember]   = useState(false);
  const [focusedField, setFocusedField] = useState<'email' | 'pw' | null>(null);
  const login = useAuthStore((s) => s.login);

  async function handleLogin() {
    if (!email || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'Login failed. Check your credentials.');
      setLoading(false);
      return;
    }
    try { await registerForPushNotifications(); } catch { /* non-critical */ }
    setLoading(false);
  }

  function handleForgotPassword() {
    Alert.alert('Forgot Password', 'Please contact your administrator to reset your password.');
  }

  function handleSocial(provider: string) {
    Alert.alert(`${provider} Login`, `${provider} sign-in is coming soon.`);
  }

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

            <Text style={s.cardTitle}>Welcome back</Text>
            <Text style={s.cardSub}>Sign in to your account</Text>

            {/* Error */}
            {error && (
              <View style={s.errorBox}>
                <ShieldCheck size={14} color={D.error} weight="fill" />
                <Text style={s.errorTxt}>{error}</Text>
              </View>
            )}

            {/* Fields */}
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

            {/* Remember me + Forgot password */}
            <View style={s.optionsRow}>
              <Pressable style={s.rememberRow} onPress={() => setRemember(r => !r)}>
                {remember
                  ? <CheckSquare size={18} color={D.emerald} weight="fill" />
                  : <Square size={18} color={D.light} weight="regular" />}
                <Text style={s.rememberTxt}>Remember me</Text>
              </Pressable>
              <Pressable onPress={handleForgotPassword}>
                <Text style={s.forgotTxt}>Forgot password?</Text>
              </Pressable>
            </View>

            {/* Sign In Button */}
            <Pressable
              onPress={handleLogin}
              disabled={loading}
              style={({ pressed }) => [s.signInBtn, pressed && { opacity: 0.88 }, loading && { opacity: 0.7 }]}
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
                      <Text style={s.signInTxt}>Sign In</Text>
                      <ArrowRight size={18} color="#fff" weight="bold" />
                    </>}
              </LinearGradient>
            </Pressable>

            {/* Divider */}
            <View style={s.dividerRow}>
              <View style={s.dividerLine} />
              <Text style={s.dividerTxt}>or continue with</Text>
              <View style={s.dividerLine} />
            </View>

            {/* Social Buttons */}
            <View style={s.socialRow}>
              <Pressable
                style={({ pressed }) => [s.socialBtn, pressed && { opacity: 0.75 }]}
                onPress={() => handleSocial('Google')}
              >
                <GoogleLogo size={20} color="#4285F4" weight="bold" />
                <Text style={s.socialTxt}>Google</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [s.socialBtn, pressed && { opacity: 0.75 }]}
                onPress={() => handleSocial('Apple')}
              >
                <AppleLogo size={20} color={D.text} weight="fill" />
                <Text style={s.socialTxt}>Apple</Text>
              </Pressable>
            </View>

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

  // Error
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: D.errorBg, borderRadius: 12, padding: 12,
    marginBottom: 16, borderWidth: 1, borderColor: D.errorBorder,
  },
  errorTxt: { fontSize: 13, color: D.error, fontWeight: '500', flex: 1 },

  // Options row
  optionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rememberTxt: { fontSize: 13, color: D.muted, fontWeight: '500' },
  forgotTxt: { fontSize: 13, color: D.emerald, fontWeight: '600' },

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
