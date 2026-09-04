import React, { useEffect, useRef } from 'react';
import {
  Animated, StyleSheet, View, Easing,
  type DimensionValue, type StyleProp, type ViewStyle,
} from 'react-native';
import { D } from '../constants/theme';

/** A single pulsing placeholder bar. Use while data is loading in place of the
 *  eventual text/number so the layout doesn't jump. */
export function Skeleton({
  width = '100%',
  height = 14,
  radius = 7,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: D.border, opacity: pulse },
        style,
      ]}
    />
  );
}

/** A card-shaped container for grouping skeleton bars. */
export function SkeletonCard({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  return <View style={[sk.card, style]}>{children}</View>;
}

/** A generic list-row skeleton: icon square + two lines of text. */
export function SkeletonRow({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[sk.row, style]}>
      <Skeleton width={40} height={40} radius={12} />
      <View style={sk.rowText}>
        <Skeleton width="55%" height={13} />
        <Skeleton width="80%" height={11} />
      </View>
    </View>
  );
}

const sk = StyleSheet.create({
  card: {
    backgroundColor: D.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: D.border,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowText: { flex: 1, gap: 8 },
});
