import type { ConnectorDescriptor, ConnectorMode } from '@sampledge/contracts';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { alpha, radius, space, type as typeScale } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export const MODE_LABEL: Record<ConnectorMode, string> = {
  two_way: 'Two-way',
  limited: 'Limited',
  handoff: 'Handoff',
};
export const MODE_TONE = { two_way: 'success', limited: 'warning', handoff: 'muted' } as const;
export const MODE_HELP: Record<ConnectorMode, string> = {
  two_way: 'Receive and reply from the inbox',
  limited: 'Works with real limits from the provider',
  handoff: 'No business API: agents reply in the app, the inbox keeps the record',
};

export const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'never';

/** A labelled text box in the inbox admin screens. */
export function Field({ label, help, ...rest }: TextInputProps & { label: string; help?: string }) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={{ gap: 4 }}>
      <Text variant="label">{label}</Text>
      <TextInput
        placeholderTextColor={c.textSubtle}
        accessibilityLabel={label}
        autoCorrect={false}
        {...rest}
        style={[
          typeScale.body,
          styles.input,
          { color: c.text, borderColor: c.border, backgroundColor: c.surfaceSunken },
          rest.multiline ? { minHeight: 80, textAlignVertical: 'top' } : null,
        ]}
      />
      {help ? (
        <Text variant="meta" tone="subtle">
          {help}
        </Text>
      ) : null}
    </View>
  );
}

/** One box per credential the provider needs. Secrets are write-only: the hint shows what is kept. */
export function CredentialInputs({
  descriptor,
  values,
  onChange,
  hints,
}: {
  descriptor: ConnectorDescriptor;
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  hints?: Record<string, string>;
}) {
  return (
    <View style={{ gap: space.md }}>
      {descriptor.credentialFields.map((f) => (
        <Field
          key={f.key}
          label={`${f.label}${f.required ? '' : ' (optional)'}`}
          help={f.help}
          value={values[f.key] ?? ''}
          onChangeText={(v) => onChange({ ...values, [f.key]: v })}
          placeholder={hints?.[f.key] ? `Kept: ${hints[f.key]}` : (f.placeholder ?? '')}
          secureTextEntry={f.secret}
          autoCapitalize="none"
        />
      ))}
    </View>
  );
}

export function Notice({ text, tone }: { text: string; tone: 'danger' | 'success' | 'warning' }) {
  const { theme } = useTheme();
  const color = theme.colors[tone];
  return (
    <View
      style={[styles.notice, { backgroundColor: alpha(color, 0.12) }]}
      accessibilityLiveRegion="polite"
    >
      <Text variant="meta" style={{ color }}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  notice: { padding: space.md, borderRadius: radius.md },
});
