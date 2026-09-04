import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { WarningCircle } from 'phosphor-react-native';
import { D } from '../constants/theme';
import { captureError } from '../lib/monitoring';

interface Props {
  children: React.ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * App-wide error boundary — a render error should show a recover screen, not a
 * blank white screen. Wrapped around the router in app/_layout.tsx.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    captureError(error, { componentStack: info.componentStack });
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <View style={styles.root}>
        <WarningCircle size={44} color={D.emerald} weight="fill" />
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          The app hit an unexpected error. You can try again — if it keeps happening, restart the app.
        </Text>
        {__DEV__ && <Text style={styles.detail}>{this.state.error.message}</Text>}
        <Pressable style={styles.btn} onPress={this.reset}>
          <Text style={styles.btnTxt}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: D.bg, alignItems: 'center', justifyContent: 'center', padding: 28 },
  title: { fontSize: 18, fontWeight: '700', color: D.text, marginTop: 16 },
  body: { fontSize: 14, color: D.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  detail: { fontSize: 12, color: D.light, textAlign: 'center', marginTop: 12, fontFamily: 'monospace' as any },
  btn: { marginTop: 24, backgroundColor: D.emerald, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32 },
  btnTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
