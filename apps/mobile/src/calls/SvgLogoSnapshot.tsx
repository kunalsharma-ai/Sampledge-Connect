import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { saveLogoPng } from './cameraEffectPictures';

type Snapshotting = { toDataURL?: (cb: (base64: string) => void, o?: object) => void };

/**
 * The camera can't read vector (SVG) logos, so for the company background this draws the logo
 * once, out of sight, and saves it as a PNG for the camera to use.
 */
export function SvgLogoSnapshot({
  logo,
  onReady,
}: {
  logo: string | null;
  onReady: (pngUri: string | null) => void;
}) {
  const ref = useRef<Snapshotting | null>(null);
  const xml = logo?.startsWith('data:image/svg+xml') ? decodeSvg(logo) : null;

  useEffect(() => {
    if (!xml) {
      onReady(null);
      return;
    }
    let live = true;
    // Give the view a moment to draw before reading it back.
    const t = setTimeout(() => {
      ref.current?.toDataURL?.(
        (base64) => {
          if (live) onReady(saveLogoPng(xml, base64));
        },
        { width: 400, height: 168 },
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [xml, onReady]);

  if (!xml) return null;
  return (
    <View
      pointerEvents="none"
      style={styles.hidden}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <SvgXml xml={xml} override={{ ref, width: 400, height: 168 } as object} />
    </View>
  );
}

function decodeSvg(dataUrl: string): string | null {
  const comma = dataUrl.indexOf(',');
  const head = dataUrl.slice(0, comma);
  const data = dataUrl.slice(comma + 1);
  try {
    return head.includes(';base64') ? globalThis.atob(data) : decodeURIComponent(data);
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', left: -10000, top: 0, width: 400, height: 168, opacity: 0 },
});
