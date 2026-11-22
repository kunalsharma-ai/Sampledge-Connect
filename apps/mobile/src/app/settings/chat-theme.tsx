import { Ionicons } from '@expo/vector-icons';
import {
  CHAT_THEMES,
  customImagesAllowed,
  type ChatThemeId,
  type ChatThemePolicy,
} from '@sampledge/contracts';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { router } from 'expo-router';
import { Button } from '../../components/Button';
import { PhotoBackdrop } from '../../components/ChatBackdrop';
import { useChatImageSlot } from '../../lib/chatImageStore';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { CATEGORY_LABEL, chatLook, choiceFor } from '../../lib/chatTheme';
import { useApp, useWorkspace } from '../../state/AppProvider';
import { useTenantRole } from '../../state/hooks';
import { useChatTheme } from '../../state/useChatTheme';
import { alpha, radius, space, type Theme } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const CATS = Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[];

/** Chat theme: how conversations look. Synced to all your devices; admins set the rules. */
export default function ChatThemeScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  useApp();
  const role = useTenantRole();
  const isAdmin = role === 'owner' || role === 'admin';
  const { state } = useChatTheme();
  const [managing, setManaging] = useState(false);
  const [draft, setDraft] = useState<ChatThemePolicy | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const blocked = engine.serverActionBlocker();
  useEffect(() => {
    if (state) setDraft(state.policy);
  }, [state?.policy]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state || !draft)
    return (
      <Screen edges={['bottom']}>
        <View style={{ padding: space.lg }}>
          <OwnPictureRow />
          <Text tone="muted" style={{ marginTop: space.lg }}>
            {blocked
              ? `${blocked} Your chat theme loads the first time you are online.`
              : 'Loading your chat theme…'}
          </Text>
        </View>
      </Screen>
    );

  const policy = state.policy;
  const offered = (id: ChatThemeId) => !policy.allowed || policy.allowed.includes(id);
  const ticked = (id: ChatThemeId) => !draft.allowed || draft.allowed.includes(id);
  const pick = (id: ChatThemeId) => {
    setNote(null);
    if (managing) {
      const all = draft.allowed ?? CHAT_THEMES.map((t) => t.id);
      const next = all.includes(id) ? all.filter((x) => x !== id) : [...all, id];
      setDraft({ ...draft, allowed: next.length ? next : [draft.defaultThemeId] });
      return;
    }
    void engine.setChatTheme(choiceFor(id, policy, state.themeId));
  };
  const saveRules = async () => {
    setBusy(true);
    try {
      await engine.setChatThemePolicy(draft);
      setNote({ ok: true, text: 'Chat theme rules saved. Everyone’s devices update now.' });
      setManaging(false);
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const changed = JSON.stringify(draft) !== JSON.stringify(policy);

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}>
        <Text tone="muted">
          How your conversations look: the background and your message bubbles. Works with your app
          theme and follows you to every device.
        </Text>
        {customImagesAllowed(policy) ? <OwnPictureRow /> : null}
        {isAdmin ? (
          <Glass>
            <View style={{ padding: space.lg, gap: space.md }}>
              <View style={styles.rowBetween}>
                <Text variant="bodyStrong">Organization rules</Text>
                <Button
                  title={managing ? 'Done' : 'Manage'}
                  kind="quiet"
                  onPress={() => setManaging((m) => !m)}
                  style={{ paddingVertical: 6, paddingHorizontal: space.md }}
                />
              </View>
              <Text variant="meta" tone="muted">
                Default for everyone: {CHAT_THEMES.find((t) => t.id === draft.defaultThemeId)?.name}
                .{' '}
                {draft.allowed
                  ? `People can choose ${draft.allowed.length} of ${CHAT_THEMES.length} themes.`
                  : 'People can choose any theme.'}{' '}
                {customImagesAllowed(draft) ? 'Own pictures allowed.' : 'Own pictures off.'}
              </Text>
              {managing ? (
                <>
                  <Text variant="meta" tone="muted">
                    Tap themes to offer or hide them. Long-press a theme to make it the default.
                  </Text>
                  <View style={styles.chips}>
                    {(['all', 'some'] as const).map((k) => {
                      const on = (k === 'all') === !draft.allowed;
                      return (
                        <Pressable
                          key={k}
                          onPress={() =>
                            setDraft({
                              ...draft,
                              allowed:
                                k === 'all' ? null : (policy.allowed ?? [draft.defaultThemeId]),
                            })
                          }
                          accessibilityRole="radio"
                          accessibilityState={{ checked: on }}
                          aria-checked={on}
                          style={[
                            styles.chip,
                            {
                              borderColor: on ? c.accent : c.border,
                              backgroundColor: on ? alpha(c.accent, 0.14) : 'transparent',
                            },
                          ]}
                        >
                          <Text variant="label" style={{ color: on ? c.accent : c.text }}>
                            {k === 'all' ? 'Any theme' : 'Only the ticked themes'}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1 }}>
                      <Text variant="label">Let people use their own pictures</Text>
                      <Text variant="meta" tone="muted">
                        Pictures stay on each person’s device; turning this off hides them.
                      </Text>
                    </View>
                    <Switch
                      value={customImagesAllowed(draft)}
                      onValueChange={(on) => setDraft({ ...draft, allowCustomImages: on })}
                      accessibilityLabel="Let people use their own pictures"
                      trackColor={{ true: c.accent, false: c.border }}
                    />
                  </View>
                  <Button
                    title={blocked ? 'Needs a connection' : 'Save rules'}
                    onPress={() => void saveRules()}
                    busy={busy}
                    disabled={!!blocked || !changed}
                  />
                </>
              ) : null}
            </View>
          </Glass>
        ) : policy.allowed ? (
          <Text variant="meta" tone="muted">
            Your organization offers {policy.allowed.length} of {CHAT_THEMES.length} themes.
          </Text>
        ) : null}
        {note ? (
          <Text variant="meta" tone={note.ok ? 'muted' : 'danger'} accessibilityLiveRegion="polite">
            {note.text}
          </Text>
        ) : null}
        {CATS.map((cat) => {
          const list = CHAT_THEMES.filter((t) => t.category === cat && (managing || offered(t.id)));
          if (!list.length) return null;
          return (
            <View key={cat} style={{ gap: space.sm }}>
              <Text variant="label" tone="muted">
                {CATEGORY_LABEL[cat]}
              </Text>
              <View style={styles.grid}>
                {list.map((t) => (
                  <ThemeTile
                    key={t.id}
                    id={t.id}
                    name={t.name}
                    description={t.description}
                    theme={theme}
                    selected={managing ? ticked(t.id) : state.effective === t.id}
                    isDefault={draft.defaultThemeId === t.id}
                    managing={managing}
                    onPress={() => pick(t.id)}
                    onLongPress={
                      managing
                        ? () =>
                            setDraft({
                              defaultThemeId: t.id,
                              allowed: draft.allowed
                                ? [...new Set([t.id, ...draft.allowed])]
                                : null,
                            })
                        : undefined
                    }
                  />
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

/** Your own picture from this phone, edited in the chat background screen. */
function OwnPictureRow() {
  const { theme } = useTheme();
  const c = theme.colors;
  const image = useChatImageSlot(null);
  return (
    <Glass>
      <Pressable
        onPress={() => router.push('/chat-background')}
        accessibilityRole="button"
        accessibilityLabel={image ? 'Your picture, edit' : 'Use your own picture'}
        style={styles.ownRow}
      >
        <View
          style={[styles.ownThumb, { borderColor: c.border, backgroundColor: c.surfaceSunken }]}
        >
          {image ? (
            <PhotoBackdrop image={image} base={c.background} testID="own-picture-thumb" />
          ) : (
            <Ionicons name="image-outline" size={22} color={c.accent} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">{image ? 'Your picture' : 'Use your own picture'}</Text>
          <Text variant="meta" tone="muted">
            {image
              ? 'Shown behind all chats on this phone. Tap to edit or change it.'
              : 'Pick any photo from this phone and edit it. Kept on this phone only.'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
      </Pressable>
    </Glass>
  );
}

function ThemeTile({
  id,
  name,
  description,
  theme,
  selected,
  isDefault,
  managing,
  onPress,
  onLongPress,
}: {
  id: ChatThemeId;
  name: string;
  description: string;
  theme: Theme;
  selected: boolean;
  isDefault: boolean;
  managing: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const c = theme.colors;
  const look = useMemo(() => chatLook(id, c, theme.dark), [id, c, theme.dark]);
  const [w, setW] = useState(160);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole={managing ? 'checkbox' : 'radio'}
      accessibilityState={managing ? { checked: selected } : { selected }}
      aria-checked={selected}
      accessibilityLabel={`${name}${isDefault ? ', organization default' : ''}`}
      accessibilityHint={description}
      style={[styles.tile, { borderColor: selected ? c.accent : c.border }]}
    >
      <View
        style={[styles.preview, { backgroundColor: look.base }]}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
      >
        {look.fillXml ? (
          <View style={StyleSheet.absoluteFill}>
            <SvgXml xml={look.fillXml} width="100%" height="100%" />
          </View>
        ) : null}
        {look.scene ? (
          <View style={styles.scene}>
            <SvgXml xml={look.scene.xml} width={w} height={w / look.scene.aspect} />
          </View>
        ) : null}
        <View style={[styles.mock, { backgroundColor: look.bubbleOther, width: '62%' }]}>
          <View style={[styles.line, { backgroundColor: alpha(c.text, 0.5) }]} />
        </View>
        <View
          style={[
            styles.mock,
            { backgroundColor: look.bubbleOwn, width: '54%', alignSelf: 'flex-end' },
          ]}
        >
          <View style={[styles.line, { backgroundColor: alpha(look.bubbleOwnFg, 0.85) }]} />
        </View>
        {selected ? (
          <View style={[styles.check, { backgroundColor: c.accent }]}>
            <Ionicons name="checkmark" size={14} color={c.onAccent} />
          </View>
        ) : null}
      </View>
      <View style={{ padding: space.sm }}>
        <Text variant="label" numberOfLines={1}>
          {name}
        </Text>
        <Text variant="meta" tone="subtle" numberOfLines={1}>
          {isDefault ? 'Organization default' : description}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ownRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  ownThumb: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: space.md,
  },
  tile: {
    width: '48%',
    borderWidth: 2,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  preview: { height: 104, padding: space.sm, gap: 6, justifyContent: 'center', overflow: 'hidden' },
  scene: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  mock: { height: 22, borderRadius: 11, justifyContent: 'center', paddingHorizontal: 10 },
  line: { height: 5, borderRadius: 3, width: '70%' },
  check: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
