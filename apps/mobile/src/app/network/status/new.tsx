import { Ionicons } from '@expo/vector-icons';
import {
  STATUS_BACKGROUNDS,
  uuidv7,
  type Connection,
  type NetworkStatus,
} from '@sampledge/contracts';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { Button } from '../../../components/Button';
import { Chips } from '../../../components/Chips';
import { Glass } from '../../../components/Glass';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { keepPickedFile } from '../../../lib/localFiles';
import { AUDIENCE_LABEL, STATUS_GRADIENT } from '../../../lib/network';
import { useWorkspace } from '../../../state/AppProvider';
import { useNet } from '../../../state/useNetwork';
import { fonts, radius, space } from '../../../theme/themes';
import { useTheme } from '../../../theme/ThemeProvider';

type Kind = NetworkStatus['kind'];
type Media = { localUri: string; fileName: string; mimeType: string; sizeBytes: number };

const HOURS: { key: string; label: string; hours: number }[] = [
  { key: '1', label: '1 hour', hours: 1 },
  { key: '6', label: '6 hours', hours: 6 },
  { key: '24', label: '24 hours', hours: 24 },
  { key: '72', label: '3 days', hours: 72 },
  { key: '168', label: '7 days', hours: 168 },
];
const MAX_BYTES = 64 * 1024 * 1024;

/**
 * A new status: text on a colour, or a photo or video, for an audience and a time. Works
 * offline: it is kept on the phone (the photo or video too) and goes up once you're online.
 */
