import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MapPin, CheckCircle } from 'phosphor-react-native';
import { D } from '../constants/theme';
import { fmtTime } from '../lib/datetime';
import { elapsedLabel } from '../lib/flexibleClock';
import type { FlexibleSession, LocationOption } from '../types';

type Props = {
  session: FlexibleSession | null;
  isClockedIn: boolean;
  options: LocationOption[];
  optionsLoading: boolean;
  selectedId: string | null;
  primaryLocationId?: string | null;
  onSelect: (id: string) => void;
};

/**
 * The FLEXIBLE stand-in for the "Today's shift" hero: before clock-in it asks
 * where the employee is working (primary location first); once clocked in it
 * shows the open session. There is deliberately no scheduled end, progress
 * bar or "shift" wording — a FLEXIBLE session is just time actually worked.
 */
export function FlexibleClockPanel({
  session, isClockedIn, options, optionsLoading, selectedId, primaryLocationId, onSelect,
}: Props) {
  if (session) {
    return (
      <LinearGradient colors={[D.eDark, D.eMid, D.eLight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
        <View style={s.badge}>
          <View style={s.badgeDot} />
          <Text style={s.badgeTxt}>{isClockedIn ? 'Clocked In' : 'Finishing clock-out…'}</Text>
        </View>
        <Text style={s.heroLabel}>WORKING AT</Text>
        <Text style={s.heroName}>{session.location.name}</Text>
        <View style={s.row}>
          <Text style={s.heroTime}>Since {fmtTime(session.clockInAt)}</Text>
          <View style={s.durPill}><Text style={s.durTxt}>{elapsedLabel(session.clockInAt)} so far</Text></View>
        </View>
        <Text style={s.note}>Tap Clock Out when you finish — there is no fixed end time.</Text>
      </LinearGradient>
    );
  }

  return (
    <View style={s.card}>
      <Text style={s.title}>Where are you working?</Text>
      <Text style={s.sub}>Choose your location, then tap Clock In.</Text>
      {optionsLoading ? (
        <ActivityIndicator color={D.emerald} style={{ marginVertical: 18 }} />
      ) : options.length === 0 ? (
        <Text style={s.empty}>No work locations are available. Ask HR to set one up.</Text>
      ) : (
        <View style={s.list}>
          {options.map((o) => {
            const selected = o.id === selectedId;
            return (
              <Pressable
                key={o.id}
                onPress={() => onSelect(o.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${o.name}${o.id === primaryLocationId ? ', your primary location' : ''}`}
                style={[s.opt, selected && s.optOn]}
              >
                <MapPin size={16} color={selected ? D.emerald : D.muted} weight={selected ? 'fill' : 'regular'} />
                <Text style={[s.optName, selected && s.optNameOn]} numberOfLines={1}>{o.name}</Text>
                {o.id === primaryLocationId && <Text style={s.primary}>Primary</Text>}
                {selected && <CheckCircle size={16} color={D.emerald} weight="fill" />}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  hero: { borderRadius: 22, padding: 18, marginBottom: 10, overflow: 'hidden' },
  badge: { position: 'absolute', top: 14, right: 14, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  badgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: D.mint },
  badgeTxt: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  heroLabel: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.5)', letterSpacing: 1.2, marginBottom: 6 },
  heroName: { fontSize: 22, fontWeight: '700', color: '#fff', letterSpacing: -0.3, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  heroTime: { fontSize: 17, fontWeight: '700', color: '#fff' },
  durPill: { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3 },
  durTxt: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },
  note: { fontSize: 11, color: 'rgba(255,255,255,0.55)' },

  card: { backgroundColor: D.white, borderRadius: 22, padding: 18, marginBottom: 10, borderWidth: 1, borderColor: D.border },
  title: { fontSize: 17, fontWeight: '700', color: D.text, marginBottom: 4 },
  sub: { fontSize: 12, color: D.muted, marginBottom: 12 },
  empty: { fontSize: 13, color: D.muted, lineHeight: 19, paddingVertical: 8 },
  list: { gap: 8 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 12, borderWidth: 1, borderColor: D.border, backgroundColor: D.white },
  optOn: { borderColor: D.emerald, backgroundColor: 'rgba(0,95,86,0.06)' },
  optName: { flex: 1, fontSize: 14, fontWeight: '600', color: D.text },
  optNameOn: { color: D.emerald },
  primary: { fontSize: 10, fontWeight: '700', color: D.emerald, letterSpacing: 0.4 },
});
