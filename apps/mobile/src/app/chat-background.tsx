import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '../components/Button';
import { PhotoBackdrop } from '../components/ChatBackdrop';
import { Chips } from '../components/Chips';
import { Glass } from '../components/Glass';
import { Screen } from '../components/Screen';
import { Slider } from '../components/Slider';
import { Text } from '../components/Text';
import {
  BLUR_STEPS,
  CHAT_IMAGE_FILTERS,
  NO_EDITS,
  ZOOM_STEPS,
  type ChatImage,
} from '../lib/chatImage';
import {
  adjustChatImage,
  chooseChatImage,
  saveChatImage,
  transformChatImage,
  useChatImageSlot,
} from '../lib/chatImageStore';
import { confirmThen } from '../lib/confirm';
import { useChatTheme } from '../state/useChatTheme';
import { customImagesAllowed } from '@sampledge/contracts';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';

type Tab = 'adjust' | 'filters' | 'crop';
const pct = (v: number) => `${Math.round(v * 100)}%`;
const signed = (v: number) => (v > 0 ? `+${Math.round(v * 100)}` : `${Math.round(v * 100)}`);

/**
 * Your own picture behind chats, with a photo editor. For all chats, or (with a conversationId)
 * for one conversation, which wins over the one for all chats. Kept on this phone only.
 */
