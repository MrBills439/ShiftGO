import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarBlank, ClockCountdown, ListChecks, UserCircle } from 'phosphor-react-native';
import { Colors } from '../../constants/theme';
import { TAB_BAR_BASE_HEIGHT } from '../../lib/useTabBarHeight';

function TabBar({ children }: { children: React.ReactNode }) {
  if (Platform.OS === 'ios') {
    return (
      <BlurView intensity={80} tint="light" style={styles.blurBar}>
        {children}
      </BlurView>
    );
  }
  return <View style={styles.androidBar}>{children}</View>;
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.outline,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginBottom: 2 },
        // Content band is a fixed visual height; the device's bottom inset
        // (gesture bar / 3-button nav) is added beneath so the bar is never
        // clipped by or overlapping the Android system navigation.
        tabBarStyle: [
          styles.tabBar,
          { height: TAB_BAR_BASE_HEIGHT + insets.bottom, paddingBottom: insets.bottom },
        ],
        tabBarBackground: () => (
          Platform.OS === 'ios'
            ? <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill} />
            : <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.surfaceContainerLowest }]} />
        ),
      }}
    >
      <Tabs.Screen
        name="shifts"
        options={{
          title: 'Shifts',
          tabBarIcon: ({ color, size }) => <CalendarBlank size={size} color={color as string} weight="regular" />,
        }}
      />
      <Tabs.Screen
        name="clock"
        options={{
          title: 'Clock',
          tabBarIcon: ({ color, size }) => <ClockCountdown size={size} color={color as string} weight="regular" />,
        }}
      />
      <Tabs.Screen
        name="timesheets"
        options={{
          title: 'Timesheets',
          tabBarIcon: ({ color, size }) => <ListChecks size={size} color={color as string} weight="regular" />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <UserCircle size={size} color={color as string} weight="regular" />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    borderTopWidth: 1,
    borderTopColor: '#E1F5EE',
    elevation: 0,
    backgroundColor: 'transparent',
  },
  blurBar: { flex: 1 },
  androidBar: { flex: 1, backgroundColor: Colors.surfaceContainerLowest },
});
