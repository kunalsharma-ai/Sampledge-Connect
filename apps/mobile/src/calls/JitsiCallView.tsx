import { isJitsiLeftEvent, readJitsiMessage } from '@sampledge/contracts';
import { createElement, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';

/**
 * Web preview of the app: the Jitsi page in an iframe, answering its handshake and leaving
 * when Jitsi's hang-up is pressed (the phones use a WebView, JitsiCallView.native.tsx).
 */
export function JitsiCallView({ url, onLeft }: { url: string; onLeft: () => void }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [loading, setLoading] = useState(true);
  const leftRef = useRef(onLeft);
  leftRef.current = onLeft;
  useEffect(() => {
    const origin = new URL(url).origin;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== frame.current?.contentWindow) return;
      const { reply, event } = readJitsiMessage(e.data);
      if (reply) frame.current?.contentWindow?.postMessage(reply, origin);
      if (isJitsiLeftEvent(event)) leftRef.current();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [url]);
  return (
    <View style={styles.fill}>
      {createElement('iframe', {
        ref: frame,
        src: url,
        title: 'Call',
        allow:
          'camera; microphone; display-capture; fullscreen; autoplay; clipboard-write; speaker-selection',
        allowFullScreen: true,
        referrerPolicy: 'no-referrer',
        onLoad: () => setLoading(false),
        style: { border: 0, width: '100%', height: '100%', background: '#000' },
        'data-testid': 'jitsi-frame',
      })}
      {loading ? (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
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
  center: { alignItems: 'center', justifyContent: 'center' },
});
