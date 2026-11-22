import { createContext, useContext, useId, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, {
  Defs,
  FeColorMatrix,
  FeGaussianBlur,
  Filter,
  Image as SvgImage,
  SvgXml,
} from 'react-native-svg';
import { colorMatrix, coverRect, type ChatImage } from '../lib/chatImage';
import type { ChatLook } from '../lib/chatTheme';
import { alpha } from '../theme/themes';
import { ThemeOverride, useTheme } from '../theme/ThemeProvider';

/**
 * What sits behind the timeline: your own picture from this phone (dimmed with the background
 * color so messages stay readable), else the chat theme's art.
 */
export function ChatBackdrop({ look, image }: { look: ChatLook | null; image: ChatImage | null }) {
  const { width } = useWindowDimensions();
  const { theme } = useTheme();
  const w = Math.min(width, 1440);
  if (image) return <PhotoBackdrop image={image} base={look?.base ?? theme.colors.background} />;
  if (!look) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID={`chat-backdrop-${look.id}`}>
      {look.fillXml ? <SvgXml xml={look.fillXml} width="100%" height="100%" /> : null}
      {look.scene ? (
        <View style={styles.scene}>
          <SvgXml xml={look.scene.xml} width={w} height={w / look.scene.aspect} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Your own picture, cropped around its focus point, with the color edits (one SVG color matrix),
 * blur and opacity, then washed in the background color so messages stay readable.
 */
export function PhotoBackdrop({
  image,
  base,
  testID = 'chat-backdrop-photo',
  pointerEvents = 'none',
}: {
  image: ChatImage;
  base: string;
  testID?: string;
  pointerEvents?: 'none' | 'auto';
}) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const r = box ? coverRect(image, box.w, box.h) : null;
  const matrix = colorMatrix(image);
  const fid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const filtered = !!matrix || image.blur > 0;
  return (
    <View
      pointerEvents={pointerEvents}
      style={[StyleSheet.absoluteFill, { overflow: 'hidden', backgroundColor: base }]}
      testID={testID}
      onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {r && box ? (
        <Svg width={box.w} height={box.h} style={StyleSheet.absoluteFill}>
          {filtered ? (
            <Defs>
              <Filter id={`f${fid}`} x="-5%" y="-5%" width="110%" height="110%">
                {matrix ? <FeColorMatrix type="matrix" values={matrix} /> : null}
                {image.blur > 0 ? <FeGaussianBlur stdDeviation={image.blur / 2} /> : null}
              </Filter>
            </Defs>
          ) : null}
          <SvgImage
            href={image.uri}
            x={r.left}
            y={r.top}
            width={r.width}
            height={r.height}
            preserveAspectRatio="none"
            opacity={image.opacity}
            filter={filtered ? `url(#f${fid})` : undefined}
          />
        </Svg>
      ) : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: alpha(base, image.dim) }]} />
    </View>
  );
}

/** Set while a picture is behind the chat: text outside bubbles gets a soft halo in this color. */
const HaloContext = createContext<string | null>(null);

/** Text style that keeps names readable over a picture (nothing when there is none). */
export function useChatHalo() {
  const halo = useContext(HaloContext);
  return halo
    ? { textShadowColor: halo, textShadowRadius: 6, textShadowOffset: { width: 0, height: 0 } }
    : null;
}

/** Conversation colors (background and bubbles) from the chat theme, for everything inside. */
export function ChatThemeScope({
  look,
  halo = null,
  children,
}: {
  look: ChatLook | null;
  /** The base color to halo text with, when a picture is showing. */
  halo?: string | null;
  children: ReactNode;
}) {
  const colors = useMemo(
    () =>
      look
        ? {
            background: look.base,
            bubbleOwn: look.bubbleOwn,
            bubbleOwnText: look.bubbleOwnFg,
            bubbleOther: look.bubbleOther,
            glow: ['transparent', 'transparent'] as [string, string],
          }
        : null,
    [look],
  );
  return (
    <HaloContext.Provider value={halo}>
      <ThemeOverride colors={colors}>{children}</ThemeOverride>
    </HaloContext.Provider>
  );
}

const styles = StyleSheet.create({
  scene: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
});
