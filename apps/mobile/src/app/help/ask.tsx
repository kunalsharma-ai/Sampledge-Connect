import { Ionicons } from '@expo/vector-icons';
import {
  FEATURE_HELP,
  SUPPORT_SUBJECT_MAX,
  SUPPORT_TEXT_MAX,
  SUPPORT_TOPICS,
  SUPPORT_TOPIC_LABELS,
  featureHelp,
  type SupportRoute,
  type SupportTopic,
} from '@sampledge/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '../../components/Button';
import { Field } from '../../components/ChannelBits';
import { Chips } from '../../components/Chips';
import { BRAND } from '../../components/FeatureHelp';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useInNetwork } from '../../state/useNetwork';
import { useSupportActions } from '../../state/useSupport';
import { alpha, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * Ask a question: to your organization's admins or to SampConnect support. It is queued on this
 * device, so it works offline and sends once you are back online.
 */
export default function AskQuestion() {
  const { theme } = useTheme();
  const c = theme.colors;
  const params = useLocalSearchParams<{ featureId?: string }>();
  const network = useInNetwork();
  const { ask } = useSupportActions();
  const [route, setRoute] = useState<SupportRoute>(network ? 'platform' : 'org');
  const [topic, setTopic] = useState<SupportTopic>('question');
  const [featureId, setFeatureId] = useState<string | null>(
    params.featureId && featureHelp(params.featureId) ? params.featureId : null,
  );
  const [pickFeature, setPickFeature] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const feature = featureId ? featureHelp(featureId) : undefined;
  const ok = subject.trim().length >= 3 && body.trim().length > 0;

  const send = async () => {
    setBusy(true);
    try {
      await ask({ subject: subject.trim(), body: body.trim(), topic, route, featureId });
      router.back();
    } finally {
      setBusy(false);
    }
  };

  const routes: {
    key: SupportRoute;
    title: string;
    text: string;
    icon: keyof typeof Ionicons.glyphMap;
  }[] = [
    ...(network
      ? []
      : [
          {
            key: 'org' as const,
            title: 'My admins',
            text: 'Access, settings and how your team works.',
            icon: 'people' as const,
          },
        ]),
    {
      key: 'platform',
      title: 'SampConnect support',
      text: 'Bugs, billing and anything about the app.',
      icon: 'headset',
    },
  ];

  return (
    <Screen edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: space.sm }}>
          <Text variant="label">Who should answer?</Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {routes.map((r) => {
              const on = route === r.key;
              return (
                <Pressable
                  key={r.key}
                  onPress={() => setRoute(r.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  aria-checked={on}
                  style={[
                    styles.route,
                    {
                      borderColor: on ? BRAND.gold : c.border,
                      backgroundColor: on
                        ? alpha(BRAND.green, theme.dark ? 0.2 : 0.08)
                        : c.surfaceRaised,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.routeIcon,
                      { backgroundColor: on ? BRAND.green : c.surfaceSunken },
                    ]}
                  >
                    <Ionicons name={r.icon} size={16} color={on ? BRAND.goldLight : c.textSubtle} />
                  </View>
                  <Text variant="bodyStrong">{r.title}</Text>
                  <Text variant="meta" tone="muted">
                    {r.text}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ gap: space.sm }}>
          <Text variant="label">What is it about?</Text>
          <Chips
            label="Topic"
            options={SUPPORT_TOPICS.map((k) => ({ key: k, label: SUPPORT_TOPIC_LABELS[k] }))}
            selected={[topic]}
            onToggle={setTopic}
          />
        </View>

        <View style={{ gap: space.sm }}>
          <Text variant="label">Feature (optional)</Text>
          <Pressable
            onPress={() => setPickFeature(!pickFeature)}
            accessibilityRole="button"
            style={[styles.select, { borderColor: c.border, backgroundColor: c.surfaceSunken }]}
          >
            <Text style={{ flex: 1 }} tone={feature ? undefined : 'subtle'}>
              {feature ? feature.title : 'Choose a feature'}
            </Text>
            {feature ? (
              <Pressable
                onPress={() => setFeatureId(null)}
                accessibilityLabel="Clear feature"
                hitSlop={8}
              >
                <Ionicons name="close-circle" size={18} color={c.textSubtle} />
              </Pressable>
            ) : (
              <Ionicons
                name={pickFeature ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={c.textSubtle}
              />
            )}
          </Pressable>
          {pickFeature ? (
            <View
              style={[styles.list, { borderColor: c.border, backgroundColor: c.surfaceRaised }]}
            >
              <ScrollView nestedScrollEnabled style={{ maxHeight: 240 }}>
                {FEATURE_HELP.map((f, i) => (
                  <Pressable
                    key={f.id}
                    onPress={() => {
                      setFeatureId(f.id);
                      setPickFeature(false);
                    }}
                    style={[
                      styles.option,
                      i > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: c.border,
                      },
                    ]}
                  >
                    <Text style={{ flex: 1 }}>{f.title}</Text>
                    {f.id === featureId ? (
                      <Ionicons name="checkmark" size={16} color={BRAND.green} />
                    ) : null}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
        </View>

        <Field
          label="Subject"
          value={subject}
          onChangeText={setSubject}
          maxLength={SUPPORT_SUBJECT_MAX}
          placeholder="A short summary"
          autoCorrect
        />
        <Field
          label="Details"
          value={body}
          onChangeText={setBody}
          maxLength={SUPPORT_TEXT_MAX}
          multiline
          placeholder="What were you trying to do, and what happened?"
          autoCorrect
          help="Replies show in Help > My questions on all your devices, and you get a notification."
        />
        <Button
          title="Send question"
          icon="send"
          onPress={() => void send()}
          disabled={!ok}
          busy={busy}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  route: { flex: 1, borderWidth: 1.5, borderRadius: radius.lg, padding: space.md, gap: 4 },
  routeIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 12,
  },
  list: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: 12,
  },
});
