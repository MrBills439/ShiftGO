import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  Pressable, ActivityIndicator, Alert, Image,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  ArrowLeft, User, Envelope, Phone, MapPin,
  Clock, Camera, Check, Lock,
} from 'phosphor-react-native';
import { getMe, updateMe, uploadAvatar } from '../../services/profileService';
import { API_BASE_URL } from '../../services/api';
import { UserProfile } from '../../types';
import { D } from '../../constants/theme';

const BASE_URL = API_BASE_URL;


function Field({
  label, icon, value, onChangeText, placeholder, keyboardType, multiline, focused, onFocus, onBlur,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: any;
  multiline?: boolean;
  focused?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  return (
    <View style={fi.wrap}>
      <Text style={fi.label}>{label}</Text>
      <View style={[fi.row, focused && fi.rowFocused, multiline && fi.rowMulti]}>
        <View style={fi.iconBox}>{icon}</View>
        <TextInput
          style={[fi.input, multiline && fi.inputMulti]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder ?? ''}
          placeholderTextColor={D.light}
          keyboardType={keyboardType ?? 'default'}
          autoCapitalize="none"
          multiline={multiline}
          numberOfLines={multiline ? 3 : 1}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      </View>
    </View>
  );
}

const fi = StyleSheet.create({
  wrap: { marginBottom: 16 },
  label: { fontSize: 11, fontWeight: '600', color: D.muted, letterSpacing: 0.3, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: D.inputBg, borderWidth: 1.5, borderColor: D.inputBorder, borderRadius: 14, overflow: 'hidden' },
  rowFocused: { borderColor: D.inputFocus, backgroundColor: D.white },
  rowMulti: { alignItems: 'flex-start' },
  iconBox: { paddingLeft: 14, paddingRight: 4, paddingTop: 14 },
  input: { flex: 1, paddingVertical: 14, paddingHorizontal: 10, fontSize: 15, color: D.text },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
});

/** Non-editable account field — value comes from the User record and is
 *  managed elsewhere (identity / HR), so it is shown, not edited, here. */
function ReadonlyRow({
  label, icon, value, hint,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  hint?: string;
}) {
  return (
    <View style={fi.wrap}>
      <Text style={fi.label}>{label}</Text>
      <View style={ro.row}>
        <View style={fi.iconBox}>{icon}</View>
        <Text style={ro.value} numberOfLines={1}>{value || '—'}</Text>
        <Lock size={13} color={D.light} weight="regular" style={{ marginRight: 14 }} />
      </View>
      {hint ? <Text style={ro.hint}>{hint}</Text> : null}
    </View>
  );
}

const ro = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: D.bg, borderWidth: 1.5, borderColor: D.border, borderRadius: 14, overflow: 'hidden' },
  value: { flex: 1, paddingVertical: 14, paddingHorizontal: 10, fontSize: 15, color: D.muted },
  hint: { fontSize: 11, color: D.light, marginTop: 6, marginLeft: 2 },
});

