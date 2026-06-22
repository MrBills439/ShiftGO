import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Radius, Typography } from '../constants/theme';

type Status = 'upcoming' | 'active' | 'completed' | 'missed' | 'confirmed' | 'pending';

const STATUS_MAP: Record<Status, { bg: string; text: string; dot: string; label: string }> = {
  upcoming:  { bg: '#e8f4f8', text: '#1a6b8a', dot: '#1a6b8a', label: 'UPCOMING' },
  active:    { bg: '#e6f4f0', text: Colors.primary, dot: Colors.primary, label: 'ACTIVE' },
  completed: { bg: Colors.surfaceContainerHigh, text: Colors.onSurfaceVariant, dot: Colors.outline, label: 'COMPLETED' },
  missed:    { bg: Colors.errorContainer, text: Colors.error, dot: Colors.error, label: 'MISSED' },
  confirmed: { bg: '#e6f4f0', text: Colors.primary, dot: Colors.primary, label: 'CONFIRMED' },
  pending:   { bg: Colors.tertiaryContainer + '33', text: Colors.tertiary, dot: Colors.tertiary, label: 'PENDING' },
};

interface Props { status: Status }

export function StatusBadge({ status }: Props) {
  const cfg = STATUS_MAP[status] ?? STATUS_MAP.upcoming;
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <View style={[styles.dot, { backgroundColor: cfg.dot }]} />
      <Text style={[styles.label, { color: cfg.text }]}>{cfg.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    gap: 5,
    alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { ...Typography.labelCaps },
});
