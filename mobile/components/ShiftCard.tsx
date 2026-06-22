import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MapPin, Clock } from 'phosphor-react-native';
import { GlassCard } from './GlassCard';
import { StatusBadge } from './StatusBadge';
import { Colors, Typography, Spacing } from '../constants/theme';
import { Shift } from '../types';

interface Props {
  shift: Shift;
  isActive?: boolean;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function getShiftStatus(shift: Shift): 'active' | 'upcoming' | 'completed' {
  const now = new Date();
  const start = new Date(shift.startTime);
  const end = new Date(shift.endTime);
  if (now >= start && now <= end) return 'active';
  if (now < start) return 'upcoming';
  return 'completed';
}

export function ShiftCard({ shift }: Props) {
  const status = getShiftStatus(shift);

  return (
    <GlassCard style={status === 'active' ? styles.activeCard : undefined}>
      <View style={styles.header}>
        <Text style={styles.date}>{formatDate(shift.date)}</Text>
        <StatusBadge status={status} />
      </View>

      <Text style={styles.houseName}>{shift.house.name}</Text>

      <View style={styles.row}>
        <MapPin size={14} color={Colors.onSurfaceVariant} weight="regular" />
        <Text style={styles.meta} numberOfLines={1}>{shift.house.address}</Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.timeRow}>
        <Clock size={14} color={Colors.primary} weight="regular" />
        <Text style={styles.time}>
          {formatTime(shift.startTime)} – {formatTime(shift.endTime)}
        </Text>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  activeCard: {
    borderColor: Colors.primary,
    borderWidth: 1.5,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  date: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  houseName: { ...Typography.titleSm, color: Colors.onSurface, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  meta: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: Spacing.sm },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  time: { ...Typography.bodySm, color: Colors.primary, fontWeight: '500' },
});
