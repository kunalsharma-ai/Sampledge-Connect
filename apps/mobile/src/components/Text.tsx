import { Text as RNText, type TextProps } from 'react-native';
import { type as typeScale } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';

type Variant = keyof typeof typeScale;
type Tone = 'default' | 'muted' | 'subtle' | 'accent' | 'danger' | 'onAccent';

export function Text({
  variant = 'body',
  tone = 'default',
  style,
  ...rest
}: TextProps & { variant?: Variant; tone?: Tone }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const color = {
    default: c.text,
    muted: c.textMuted,
    subtle: c.textSubtle,
    accent: c.accent,
    danger: c.danger,
    onAccent: c.onAccent,
  }[tone];
  return (
    <RNText maxFontSizeMultiplier={1.6} {...rest} style={[typeScale[variant], { color }, style]} />
  );
}
