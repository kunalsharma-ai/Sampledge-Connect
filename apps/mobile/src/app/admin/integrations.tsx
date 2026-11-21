import { Ionicons } from '@expo/vector-icons';
import {
  INTEGRATION_CATEGORIES,
  INTEGRATION_CATEGORY_LABELS,
  type IntegrationFieldDef,
  type IntegrationView,
} from '@sampledge/contracts';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { Button } from '../../components/Button';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { canInWorkspace } from '../../lib/access';
import { confirmThen } from '../../lib/confirm';
import {
  draftFrom,
  SOURCE_LABEL,
  validateDraft,
  valuesForSave,
  type IntegrationDraft,
} from '../../lib/integrations';
import { useApp, useWorkspace } from '../../state/AppProvider';
import { useTenantRole } from '../../state/hooks';
import { alpha, radius, space, type as typeScale } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * Administration, Integrations: every connection (email, calls, push, AI, modules) is stored
 * in the server's database and takes effect at once, no restart or env change. Secrets are
 * write-only: the phone can replace or remove them but never sees them.
 */
export default function Integrations() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const { engineState } = useApp();
  const role = useTenantRole();
  const allowed = canInWorkspace(role, 'integrations.manage');
  const [views, setViews] = useState<IntegrationView[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = engine.serverActionBlocker();

  const load = useCallback(async () => {
    if (!allowed || engine.serverActionBlocker()) return;
    setLoading(true);
    try {
      setViews(await engine.listIntegrations());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [engine, allowed]);

  useEffect(() => {
    void load();
  }, [load, engineState?.networkUp]);
  // Another admin saved a setting elsewhere: show it here (unless a form is open).
  useEffect(
    () => engine.events.on('tenant', (e) => e.area === 'integrations' && !open && void load()),
    [engine, load, open],
  );

  const replace = (v: IntegrationView) =>
    setViews((all) => (all ?? []).map((x) => (x.provider.id === v.provider.id ? v : x)));

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Integrations' }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={loading && !!views}
            onRefresh={() => void load()}
            tintColor={c.accent}
          />
        }
      >
        <Text tone="muted">
          Connections to email, calls, push and other services are saved on your server and apply
          straight away. Passwords and keys are stored encrypted and are never shown again.
        </Text>
        {!allowed ? (
          <Note color={c.warning}>Only owners and admins can change integrations.</Note>
        ) : blocked || error ? (
          <Note color={error ? c.danger : c.warning}>{error ?? blocked}</Note>
        ) : null}
        {allowed && views
          ? INTEGRATION_CATEGORIES.map((cat) => {
              const inCat = views.filter((v) => v.provider.category === cat);
              if (!inCat.length) return null;
              return (
                <View key={cat} style={{ gap: space.sm }}>
                  <Text variant="overline" tone="subtle" style={{ marginLeft: space.xs }}>
                    {INTEGRATION_CATEGORY_LABELS[cat]}
                  </Text>
                  {inCat.map((v) => (
                    <ProviderCard
                      key={v.provider.id}
                      view={v}
                      open={open === v.provider.id}
                      onToggle={() => setOpen((o) => (o === v.provider.id ? null : v.provider.id))}
                      onSaved={replace}
                      disabled={!!blocked}
                    />
                  ))}
                </View>
              );
            })
          : null}
      </ScrollView>
    </Screen>
  );
}

function Note({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <View style={[styles.note, { backgroundColor: alpha(color, 0.12) }]}>
      <Text variant="meta" style={{ color }} accessibilityLiveRegion="polite">
        {children}
      </Text>
    </View>
  );
}

