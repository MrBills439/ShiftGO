import React, { useRef, useEffect } from 'react';
import { Pressable, Text, StyleSheet, Animated, View } from 'react-native';
import { ArrowCircleDown, ArrowCircleUp } from 'phosphor-react-native';
import { Colors, Radius, Shadow, Typography } from '../constants/theme';

interface Props {
  isClockedIn: boolean;
  isLoading: boolean;
  onPress: () => void;
  disabled?: boolean;
}

export function ClockButton({ isClockedIn, isLoading, onPress, disabled }: Props) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isClockedIn) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.07, duration: 900, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulse.setValue(1);
    }
  }, [isClockedIn]);

  const bg = isClockedIn ? Colors.error : Colors.primary;
  const label = isLoading ? '…' : isClockedIn ? 'Clock Out' : 'Clock In';
  const Icon = isClockedIn ? ArrowCircleDown : ArrowCircleUp;

  return (
    <Animated.View style={{ transform: [{ scale: pulse }] }}>
      <Pressable
        onPress={onPress}
        disabled={disabled || isLoading}
        style={({ pressed }) => [
          styles.btn,
          { backgroundColor: bg, opacity: pressed ? 0.88 : 1 },
          disabled && styles.disabled,
        ]}
      >
        <Icon size={32} color="#fff" weight="fill" />
        <Text style={styles.label}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 160,
    height: 160,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...Shadow.button,
  },
  label: { ...Typography.titleMd, color: '#fff' },
  disabled: { opacity: 0.4 },
});
