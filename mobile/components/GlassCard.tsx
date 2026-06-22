import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Colors, Radius, Shadow } from '../constants/theme';

interface Props {
  children: React.ReactNode;
  style?: ViewStyle;
  variant?: 'default' | 'teal';
}

export function GlassCard({ children, style, variant = 'default' }: Props) {
  return (
    <View style={[styles.card, variant === 'teal' && styles.tealCard, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: '#E1F5EE',
    padding: 16,
    ...Shadow.card,
  },
  tealCard: {
    backgroundColor: Colors.primaryContainer,
    borderColor: Colors.primary,
  },
});
