import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, View } from 'react-native';
import { CalendarBlank, ClockCountdown, ListChecks, UserCircle, CalendarDots } from 'phosphor-react-native';
import { Colors } from '../../constants/theme';

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
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.outline,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginBottom: 2 },
        tabBarStyle: styles.tabBar,
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
          tabBarIcon: ({ color, size }) => <CalendarBlank size={size} color={color} weight="regular" />,
        }}
      />
      <Tabs.Screen
        name="clock"
        options={{
          title: 'Clock',
          tabBarIcon: ({ color, size }) => <ClockCountdown size={size} color={color} weight="regular" />,
        }}
      />
      <Tabs.Screen
        name="leave"
        options={{
          title: 'Leave',
          tabBarIcon: ({ color, size }) => <CalendarDots size={size} color={color} weight="regular" />,
        }}
      />
      <Tabs.Screen
        name="timesheets"
        options={{
          title: 'Timesheets',
          tabBarIcon: ({ color, size }) => <ListChecks size={size} color={color} weight="regular" />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <UserCircle size={size} color={color} weight="regular" />,
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
    height: Platform.OS === 'ios' ? 84 : 64,
    backgroundColor: 'transparent',
  },
  blurBar: { flex: 1 },
  androidBar: { flex: 1, backgroundColor: Colors.surfaceContainerLowest },
});
