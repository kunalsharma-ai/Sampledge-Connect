import { greetingOccasion, type GreetingCard as Card } from '@sampledge/contracts';
import { greetingCardLook } from '@sampledge/design-tokens';
import { useMemo } from 'react';
import { Platform, StyleSheet, Text as RNText, View, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { fonts } from '../theme/themes';

const SERIF = Platform.select({ ios: 'Georgia', default: 'serif' });

/**
 * A festival or occasion card in a conversation (and the live preview when composing one).
 * The art is the same original SVG the web app draws (`greetingCardLook`), so a card looks the
 * same on every device and needs no network.
 */
export function GreetingCard({
  card,
  text,
  from,
  width = 300,
  style,
}: {
  card: Card;
  text: string;
  from?: string | null;
  width?: number;
  style?: ViewStyle;
}) {
  const look = useMemo(
    () =>
      greetingCardLook(card.occasionId, card.styleId, {
        quiet: greetingOccasion(card.occasionId)?.quiet,
      }),
    [card.occasionId, card.styleId],
  );
  const p = look.panel;
  const serif = look.titleFont === 'serif';
  return (
    <View
      accessible
      accessibilityLabel={`Greeting card. ${card.to ? `Dear ${card.to}. ` : ''}${card.title}. ${text}${from ? `. From ${from}` : ''}`}
      style={[styles.card, { width, backgroundColor: p.bg, borderColor: p.border }, style]}
      testID="greeting-card"
    >
      <SvgXml xml={look.svg} width={width} height={width / look.aspect} />
      <View style={styles.body}>
        {card.to ? (
          <RNText style={[styles.to, { color: p.muted, fontFamily: SERIF }]}>
            Dear {card.to},
          </RNText>
        ) : null}
        <RNText
          style={[
            styles.title,
            { color: p.fg, fontFamily: serif ? SERIF : fonts.bold },
            serif && { fontWeight: '700' },
          ]}
        >
          {card.title}
        </RNText>
        <View style={[styles.rule, { backgroundColor: p.accent }]} />
        <RNText style={[styles.text, { color: p.fg }]}>{text}</RNText>
        {from ? (
          <RNText style={[styles.from, { color: p.muted, fontFamily: SERIF }]}>
            With warm wishes, {from}
          </RNText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  body: { paddingHorizontal: 16, paddingBottom: 14, marginTop: -4 },
  to: { fontSize: 13, fontStyle: 'italic' },
  title: { fontSize: 22, lineHeight: 27, marginTop: 2 },
  rule: { width: 36, height: 2, borderRadius: 1, marginVertical: 9 },
  text: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  from: { marginTop: 10, textAlign: 'right', fontSize: 13 },
});
