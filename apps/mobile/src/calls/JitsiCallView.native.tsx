import { isJitsiLeftEvent } from '@sampledge/contracts';
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Text } from '../components/Text';
import { JITSI_BRIDGE_SCRIPT, bridgeEvent } from './jitsiBridge';

/**
 * The organization's Jitsi Meet server (branded as SampConnect) in a WebView. Camera and
 * microphone are granted to the page because the app already holds those permissions for
 * calls; Jitsi's own hang-up button ends the call screen.
 */
export function JitsiCallView({ url, onLeft }: { url: string; onLeft: () => void }) {
  const [loading, setLoading] = useState(true);
  const left = useRef(false);
  return (
    <View style={styles.fill}>
      <WebView
        source={{ uri: url }}
        style={styles.fill}
        originWhitelist={['https://*', 'http://*']}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        allowsFullscreenVideo
        injectedJavaScriptBeforeContentLoaded={JITSI_BRIDGE_SCRIPT}
        onLoadEnd={() => setLoading(false)}
        onPermissionRequest={(e: { grant?: (r?: string[]) => void; resources?: string[] }) =>
          e.grant?.(e.resources)
        }
        onMessage={(e) => {
          const name = bridgeEvent(e.nativeEvent.data);
          if (isJitsiLeftEvent(name) && !left.current) {
            left.current = true;
            onLeft();
          }
        }}
        // Links in the page (help, terms) must not replace the call.
        setSupportMultipleWindows={false}
        testID="jitsi-webview"
      />
      {loading ? (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <ActivityIndicator color="#FFFFFF" />
          <Text variant="meta" style={{ color: 'rgba(255,255,255,0.7)' }}>
            Connecting to your call server…
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#080F1F' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 8 },
});
