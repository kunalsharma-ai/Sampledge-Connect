import { useMemo, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { SvgXml } from 'react-native-svg';
import type { ChatLook } from '../lib/chatTheme';
import { ThemeOverride } from '../theme/ThemeProvider';

/** The chat theme's background art, drawn behind the timeline. */
export function ChatBackdrop({ look }: { look: ChatLook }) {
  const { width } = useWindowDimensions();
  const w = Math.min(width, 1440);
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

/** Conversation colors (background and bubbles) from the chat theme, for everything inside. */
export function ChatThemeScope({ look, children }: { look: ChatLook | null; children: ReactNode }) {
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
  return <ThemeOverride colors={colors}>{children}</ThemeOverride>;
}

const styles = StyleSheet.create({
  scene: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
});
