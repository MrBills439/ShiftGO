import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView,
  Platform, ActivityIndicator, Image, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import {
  ArrowRight, ArrowLeft, User, Phone, CheckCircle, MapPin, BellRinging, Clock,
} from 'phosphor-react-native';
import { completeOnboarding } from '../../services/profileService';
import { registerForPushNotifications } from '../../services/pushNotifications';
import { apiErrorMessage } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { D } from '../../constants/theme';

type Step = 'welcome' | 'name' | 'phone' | 'location' | 'notifications' | 'ready';
const STEPS: Step[] = ['welcome', 'name', 'phone', 'location', 'notifications', 'ready'];

export default function OnboardingScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [step, setStep] = useState<Step>('welcome');
  const [name, setName] = useState(user?.name && user.name !== user.email ? user.name : '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [locStatus, setLocStatus] = useState<'idle' | 'busy' | 'granted' | 'denied'>('idle');
  const [notifStatus, setNotifStatus] = useState<'idle' | 'busy' | 'granted' | 'denied'>('idle');

  const idx = STEPS.indexOf(step);
  const nameValid = name.trim().length >= 2;
  const isLast = step === 'ready';

  function next() {
    setError(null);
    if (step === 'name' && !nameValid) {
      setError('Please enter your name (at least 2 characters).');
      return;
    }
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  }

  function back() {
    setError(null);
    if (idx > 0) setStep(STEPS[idx - 1]);
  }

  async function askLocation() {
    setLocStatus('busy');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setLocStatus(status === 'granted' ? 'granted' : 'denied');
    } catch {
      setLocStatus('denied');
    }
  }

  async function askNotifications() {
    setNotifStatus('busy');
    try {
      const token = await registerForPushNotifications();
      setNotifStatus(token ? 'granted' : 'denied');
    } catch {
      setNotifStatus('denied');
    }
  }

  async function finish() {
    if (!nameValid) {
      setStep('name');
      setError('Please enter your name.');
      return;
    }
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

  const primaryLabel =
    step === 'welcome' ? 'Get started' : isLast ? 'Finish' : 'Continue';

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
                  This is where you&apos;ll see your shifts, clock in and out of the service, and
                  keep your timesheets straight. It takes about a minute to set up.
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
                    onSubmitEditing={next}
                  />
                </View>
                <View style={s.summary}>
                  <CheckCircle size={16} color={D.emerald} weight="fill" />
                  <Text style={s.summaryTxt}>Signed in as {name.trim() || user?.email}</Text>
                </View>
              </View>
            )}

            {step === 'location' && (
              <View style={s.card}>
                <View style={s.iconCircle}><MapPin size={26} color={D.emerald} weight="regular" /></View>
                <Text style={s.h1}>Allow location access</Text>
                <Text style={s.body}>
                  ShiftGO checks your location when you clock in and out, and while you&apos;re on a
                  shift, to confirm you&apos;re at the service. It never tracks you when you&apos;re
                  off shift.
                </Text>

                {locStatus === 'granted' ? (
                  <View style={s.granted}>
                    <CheckCircle size={18} color={D.emerald} weight="fill" />
                    <Text style={s.grantedTxt}>Location access enabled</Text>
                  </View>
                ) : (
                  <Pressable style={s.permBtn} onPress={askLocation} disabled={locStatus === 'busy'}>
                    {locStatus === 'busy'
                      ? <ActivityIndicator color={D.emerald} />
                      : <Text style={s.permBtnTxt}>Allow location access</Text>}
                  </Pressable>
                )}

                {locStatus === 'denied' && (
                  <Text style={s.hint}>
                    You can turn this on later in your phone&apos;s Settings — you&apos;ll need it to clock in.
                  </Text>
                )}
              </View>
            )}

            {step === 'notifications' && (
              <View style={s.card}>
                <View style={s.iconCircle}><BellRinging size={26} color={D.emerald} weight="regular" /></View>
                <Text style={s.h1}>Turn on notifications</Text>
                <Text style={s.body}>
                  Get told about new shifts, reminders to clock in, and a nudge when your shift is
                  ending so nothing gets missed.
                </Text>

                {notifStatus === 'granted' ? (
                  <View style={s.granted}>
                    <CheckCircle size={18} color={D.emerald} weight="fill" />
                    <Text style={s.grantedTxt}>Notifications enabled</Text>
                  </View>
                ) : (
                  <Pressable style={s.permBtn} onPress={askNotifications} disabled={notifStatus === 'busy'}>
                    {notifStatus === 'busy'
                      ? <ActivityIndicator color={D.emerald} />
                      : <Text style={s.permBtnTxt}>Enable notifications</Text>}
                  </Pressable>
                )}

                {notifStatus === 'denied' && (
                  <Text style={s.hint}>
                    That&apos;s fine — you can turn notifications on later in Settings.
                  </Text>
                )}
              </View>
            )}

            {step === 'ready' && (
              <View style={s.card}>
                <View style={s.iconCircle}><Clock size={26} color={D.emerald} weight="regular" /></View>
                <Text style={s.h1}>How clocking in works</Text>
                {[
                  'Tap Clock In when you arrive at the service.',
                  'ShiftGO confirms by GPS that you’re at the location.',
                  'Tap Clock Out when you finish — even if you’re off-site supporting a client.',
                ].map((line) => (
                  <View key={line} style={s.bulletRow}>
                    <CheckCircle size={16} color={D.emerald} weight="fill" />
                    <Text style={s.bulletTxt}>{line}</Text>
                  </View>
                ))}
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

            <View style={s.footerRight}>
              {step === 'phone' && !phone.trim() && (
                <Pressable onPress={next} disabled={submitting} hitSlop={8}>
                  <Text style={s.skipTxt}>Skip</Text>
                </Pressable>
              )}
              <Pressable
                style={[
                  s.primaryBtn,
                  step === 'name' && !nameValid && s.primaryBtnDisabled,
                  submitting && s.primaryBtnDisabled,
                ]}
                onPress={isLast ? finish : next}
                disabled={(step === 'name' && !nameValid) || submitting}
              >
                {submitting
                  ? <ActivityIndicator color="#fff" />
                  : <><Text style={s.primaryTxt}>{primaryLabel}</Text><ArrowRight size={18} color="#fff" weight="bold" /></>}
              </Pressable>
            </View>
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

  permBtn: {
    marginTop: 20, borderWidth: 1.5, borderColor: D.emerald, borderRadius: 14,
    paddingVertical: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,95,86,0.06)',
  },
  permBtnTxt: { fontSize: 15, fontWeight: '700', color: D.emerald },
  granted: {
    marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(0,95,86,0.08)', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14,
  },
  grantedTxt: { fontSize: 14, fontWeight: '700', color: D.emerald },
  hint: { fontSize: 12.5, color: D.muted, marginTop: 12, lineHeight: 18 },

  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 12 },
  bulletTxt: { flex: 1, fontSize: 14, color: D.text, lineHeight: 20 },

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
