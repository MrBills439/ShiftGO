import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { updateFcmToken } from './authService';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;

    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('shiftgo', {
        name: 'ShiftGO',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#005f55',
      });
    }

    const token = (await Notifications.getExpoPushTokenAsync()).data;
    try { await updateFcmToken(token); } catch { /* non-critical */ }
    return token;
  } catch {
    return null;
  }
}
