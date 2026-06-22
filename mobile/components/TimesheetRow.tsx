import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CheckCircle, Clock, Hourglass } from 'phosphor-react-native';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { Timesheet } from '../types';

interface Props { timesheet: Timesheet }

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function TimesheetRow({ timesheet }: Props) {
  const confirmed = !!(timesheet.confirmedAt || timesheet.autoConfirmed);

  return (
    <View style={styles.row}>
      <View style={styles.iconCol}>
        {confirmed
          ? <CheckCircle size={20} color={Colors.primary} weight="fill" />
          : <Hourglass size={20} color={Colors.tertiary} weight="regular" />}
      </View>

      <View style={styles.content}>
        <Text style={styles.house}>{timesheet.house.name}</Text>
        <Text style={styles.date}>{fmtDate(timesheet.clockInAt)}</Text>
        <View style={styles.times}>
          <Clock size={12} color={Colors.onSurfaceVariant} weight="regular" />
          <Text style={styles.timeTxt}>{fmt(timesheet.clockInAt)} – {fmt(timesheet.clockOutAt)}</Text>
        </View>
      </View>

      <View style={styles.right}>
        {timesheet.totalHours != null && (
          <Text style={styles.hours}>{timesheet.totalHours.toFixed(1)}h</Text>
        )}
        <Text style={[styles.status, confirmed ? styles.confirmedTxt : styles.pendingTxt]}>
          {confirmed ? 'Confirmed' : 'Pending'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  iconCol: { width: 28, alignItems: 'center' },
  content: { flex: 1 },
  house: { ...Typography.titleSm, color: Colors.onSurface },
  date: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  times: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  timeTxt: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  right: { alignItems: 'flex-end', gap: 4 },
  hours: { ...Typography.titleSm, color: Colors.primary },
  status: { ...Typography.labelCaps },
  confirmedTxt: { color: Colors.primary },
  pendingTxt: { color: Colors.tertiary },
});
