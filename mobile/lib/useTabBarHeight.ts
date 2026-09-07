import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Visual height of the tab bar's content band (icons + labels), before the
 * device's bottom safe-area inset is added. Matches what the app shipped with
 * on a phone whose `insets.bottom` is ~0 (gesture-pill device with the nav
 * drawn over content).
 */
export const TAB_BAR_BASE_HEIGHT = Platform.OS === 'ios' ? 50 : 64;

/**
 * Total space the (absolutely-positioned) bottom tab bar occupies on THIS
 * device: the content band plus the bottom safe-area inset (gesture bar or
 * 3-button navigation). Use it as `paddingBottom` on scrollable content inside
 * tab screens so the last item always scrolls clear of the bar, on any screen
 * size or navigation mode.
 */
export function useTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_BASE_HEIGHT + insets.bottom;
}