export default function PersonalInfoScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const [focused, setFocused] = useState<string | null>(null);

  const { data: profile, isLoading } = useQuery<UserProfile>({
    queryKey: ['me'],
    queryFn: getMe,
  });

  // Only phone + address are editable here. Name and email are account identity
  // (managed via Clerk / HR); contracted hours are set by a manager.
  const [form, setForm] = useState({ phone: '', address: '' });

  useEffect(() => {
    if (profile) {
      setForm({ phone: profile.phone ?? '', address: profile.address ?? '' });
    }
  }, [profile]);

  const dirty =
    !!profile &&
    (form.phone !== (profile.phone ?? '') || form.address !== (profile.address ?? ''));

  const saveMutation = useMutation({
    mutationFn: () => updateMe({ phone: form.phone.trim(), address: form.address.trim() }),
    onSuccess: (updated) => {
      qc.setQueryData(['me'], updated);
      qc.invalidateQueries({ queryKey: ['me'] }); // outer Profile tab reads ['me'] too
      Alert.alert('Saved', 'Your contact details have been updated.');
    },
    onError: () => Alert.alert('Error', 'Could not save changes. Please try again.'),
  });

  const avatarMutation = useMutation({
    mutationFn: uploadAvatar,
    onSuccess: (updated) => {
      qc.setQueryData(['me'], updated);
    },
    onError: () => Alert.alert('Error', 'Could not upload photo.'),
  });

  async function pickAvatar() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo access to change your profile picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      avatarMutation.mutate(result.assets[0].uri);
    }
  }

  const avatarUri = profile?.profilePicture
    ? `${BASE_URL}${profile.profilePicture}`
    : null;

  const initials = profile?.name?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() ?? 'U';

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={s.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.65 }]}
        >
          <ArrowLeft size={20} color={D.text} weight="bold" />
        </Pressable>
        <Text style={s.title}>Personal Information</Text>
        <Pressable
          onPress={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !dirty}
          style={({ pressed }) => [s.saveBtn, (saveMutation.isPending || !dirty) && { opacity: 0.4 }, pressed && { opacity: 0.65 }]}
        >
          {saveMutation.isPending
            ? <ActivityIndicator size="small" color={D.white} />
            : <Check size={18} color={D.white} weight="bold" />}
        </Pressable>
      </View>

      {isLoading ? (
        <View style={s.loadWrap}><ActivityIndicator size="large" color={D.emerald} /></View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* Avatar */}
          <View style={s.avatarSection}>
            <View style={s.avatarWrap}>
              {avatarUri
                ? <Image source={{ uri: avatarUri }} style={s.avatarImg} />
                : (
                  <View style={s.avatarFallback}>
                    <Text style={s.avatarTxt}>{initials}</Text>
                  </View>
                )}
              {avatarMutation.isPending && (
                <View style={s.avatarLoading}>
                  <ActivityIndicator color={D.white} />
                </View>
              )}
            </View>
            <Pressable
              onPress={pickAvatar}
              style={({ pressed }) => [s.changePhotoBtn, pressed && { opacity: 0.75 }]}
            >
              <Camera size={15} color={D.emerald} weight="bold" />
              <Text style={s.changePhotoTxt}>Change Photo</Text>
            </Pressable>
          </View>

          {/* Account identity — read-only */}
          <View style={s.card}>
            <ReadonlyRow
              label="FULL NAME"
              icon={<User size={17} color={D.light} weight="regular" />}
              value={profile?.name ?? ''}
            />
            <ReadonlyRow
              label="EMAIL"
              icon={<Envelope size={17} color={D.light} weight="regular" />}
              value={profile?.email ?? ''}
            />
            <ReadonlyRow
              label="CONTRACTED HOURS"
              icon={<Clock size={17} color={D.light} weight="regular" />}
              value={profile?.contractedHours != null ? `${profile.contractedHours} hrs / week` : 'Not set'}
              hint="Set by your manager or HR."
            />
          </View>

          {/* Editable contact details */}
          <View style={s.card}>
            <Field
              label="PHONE"
              icon={<Phone size={17} color={focused === 'phone' ? D.emerald : D.light} weight="regular" />}
              value={form.phone}
              onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
              placeholder="+44 7700 000000"
              keyboardType="phone-pad"
              focused={focused === 'phone'}
              onFocus={() => setFocused('phone')}
              onBlur={() => setFocused(null)}
            />
            <Field
              label="ADDRESS"
              icon={<MapPin size={17} color={focused === 'address' ? D.emerald : D.light} weight="regular" />}
              value={form.address}
              onChangeText={(v) => setForm((f) => ({ ...f, address: v }))}
              placeholder="Your home address"
              focused={focused === 'address'}
              onFocus={() => setFocused('address')}
              onBlur={() => setFocused(null)}
            />
          </View>

          <Text style={s.note}>
            Name, email and contracted hours are managed by your agency. You can update your phone
            number and address here.
          </Text>

        </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: D.bg },
  scroll: { paddingHorizontal: 18, paddingBottom: 40 },
  loadWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: D.white, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: D.border },
  title: { fontSize: 17, fontWeight: '700', color: D.text },
  saveBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: D.emerald, alignItems: 'center', justifyContent: 'center' },

  avatarSection: { alignItems: 'center', paddingVertical: 24 },
  avatarWrap: { position: 'relative', marginBottom: 12 },
  avatarImg: { width: 96, height: 96, borderRadius: 30 },
  avatarFallback: { width: 96, height: 96, borderRadius: 30, backgroundColor: D.emerald, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 30, fontWeight: '700', color: '#fff' },
  avatarLoading: { ...StyleSheet.absoluteFill, borderRadius: 30, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  changePhotoBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: D.white, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: D.border },
  changePhotoTxt: { fontSize: 13, fontWeight: '600', color: D.emerald },

  card: { backgroundColor: D.white, borderRadius: 22, padding: 18, marginBottom: 16, borderWidth: 1, borderColor: D.border, shadowColor: '#00534810', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 16, elevation: 3 },

  note: { fontSize: 12, color: D.light, textAlign: 'center', lineHeight: 18, paddingHorizontal: 16 },
});