export default function NewStatus() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const connections = useNet<Connection[]>('/v1/network/connections');
  const [kind, setKind] = useState<Kind>('text');
  const [text, setText] = useState('');
  const [bg, setBg] = useState<NetworkStatus['background']>('ocean');
  const [media, setMedia] = useState<Media | null>(null);
  const [audience, setAudience] = useState<NetworkStatus['audience']>('connections');
  const [picked, setPicked] = useState<string[]>([]);
  const [hours, setHours] = useState('24');
  const [allowReplies, setAllowReplies] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pick = async (k: Exclude<Kind, 'text'>) => {
    setError(null);
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: [k === 'image' ? 'images' : 'videos'],
      quality: 0.85,
    });
    const a = r.canceled ? null : r.assets[0];
    if (!a) return;
    const mimeType = a.mimeType ?? (k === 'image' ? 'image/jpeg' : 'video/mp4');
    const fileName = a.fileName ?? `status.${mimeType.split('/')[1] ?? 'bin'}`;
    const sizeBytes = a.fileSize ?? 0;
    if (sizeBytes > MAX_BYTES) return setError('That file is over 64 MB.');
    setMedia({ localUri: await keepPickedFile(a.uri, fileName), fileName, mimeType, sizeBytes });
    setKind(k);
  };

  const ready =
    (kind === 'text' ? text.trim().length > 0 : !!media) &&
    (audience !== 'selected' || picked.length > 0);

  const post = async () => {
    if (!ready) return;
    await engine.netAct({
      method: 'POST',
      path: '/v1/network/statuses',
      body: {
        clientStatusId: uuidv7(),
        kind,
        text: text.trim(),
        background: bg,
        attachmentId: null,
        audience,
        userIds: audience === 'selected' ? picked : [],
        expiresInHours: Number(hours),
        allowReplies,
      },
      label: kind === 'text' ? 'New status' : `New ${kind === 'image' ? 'photo' : 'video'} status`,
      scopes: ['statuses'],
      ...(kind !== 'text' && media ? { media } : {}),
    });
    router.back();
  };

  return (
    <Screen edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}
        keyboardShouldPersistTaps="handled"
      >
        <Chips
          label="Kind"
          options={[
            { key: 'text', label: 'Text' },
            { key: 'image', label: 'Photo' },
            { key: 'video', label: 'Video' },
          ]}
          selected={[kind]}
          onToggle={(k) => (k === 'text' ? setKind('text') : void pick(k))}
        />

        {kind === 'text' ? (
          <>
            <LinearGradient
              colors={STATUS_GRADIENT[bg]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.card}
            >
              <TextInput
                value={text}
                onChangeText={setText}
                maxLength={700}
                multiline
                placeholder="What’s new?"
                placeholderTextColor="rgba(255,255,255,0.6)"
                accessibilityLabel="Status text"
                style={styles.cardText}
              />
            </LinearGradient>
            <View
              style={styles.swatches}
              accessibilityRole="radiogroup"
              accessibilityLabel="Colour"
            >
              {STATUS_BACKGROUNDS.map((b) => (
                <Pressable
                  key={b}
                  onPress={() => setBg(b)}
                  accessibilityRole="radio"
                  accessibilityLabel={b}
                  aria-checked={bg === b}
                >
                  <LinearGradient
                    colors={STATUS_GRADIENT[b]}
                    style={[styles.swatch, { borderColor: bg === b ? c.text : 'transparent' }]}
                  />
                </Pressable>
              ))}
            </View>
          </>
        ) : media ? (
          <View style={{ gap: space.sm }}>
            <View
              style={[styles.card, { backgroundColor: '#000', padding: 0, overflow: 'hidden' }]}
            >
              {kind === 'image' ? (
                <Image
                  source={{ uri: media.localUri }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                />
              ) : (
                <VideoPreview uri={media.localUri} />
              )}
            </View>
            <TextInput
              value={text}
              onChangeText={setText}
              maxLength={700}
              placeholder="Add a caption"
              placeholderTextColor={c.textSubtle}
              accessibilityLabel="Caption"
              style={[
                styles.input,
                { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
              ]}
            />
            <Button
              title={`Choose another ${kind === 'image' ? 'photo' : 'video'}`}
              kind="quiet"
              onPress={() => void pick(kind)}
            />
          </View>
        ) : (
          <Button
            title={`Choose a ${kind === 'image' ? 'photo' : 'video'}`}
            icon="images-outline"
            onPress={() => void pick(kind)}
          />
        )}

        <Glass style={{ padding: space.lg, gap: space.md }}>
          <Text variant="label" tone="muted">
            Who can see it
          </Text>
          <Chips
            label="Who can see it"
            options={(Object.keys(AUDIENCE_LABEL) as NetworkStatus['audience'][]).map((k) => ({
              key: k,
              label: AUDIENCE_LABEL[k],
            }))}
            selected={[audience]}
            onToggle={setAudience}
          />
          {audience === 'selected' ? (
            connections.data?.length ? (
              <Chips
                multi
                label="People"
                options={connections.data.map((x) => ({
                  key: x.person.userId,
                  label: x.person.displayName,
                }))}
                selected={picked}
                onToggle={(id) =>
                  setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
                }
              />
            ) : (
              <Text variant="meta" tone="muted">
                Connect with people first to share with a few of them.
              </Text>
            )
          ) : null}
          <Text variant="label" tone="muted">
            Disappears after
          </Text>
          <Chips
            label="Disappears after"
            options={HOURS.map((h) => ({ key: h.key, label: h.label }))}
            selected={[hours]}
            onToggle={setHours}
          />
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text variant="label">Allow replies</Text>
              <Text variant="meta" tone="muted">
                Replies arrive in your chat with that person.
              </Text>
            </View>
            <Switch
              value={allowReplies}
              onValueChange={setAllowReplies}
              accessibilityLabel="Allow replies"
              trackColor={{ true: c.accent, false: c.border }}
            />
          </View>
        </Glass>

        {error ? (
          <Text tone="danger" variant="label">
            {error}
          </Text>
        ) : null}
        <Button title="Post status" icon="send" disabled={!ready} onPress={() => void post()} />
        <View style={styles.note}>
          <Ionicons name="cloud-offline-outline" size={14} color={c.textSubtle} />
          <Text variant="meta" tone="subtle" style={{ flex: 1 }}>
            Offline, it waits on this phone, photo or video included, and goes up when you’re back
            online.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = true;
    p.muted = true;
  });
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    height: 260,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  cardText: {
    width: '100%',
    color: '#fff',
    fontFamily: fonts.semibold,
    fontSize: 24,
    lineHeight: 32,
    textAlign: 'center',
  },
  swatches: { flexDirection: 'row', gap: space.sm },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 2 },
  input: {
    fontFamily: fonts.regular,
    fontSize: 16,
    paddingHorizontal: space.md,
    paddingVertical: 11,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  note: { flexDirection: 'row', gap: 6, alignItems: 'center' },
});
