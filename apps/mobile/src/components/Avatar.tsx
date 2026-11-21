import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useAvatarUri } from '../state/hooks';
import { fonts, mix } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

function initials(name: string): string {
  const parts = name.replace(/^#\s*/, '').trim().split(/\s+/);
  return (
    ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() ||
    '?'
  );
}

/**
 * A person's photo when there is one, else initials on a gradient whose hue comes from the name,
 * so people are recognisable at a glance. A photo that fails to load (offline, not cached yet)
 * falls back to initials.
 */
export function Avatar({
  name,
  size = 44,
  channel = false,
  uri,
}: {
  name: string;
  size?: number;
  channel?: boolean;
  uri?: string | null;
}) {
  const { theme } = useTheme();
  const [failed, setFailed] = useState<string | null>(null);
  if (uri && !channel && failed !== uri)
    return (
      <Image
        source={{ uri }}
        onError={() => setFailed(uri)}
        accessibilityIgnoresInvertColors
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.colors.surfaceSunken,
        }}
      />
    );
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const t = (h % 100) / 100;
  const a = mix(theme.colors.accent, theme.colors.accentSecondary, t);
  const b = mix(theme.colors.accentSecondary, theme.colors.accent, t * 0.5);
  return (
    <LinearGradient
      colors={[a, b]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.base,
        { width: size, height: size, borderRadius: channel ? size * 0.3 : size / 2 },
      ]}
    >
      <View style={styles.sheen} />
      <Text
        style={{ fontFamily: fonts.semibold, fontSize: size * 0.38, color: theme.colors.onAccent }}
      >
        {channel ? '#' : initials(name)}
      </Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  sheen: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: '-50%',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
  },
});

/** Avatar for a member: their profile photo, kept current, or initials. */
export function PersonAvatar({
  userId,
  name,
  size,
}: {
  userId: string | null | undefined;
  name: string;
  size?: number;
}) {
  const uri = useAvatarUri(userId);
  return <Avatar name={name} size={size} uri={uri} />;
}
