import { Ionicons } from '@expo/vector-icons';
import type { CallBackgroundChoice, CallBackgroundState } from '@sampledge/contracts';
import { useId, useMemo, useState } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, {
  Defs,
  Line,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
  SvgXml,
} from 'react-native-svg';
import { shade } from '../lib/callBackground';
import { PRESET_THUMBS } from '../lib/callBackgroundThumbs';
import { alpha } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/**
 * A 16:9 picture of a call background. With `person`, a silhouette sits in front, so it reads
 * as "you, in a call, with this behind you".
 */
export function CallBackgroundPreview({
  choice,
  state,
  person,
  style,
  testID,
}: {
  choice: CallBackgroundChoice;
  state: Pick<CallBackgroundState, 'brand' | 'customImageUrl'>;
  person?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [w, setW] = useState(0);
  let body: React.ReactNode;
  switch (choice.kind) {
    case 'preset':
      body = (
        <Image source={PRESET_THUMBS[choice.presetId]} style={styles.fill} resizeMode="cover" />
      );
      break;
    case 'custom':
      body = state.customImageUrl ? (
        <Image source={{ uri: state.customImageUrl }} style={styles.fill} resizeMode="cover" />
      ) : (
        <Placeholder icon="image-outline" />
      );
      break;
    case 'logo':
      body = <CompanyBackground brand={state.brand} width={w} />;
      break;
    case 'blur':
      body = <BlurLook />;
      break;
    case 'none':
      body = <Placeholder icon="videocam-outline" />;
  }
  return (
    <View
      testID={testID}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={[styles.frame, { backgroundColor: c.surfaceSunken, borderColor: c.border }, style]}
    >
      {body}
      {person && w ? <Person width={w} /> : null}
    </View>
  );
}

function Placeholder({ icon }: { icon: keyof typeof Ionicons.glyphMap }) {
  const { theme } = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, styles.center]}>
      <Ionicons name={icon} size={22} color={theme.colors.textSubtle} />
    </View>
  );
}

/** A soft, out-of-focus room, standing in for your own background blurred. */
function BlurLook() {
  const id = useId().replace(/:/g, '');
  return (
    <Svg style={StyleSheet.absoluteFill} viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice">
      <Defs>
        <LinearGradient id={`bl-${id}`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#6b7a8f" />
          <Stop offset="1" stopColor="#3a4252" />
        </LinearGradient>
        <RadialGradient id={`bw-${id}`} cx="0.25" cy="0.3" r="0.45">
          <Stop offset="0" stopColor="#f3e3c3" stopOpacity="0.8" />
          <Stop offset="1" stopColor="#f3e3c3" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id={`bg-${id}`} cx="0.8" cy="0.75" r="0.4">
          <Stop offset="0" stopColor="#8fb3a0" stopOpacity="0.7" />
          <Stop offset="1" stopColor="#8fb3a0" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect width="160" height="90" fill={`url(#bl-${id})`} />
      <Rect width="160" height="90" fill={`url(#bw-${id})`} />
      <Rect width="160" height="90" fill={`url(#bg-${id})`} />
    </Svg>
  );
}

/**
 * The company background, drawn the same way as on web: brand colors with soft glows, an
 * accent band, fine diagonal lines, and the logo and name inside the middle of the frame.
 */
export function CompanyBackground({
  brand,
  width,
}: {
  brand: CallBackgroundState['brand'];
  width: number;
}) {
  const id = useId().replace(/:/g, '');
  const W = 1280;
  const H = 720;
  const s = width / W;
  const lines = useMemo(() => {
    const out: number[] = [];
    for (let x = -H; x < W; x += 28) out.push(x);
    return out;
  }, []);
  const svgLogo = brand.logo?.startsWith('data:image/svg+xml') ? decodeSvg(brand.logo) : null;
  return (
    <View style={StyleSheet.absoluteFill}>
      <Svg
        style={StyleSheet.absoluteFill}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid slice"
      >
        <Defs>
          <LinearGradient id={`cb-${id}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={shade(brand.primary, -0.55)} />
            <Stop offset="1" stopColor={shade(brand.primary, -0.25)} />
          </LinearGradient>
          <RadialGradient
            id={`cg1-${id}`}
            cx={W * 0.85}
            cy={H * 0.15}
            r={520}
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0" stopColor={brand.primary} stopOpacity="0.45" />
            <Stop offset="1" stopColor={brand.primary} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient
            id={`cg2-${id}`}
            cx={W * 0.1}
            cy={H * 0.95}
            r={480}
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0" stopColor={brand.secondary} stopOpacity="0.25" />
            <Stop offset="1" stopColor={brand.secondary} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width={W} height={H} fill={`url(#cb-${id})`} />
        <Rect width={W} height={H} fill={`url(#cg1-${id})`} />
        <Rect width={W} height={H} fill={`url(#cg2-${id})`} />
        {lines.map((x) => (
          <Line
            key={x}
            x1={x}
            y1={H}
            x2={x + H}
            y2={0}
            stroke="#ffffff"
            strokeOpacity={0.035}
            strokeWidth={2}
          />
        ))}
        <Rect y={H - 10} width={W} height={10} fill={brand.secondary} fillOpacity={0.85} />
      </Svg>
      {width ? (
        <View style={[styles.brand, { right: width * 0.23, top: 44 * s, gap: 14 * s }]}>
          {brand.logo ? (
            <View style={[styles.logoPill, { padding: 14 * s, borderRadius: 14 * s }]}>
              {svgLogo ? (
                <SvgXml xml={svgLogo} width={200 * s} height={84 * s} />
              ) : (
                <Image
                  source={{ uri: brand.logo }}
                  resizeMode="contain"
                  style={{ width: 200 * s, height: 84 * s }}
                />
              )}
            </View>
          ) : null}
          {brand.name ? (
            <Text
              numberOfLines={1}
              style={{
                color: 'rgba(255,255,255,0.9)',
                fontSize: Math.max(7, 26 * s),
                fontWeight: '600',
              }}
            >
              {brand.name}
            </Text>
          ) : null}
        </View>
      ) : null}
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

/** Head and shoulders, to show where you sit in front of the background. */
function Person({ width }: { width: number }) {
  const { theme } = useTheme();
  const fill = alpha(theme.dark ? '#0b1220' : '#1b2433', 0.82);
  const h = (width * 9) / 16;
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      width={width}
      height={h}
      viewBox="0 0 160 90"
      pointerEvents="none"
    >
      <Rect x="66" y="22" width="28" height="32" rx="14" fill={fill} />
      <Rect x="44" y="56" width="72" height="44" rx="26" fill={fill} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  frame: {
    aspectRatio: 16 / 9,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  fill: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  brand: { position: 'absolute', alignItems: 'flex-end' },
  logoPill: { backgroundColor: 'rgba(255,255,255,0.94)' },
});