export default function ChatBackgroundScreen() {
  const { conversationId, title } = useLocalSearchParams<{
    conversationId?: string;
    title?: string;
  }>();
  const slot = conversationId ?? null;
  const { theme } = useTheme();
  const c = theme.colors;
  const image = useChatImageSlot(slot);
  const { look, state } = useChatTheme();
  const allowed = !state || customImagesAllowed(state.policy);
  const [tab, setTab] = useState<Tab>('adjust');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [box, setBox] = useState({ w: 1, h: 1 });

  const set = (patch: Partial<ChatImage>) => adjustChatImage(slot, patch);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setNote(null);
    try {
      await f();
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const pick = () =>
    run(async () => {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (r.canceled || !r.assets[0]) return;
      const a = r.assets[0];
      await chooseChatImage(slot, { uri: a.uri, width: a.width, height: a.height });
      setNote({ ok: true, text: 'Saved on this phone.' });
    });
  const remove = () =>
    confirmThen(
      'Remove this picture?',
      slot
        ? 'This conversation goes back to your picture for all chats, or your chat theme.'
        : 'Chats go back to your chat theme.',
      'Remove',
      () => saveChatImage(slot, null),
    );

  const base = look?.base ?? c.background;
  const own = look?.bubbleOwn ?? c.bubbleOwn;
  const ownFg = look?.bubbleOwnFg ?? c.bubbleOwnText;
  const other = look?.bubbleOther ?? c.bubbleOther;

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{ title: slot ? `Background · ${title ?? 'Chat'}` : 'Chat background' }}
      />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}>
        <Text tone="muted">
          {slot
            ? 'A picture just for this conversation. It replaces your picture for all chats here.'
            : 'Your own picture behind every chat. Your chat theme still sets the bubble colors.'}{' '}
          Kept on this phone only; nothing is uploaded.
        </Text>

        {!allowed ? (
          <View style={[styles.notice, { backgroundColor: alpha(c.warning, 0.12) }]}>
            <Text variant="meta" style={{ color: c.warning }}>
              Your organization has turned off own pictures in chats. Your picture stays saved on
              this phone and shows again if they turn it back on.
            </Text>
          </View>
        ) : null}
        <Pressable
          onLayout={(e) =>
            setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
          }
          onPress={(e) =>
            image &&
            tab === 'crop' &&
            set({
              focusX: Math.min(1, Math.max(0, e.nativeEvent.locationX / box.w)),
              focusY: Math.min(1, Math.max(0, e.nativeEvent.locationY / box.h)),
            })
          }
          accessibilityRole={image && tab === 'crop' ? 'button' : 'image'}
          accessibilityLabel={
            image
              ? tab === 'crop'
                ? 'Preview. Tap the part of the picture to keep in view.'
                : 'Preview of your chat background'
              : 'No picture yet'
          }
          style={[styles.preview, { borderColor: c.border, backgroundColor: base }]}
          testID="chat-background-preview"
        >
          {image ? (
            <PhotoBackdrop image={image} base={base} testID="chat-background-photo" />
          ) : null}
          <View style={styles.mockArea} pointerEvents="none">
            <View style={[styles.bubble, { backgroundColor: other, alignSelf: 'flex-start' }]}>
              <Text style={{ color: c.text }}>Morning! Wave 3 is live.</Text>
            </View>
            <View style={[styles.bubble, { backgroundColor: own, alignSelf: 'flex-end' }]}>
              <Text style={{ color: ownFg }}>Great, I’ll check the quotas.</Text>
            </View>
            <View style={[styles.bubble, { backgroundColor: other, alignSelf: 'flex-start' }]}>
              <Text style={{ color: c.text }}>Thanks 🙌</Text>
            </View>
          </View>
          {image && tab === 'crop' ? (
            <View
              pointerEvents="none"
              style={[
                styles.focus,
                {
                  left: image.focusX * box.w - 14,
                  top: image.focusY * box.h - 14,
                  borderColor: '#FFFFFF',
                },
              ]}
            />
          ) : null}
        </Pressable>

        <View style={styles.row}>
          <Button
            title={image ? 'Replace photo' : 'Choose a photo'}
            onPress={() => void pick()}
            busy={busy}
            disabled={!allowed}
            style={{ flex: 1 }}
          />
          {image ? <Button title="Remove" kind="danger" onPress={remove} /> : null}
        </View>
        {note ? (
          <Text variant="meta" tone={note.ok ? 'muted' : 'danger'} accessibilityLiveRegion="polite">
            {note.text}
          </Text>
        ) : null}

        {image ? (
          <>
            <Chips
              label="Editor"
              options={[
                { key: 'adjust', label: 'Adjust' },
                { key: 'filters', label: 'Filters' },
                { key: 'crop', label: 'Crop & rotate' },
              ]}
              selected={[tab]}
              onToggle={(k) => setTab(k)}
            />
            <Glass>
              <View style={{ padding: space.lg, gap: space.md }}>
                {tab === 'adjust' ? (
                  <>
                    <Adjust label="Opacity" text={pct(image.opacity)}>
                      <Slider
                        label="Opacity"
                        valueText={pct(image.opacity)}
                        value={image.opacity}
                        min={0.2}
                        max={1}
                        step={0.05}
                        onChange={(opacity) => set({ opacity })}
                      />
                    </Adjust>
                    {(
                      [
                        ['brightness', 'Brightness'],
                        ['contrast', 'Contrast'],
                        ['saturation', 'Saturation'],
                        ['warmth', 'Warmth'],
                      ] as const
                    ).map(([k, label]) => (
                      <Adjust key={k} label={label} text={signed(image[k])}>
                        <Slider
                          label={label}
                          valueText={signed(image[k])}
                          value={image[k]}
                          min={-1}
                          max={1}
                          step={0.05}
                          centered
                          onChange={(v) => set({ [k]: v })}
                        />
                      </Adjust>
                    ))}
                    <Adjust label="Blur" text={`${Math.round(image.blur)} px`}>
                      <Slider
                        label="Blur"
                        valueText={`${Math.round(image.blur)} pixels`}
                        value={image.blur}
                        min={0}
                        max={24}
                        step={1}
                        onChange={(blur) => set({ blur })}
                      />
                    </Adjust>
                    <Adjust label="Dim for readability" text={pct(image.dim)}>
                      <Slider
                        label="Dim for readability"
                        valueText={pct(image.dim)}
                        value={image.dim}
                        min={0}
                        max={0.8}
                        step={0.05}
                        onChange={(dim) => set({ dim })}
                      />
                    </Adjust>
                    <Chips
                      label="Blur presets"
                      options={BLUR_STEPS.map((b) => ({
                        key: String(b.value),
                        label: `Blur ${b.label.toLowerCase()}`,
                      }))}
                      selected={[String(image.blur)]}
                      onToggle={(k) => set({ blur: Number(k) })}
                    />
                    <Button title="Reset edits" kind="quiet" onPress={() => set(NO_EDITS)} />
                  </>
                ) : null}
                {tab === 'filters' ? (
                  <View style={styles.filters}>
                    {CHAT_IMAGE_FILTERS.map((f) => {
                      const on = image.filter === f.key;
                      return (
                        <Pressable
                          key={f.key}
                          onPress={() => set({ filter: f.key })}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: on }}
                          aria-checked={on}
                          accessibilityLabel={`${f.label} filter`}
                          style={[styles.filterTile, { borderColor: on ? c.accent : c.border }]}
                        >
                          <View style={styles.filterThumb}>
                            <PhotoBackdrop
                              image={{ ...image, filter: f.key, dim: 0, blur: 0, opacity: 1 }}
                              base={base}
                              testID={`filter-${f.key}`}
                            />
                          </View>
                          <Text variant="meta" style={{ textAlign: 'center', paddingVertical: 4 }}>
                            {f.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
                {tab === 'crop' ? (
                  <>
                    <Text variant="meta" tone="muted">
                      Tap the preview to choose what stays in view, then zoom in to crop.
                    </Text>
                    <Chips
                      label="Zoom"
                      options={ZOOM_STEPS.map((z) => ({ key: String(z.value), label: z.label }))}
                      selected={[String(image.zoom)]}
                      onToggle={(k) => set({ zoom: Number(k) })}
                    />
                    <Adjust label="Zoom" text={`${image.zoom.toFixed(1)}×`}>
                      <Slider
                        label="Zoom"
                        valueText={`${image.zoom.toFixed(1)} times`}
                        value={image.zoom}
                        min={1}
                        max={3}
                        step={0.1}
                        onChange={(zoom) => set({ zoom })}
                      />
                    </Adjust>
                    <View style={styles.row}>
                      {(
                        [
                          ['Rotate left', 'arrow-undo', { rotate: -90 }],
                          ['Rotate right', 'arrow-redo', { rotate: 90 }],
                          ['Flip', 'swap-horizontal', { flip: 'horizontal' }],
                          ['Flip vertical', 'swap-vertical', { flip: 'vertical' }],
                        ] as const
                      ).map(([label, icon, t]) => (
                        <Pressable
                          key={label}
                          onPress={() => void run(() => transformChatImage(slot, t))}
                          disabled={busy}
                          accessibilityRole="button"
                          accessibilityLabel={label}
                          style={[styles.tool, { backgroundColor: alpha(c.accent, 0.12) }]}
                        >
                          <Ionicons name={icon} size={20} color={c.accent} />
                          <Text variant="meta" numberOfLines={1}>
                            {label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <Button
                      title="Center"
                      kind="quiet"
                      onPress={() => set({ focusX: 0.5, focusY: 0.5, zoom: 1 })}
                    />
                  </>
                ) : null}
              </View>
            </Glass>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Adjust({
  label,
  text,
  children,
}: {
  label: string;
  text: string;
  children: React.ReactNode;
}) {
  return (
    <View>
      <View style={styles.adjustHead}>
        <Text variant="label">{label}</Text>
        <Text variant="meta" tone="muted">
          {text}
        </Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  preview: {
    height: 300,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  mockArea: { flex: 1, justifyContent: 'flex-end', padding: space.md, gap: 8 },
  bubble: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '80%' },
  focus: { position: 'absolute', width: 28, height: 28, borderRadius: 14, borderWidth: 2 },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  notice: { padding: space.md, borderRadius: radius.md },
  adjustHead: { flexDirection: 'row', justifyContent: 'space-between' },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: space.md,
  },
  filterTile: { width: '31%', borderWidth: 2, borderRadius: radius.md, overflow: 'hidden' },
  filterThumb: { height: 72 },
  tool: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: space.sm,
    borderRadius: radius.md,
  },
});