function ProviderCard({
  view: v,
  open,
  onToggle,
  onSaved,
  disabled,
}: {
  view: IntegrationView;
  open: boolean;
  onToggle: () => void;
  onSaved: (v: IntegrationView) => void;
  disabled: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const [draft, setDraft] = useState<IntegrationDraft>(() => draftFrom(v));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'save' | 'test' | 'reset' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const p = v.provider;
  const secretsSet = v.saved?.secretsSet ?? [];

  useEffect(() => {
    if (!open) {
      setDraft(draftFrom(v));
      setErrors({});
    }
  }, [v, open]);

  const status = p.planned
    ? { label: 'Planned', color: c.textSubtle }
    : v.enabled
      ? { label: 'On', color: c.success }
      : { label: 'Off', color: c.textSubtle };
  const test = v.lastTest;

  const run = async (kind: 'save' | 'test' | 'reset') => {
    setResult(null);
    if (kind !== 'reset') {
      const e = validateDraft(p, kind === 'test' ? { ...draft, enabled: true } : draft, secretsSet);
      setErrors(e);
      if (Object.keys(e).length) return;
    }
    setBusy(kind);
    try {
      if (kind === 'save') {
        const saved = await engine.saveIntegration(p.id, draft.enabled, valuesForSave(p, draft));
        // Start again from what the server stored, so a new secret shows as "Stored securely".
        setDraft(draftFrom(saved));
        onSaved(saved);
        setResult({ ok: true, message: 'Saved. It applies straight away.' });
      } else if (kind === 'test') {
        const r = await engine.testIntegration(p.id, valuesForSave(p, draft));
        setResult({ ok: r.ok, message: r.message });
      } else {
        const reset = await engine.resetIntegration(p.id);
        setDraft(draftFrom(reset));
        onSaved(reset);
        setResult({ ok: true, message: 'Removed this organization’s settings.' });
      }
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  // Editing a field clears its error; the rest stay until the next Save or Test.
  const clearError = (key: string) =>
    setErrors((e) => {
      if (!(key in e)) return e;
      const { [key]: _gone, ...rest } = e;
      return rest;
    });
  const set = (key: string, value: string | boolean) => {
    clearError(key);
    setDraft((d) => ({ ...d, values: { ...d.values, [key]: value } }));
  };
  const field = [
    typeScale.body,
    styles.input,
    { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
  ];

  const renderField = (f: IntegrationFieldDef) => {
    const err = errors[f.key];
    const label = (
      <Text variant="label" tone="muted">
        {f.label}
        {f.required ? ' *' : ''}
      </Text>
    );
    let input: React.ReactNode;
    if (f.type === 'boolean') {
      return (
        <View key={f.key} style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            {label}
            {f.help ? (
              <Text variant="meta" tone="subtle">
                {f.help}
              </Text>
            ) : null}
          </View>
          <Switch
            value={draft.values[f.key] === true}
            onValueChange={(on) => set(f.key, on)}
            accessibilityLabel={f.label}
          />
        </View>
      );
    } else if (f.type === 'select') {
      input = (
        <View style={styles.wrap} accessibilityRole="radiogroup">
          {(f.options ?? []).map((o) => {
            const on = draft.values[f.key] === o.value;
            return (
              <Pressable
                key={o.value}
                onPress={() => set(f.key, o.value)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: on ? c.accent : c.surfaceRaised,
                    borderColor: on ? c.accent : c.border,
                  },
                ]}
              >
                <Text variant="label" style={{ color: on ? c.onAccent : c.text }}>
                  {o.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      );
    } else if (f.type === 'secret') {
      const e = draft.secrets[f.key] ?? { kind: 'keep' };
      const stored = secretsSet.includes(f.key);
      const setSecret = (s: IntegrationDraft['secrets'][string]) => {
        clearError(f.key);
        setDraft((d) => ({ ...d, secrets: { ...d.secrets, [f.key]: s } }));
      };
      input =
        e.kind === 'replace' || !stored ? (
          <View style={styles.secretRow}>
            <TextInput
              value={e.kind === 'replace' ? e.value : ''}
              onChangeText={(t) => setSecret({ kind: 'replace', value: t })}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={stored ? 'New value' : 'Not set'}
              placeholderTextColor={c.textSubtle}
              accessibilityLabel={f.label}
              style={[field, { flex: 1 }]}
            />
            {stored ? (
              <Button
                title="Keep"
                kind="quiet"
                onPress={() => setSecret({ kind: 'keep' })}
                accessibilityLabel={`Keep the stored ${f.label}`}
                style={styles.small}
              />
            ) : null}
          </View>
        ) : (
          <View style={styles.secretRow}>
            <Ionicons
              name={e.kind === 'remove' ? 'trash-outline' : 'lock-closed'}
              size={16}
              color={e.kind === 'remove' ? c.danger : c.success}
            />
            <Text
              variant="meta"
              style={{ flex: 1, color: e.kind === 'remove' ? c.danger : c.textMuted }}
            >
              {e.kind === 'remove' ? 'Will be removed when you save' : 'Stored securely'}
            </Text>
            {e.kind === 'remove' ? (
              <Button
                title="Undo"
                kind="quiet"
                onPress={() => setSecret({ kind: 'keep' })}
                style={styles.small}
              />
            ) : (
              <>
                <Button
                  title="Replace"
                  kind="quiet"
                  onPress={() => setSecret({ kind: 'replace', value: '' })}
                  accessibilityLabel={`Replace ${f.label}`}
                  style={styles.small}
                />
                <Button
                  title="Remove"
                  kind="quiet"
                  onPress={() => setSecret({ kind: 'remove' })}
                  accessibilityLabel={`Remove ${f.label}`}
                  style={styles.small}
                />
              </>
            )}
          </View>
        );
    } else {
      input = (
        <TextInput
          value={String(draft.values[f.key] ?? '')}
          onChangeText={(t) => set(f.key, t)}
          placeholder={f.placeholder ?? (f.default !== undefined ? String(f.default) : undefined)}
          placeholderTextColor={c.textSubtle}
          keyboardType={
            f.type === 'number'
              ? 'number-pad'
              : f.type === 'email'
                ? 'email-address'
                : f.type === 'url'
                  ? 'url'
                  : 'default'
          }
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={f.label}
          style={[field, err ? { borderColor: c.danger } : null]}
        />
      );
    }
    return (
      <View key={f.key} style={{ gap: 4 }}>
        {label}
        {input}
        {err ? (
          <Text variant="meta" tone="danger">
            {err}
          </Text>
        ) : f.help ? (
          <Text variant="meta" tone="subtle">
            {f.help}
          </Text>
        ) : null}
      </View>
    );
  };

  return (
    <Glass style={{ overflow: 'hidden' }}>
      <Pressable
        onPress={p.planned ? undefined : onToggle}
        disabled={p.planned}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${p.label}, ${status.label}${p.planned ? '' : open ? '. Collapse' : '. Configure'}`}
        style={styles.head}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{p.label}</Text>
          <Text variant="meta" tone="muted">
            {p.description}
          </Text>
          {v.source ? (
            <Text variant="meta" tone="subtle">
              {SOURCE_LABEL[v.source]}
            </Text>
          ) : null}
          {test ? (
            <Text
              variant="meta"
              style={{ color: test.ok ? c.success : c.danger }}
              numberOfLines={2}
            >
              {test.ok ? 'Last test passed' : 'Last test failed'}: {test.message}
            </Text>
          ) : null}
        </View>
        <View style={[styles.pill, { backgroundColor: alpha(status.color, 0.14) }]}>
          <Text variant="meta" style={{ color: status.color }}>
            {status.label}
          </Text>
        </View>
        {p.planned ? null : (
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={c.textSubtle} />
        )}
      </Pressable>
      {open ? (
        <View style={[styles.body, { borderTopColor: c.border }]}>
          <View style={styles.switchRow}>
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              Use this integration
            </Text>
            <Switch
              value={draft.enabled}
              onValueChange={(on) => setDraft((d) => ({ ...d, enabled: on }))}
              accessibilityLabel={`Use ${p.label}`}
            />
          </View>
          {p.fields.map(renderField)}
          {result ? (
            <Text
              variant="meta"
              style={{ color: result.ok ? c.success : c.danger }}
              accessibilityLiveRegion="polite"
            >
              {result.message}
            </Text>
          ) : null}
          <View style={styles.actions}>
            {p.testable ? (
              <Button
                title="Test connection"
                kind="quiet"
                icon="pulse-outline"
                busy={busy === 'test'}
                disabled={disabled || !!busy}
                onPress={() => void run('test')}
              />
            ) : null}
            <Button
              title="Save"
              icon="checkmark"
              busy={busy === 'save'}
              disabled={disabled || !!busy}
              onPress={() => void run('save')}
              accessibilityLabel={`Save ${p.label}`}
            />
          </View>
          {v.saved ? (
            <Button
              title="Remove this organization’s settings"
              kind="danger"
              busy={busy === 'reset'}
              disabled={disabled || !!busy}
              onPress={() =>
                confirmThen(
                  `Remove the settings for ${p.label}?`,
                  'It falls back to the platform default or the server environment, if there is one. Stored secrets are deleted.',
                  'Remove',
                  () => void run('reset'),
                )
              }
            />
          ) : null}
        </View>
      ) : null}
    </Glass>
  );
}

const styles = StyleSheet.create({
  note: { padding: space.md, borderRadius: radius.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
  body: {
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  secretRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  small: { paddingVertical: 6, paddingHorizontal: space.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actions: { flexDirection: 'row', gap: space.sm, justifyContent: 'flex-end', flexWrap: 'wrap' },
});
