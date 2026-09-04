import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView,
  Platform, ActivityIndicator, Image, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowLeft, User, Phone, CheckCircle } from 'phosphor-react-native';
import { completeOnboarding } from '../../services/profileService';
import { apiErrorMessage } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { D } from '../../constants/theme';

type Step = 'welcome' | 'name' | 'phone';
const STEPS: Step[] = ['welcome', 'name', 'phone'];

export default function OnboardingScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [step, setStep] = useState<Step>('welcome');
  const [name, setName] = useState(
    user?.name && user.name !== user.email ? user.name : ''
  );
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const idx = STEPS.indexOf(step);
  const nameValid = name.trim().length >= 2;

  function next() {
    setError(null);
    if (step === 'welcome') setStep('name');
    else if (step === 'name') {
      if (!nameValid) { setError('Please enter your name (at least 2 characters).'); return; }
      setStep('phone');
    }
  }

  function back() {
    setError(null);
    if (step === 'name') setStep('welcome');
    else if (step === 'phone') setStep('name');
  }

  async function finish() {
    if (!nameValid) { setStep('name'); setError('Please enter your name.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const updated = await completeOnboarding({
        name: name.trim(),
        phone: phone.trim() || undefined,
      });
      qc.setQueryData(['me'], updated);
      useAuthStore.setState({ user: updated });
      qc.invalidateQueries({ queryKey: ['me'] });
      router.replace('/(tabs)/clock');
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't save your details. Check your connection and try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={s.root}>
      <LinearGradient
        colors={[D.emeraldDark, D.emerald, 'transparent']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={s.topGrad}
      />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* progress dots */}
            <View style={s.dots}>
              {STEPS.map((st, i) => (
                <View key={st} style={[s.dot, i <= idx && s.dotOn, i === idx && s.dotActive]} />
              ))}
            </View>

            {step === 'welcome' && (
              <View style={s.card}>
                <View style={s.logoWrap}>
                  <Image source={require('../../assets/icon.png')} style={s.logo} resizeMode="contain" />
                </View>
                <Text style={s.h1}>Welcome to ShiftGO</Text>
                <Text style={s.body}>
                  Let&apos;s get your profile set up. It takes about a minute — you can update
                  everything later from your profile.
                </Text>
              </View>
            )}

            {step === 'name' && (
              <View style={s.card}>
                <View style={s.iconCircle}><User size={26} color={D.emerald} weight="regular" /></View>
                <Text style={s.h1}>What&apos;s your name?</Text>
                <Text style={s.body}>This is how you&apos;ll appear to your team and on the rota.</Text>
                <View style={s.field}>
                  <Text style={s.label}>Full name</Text>
                  <TextInput
                    style={s.input}
                    value={name}
                    onChangeText={setName}
                    placeholder="e.g. Jordan Smith"
                    placeholderTextColor={D.light}
                    autoCapitalize="words"
                    autoFocus
                    returnKeyType="next"
                    onSubmitEditing={next}
                  />
                </View>
              </View>
            )}

            {step === 'phone' && (
              <View style={s.card}>
                <View style={s.iconCircle}><Phone size={26} color={D.emerald} weight="regular" /></View>
                <Text style={s.h1}>Add a contact number</Text>
                <Text style={s.body}>
                  Your manager may need to reach you about a shift. This is optional — you can skip it.
                </Text>
                <View style={s.field}>
                  <Text style={s.label}>Phone number</Text>
                  <TextInput
                    style={s.input}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="+44 7700 900000"
                    placeholderTextColor={D.light}
                    keyboardType="phone-pad"
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={finish}
                  />
                </View>
                <View style={s.summary}>
                  <CheckCircle size={16} color={D.emerald} weight="fill" />
                  <Text style={s.summaryTxt}>Signed in as {name.trim() || user?.email}</Text>
                </View>
              </View>
            )}

            {error && (
              <View style={s.errorBox}><Text style={s.errorTxt}>{error}</Text></View>
            )}
          </ScrollView>

          {/* footer */}
          <View style={s.footer}>
            {step !== 'welcome' ? (
              <Pressable style={s.backBtn} onPress={back} disabled={submitting} hitSlop={8}>
                <ArrowLeft size={18} color={D.text} weight="bold" />
                <Text style={s.backTxt}>Back</Text>
              </Pressable>
            ) : <View style={{ width: 72 }} />}

            {step === 'phone' ? (
              <View style={s.footerRight}>
                <Pressable onPress={finish} disabled={submitting} hitSlop={8}>
                  <Text style={s.skipTxt}>{phone.trim() ? '' : 'Skip'}</Text>
                </Pressable>
                <Pressable
                  style={[s.primaryBtn, submitting && s.primaryBtnDisabled]}
                  onPress={finish}
                  disabled={submitting}
                >
                  {submitting
                    ? <ActivityIndicator color="#fff" />
                    : <><Text style={s.primaryTxt}>Finish</Text><ArrowRight size={18} color="#fff" weight="bold" /></>}
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={[s.primaryBtn, step === 'name' && !nameValid && s.primaryBtnDisabled]}
                onPress={next}
                disabled={step === 'name' && !nameValid}
              >
                <Text style={s.primaryTxt}>{step === 'welcome' ? 'Get started' : 'Continue'}</Text>
                <ArrowRight size={18} color="#fff" weight="bold" />
              </Pressable>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: D.bg },
  topGrad: { position: 'absolute', top: 0, left: 0, right: 0, height: 240, borderBottomLeftRadius: 40, borderBottomRightRadius: 40 },
  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 20, flexGrow: 1 },

  dots: { flexDirection: 'row', justifyContent: 'center', gap: 7, marginBottom: 28 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotOn: { backgroundColor: 'rgba(255,255,255,0.85)' },
  dotActive: { width: 22, backgroundColor: D.white },

  card: {
    backgroundColor: D.white, borderRadius: 26, padding: 24, marginTop: 12,
    borderWidth: 1, borderColor: D.border,
    shadowColor: '#00534822', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 1, shadowRadius: 28, elevation: 6,
  },
  logoWrap: {
    width: 76, height: 76, borderRadius: 22, alignSelf: 'center', marginBottom: 18,
    backgroundColor: 'rgba(0,95,86,0.08)', alignItems: 'center', justifyContent: 'center',
  },
  logo: { width: 48, height: 48, borderRadius: 12 },
  iconCircle: {
    width: 56, height: 56, borderRadius: 18, backgroundColor: 'rgba(0,95,86,0.09)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  h1: { fontSize: 22, fontWeight: '800', color: D.text, letterSpacing: -0.4, marginBottom: 8 },
  body: { fontSize: 14, color: D.muted, lineHeight: 21 },

  field: { marginTop: 20 },
  label: { fontSize: 12, fontWeight: '700', color: D.muted, letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 8 },
  input: {
    borderWidth: 1.5, borderColor: D.inputBorder, borderRadius: 14, backgroundColor: D.inputBg,
    paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: D.text,
  },

  summary: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 },
  summaryTxt: { fontSize: 12.5, color: D.muted },

  errorBox: { backgroundColor: D.errorBg, borderRadius: 12, padding: 12, marginTop: 16, borderWidth: 1, borderColor: D.errorBorder },
  errorTxt: { color: D.error, fontSize: 13 },

  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, gap: 12,
  },
  footerRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, width: 72 },
  backTxt: { fontSize: 14, fontWeight: '600', color: D.text },
  skipTxt: { fontSize: 14, fontWeight: '600', color: D.muted },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: D.emerald, borderRadius: 16, paddingVertical: 15, paddingHorizontal: 26, minWidth: 150,
  },
  primaryBtnDisabled: { backgroundColor: '#B9C9C6' },
  primaryTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
