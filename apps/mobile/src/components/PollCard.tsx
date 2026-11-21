import { Ionicons } from '@expo/vector-icons';
import type { Poll } from '@sampledge/contracts';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { nextPollChoice, pollIsClosed } from '../lib/polls';
import { useWorkspace } from '../state/AppProvider';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

function closesLabel(p: Poll): string | null {
  if (p.closedAt) return 'Closed';
  if (!p.closesAt) return null;
  const at = Date.parse(p.closesAt);
  if (at <= Date.now()) return 'Closed';
  const d = new Date(at);
  return `Closes ${d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;
}

/**
 * A poll inside its message bubble. Tapping an option votes (one choice replaces the last;
 * multiple-choice polls toggle). Results show as bars once you voted or the poll closed.
 * Voting needs a connection; counts update live for everyone.
 */
export function PollCard({
  messageId,
  poll,
  own,
  nameOf,
}: {
  messageId: string | null;
  poll: Poll;
  own: boolean;
  nameOf: (userId: string) => string;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const fg = own ? c.bubbleOwnText : c.text;
  const [mine, setMine] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closed = pollIsClosed(poll);
  const voted = !!mine?.length;
  const showResults = voted || closed;
  const top = Math.max(0, ...poll.options.map((o) => o.count));

  useEffect(() => {
    if (!messageId) return;
    let alive = true;
    void engine.myPollVote(messageId, poll).then((v) => alive && setMine(v));
    return () => {
      alive = false;
    };
  }, [engine, messageId, poll]);

  const choose = async (optionId: string) => {
    if (!messageId || closed || busy) return;
    const current = mine ?? [];
    const next = nextPollChoice(poll, current, optionId);
    setBusy(optionId);
    setError(null);
    try {
      await engine.votePoll(messageId, next);
      setMine(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const footer = [
    `${poll.totalVoters} ${poll.totalVoters === 1 ? 'voter' : 'voters'}`,
    poll.multiple ? 'Choose any' : null,
    poll.anonymous ? 'Anonymous' : null,
    closesLabel(poll),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={{ gap: space.sm, minWidth: 240 }}>
      <View style={styles.title}>
        <Ionicons name="stats-chart" size={14} color={alpha(fg, 0.75)} />
        <Text variant="label" style={{ color: fg, opacity: 0.75 }}>
          {closed ? 'Poll · closed' : 'Poll'}
        </Text>
      </View>
      <Text variant="bodyStrong" style={{ color: fg }}>
        {poll.question}
      </Text>
      <View style={{ gap: 6 }} accessibilityRole={poll.multiple ? undefined : 'radiogroup'}>
        {poll.options.map((o) => {
          const picked = !!mine?.includes(o.optionId);
          const share = poll.totalVoters ? o.count / poll.totalVoters : 0;
          const who =
            !poll.anonymous && o.voterIds.length
              ? o.voterIds.slice(0, 3).map(nameOf).join(', ') +
                (o.voterIds.length > 3 ? ` and ${o.voterIds.length - 3} more` : '')
              : null;
          return (
            <Pressable
              key={o.optionId}
              onPress={() => void choose(o.optionId)}
              disabled={closed || !messageId}
              accessibilityRole={poll.multiple ? 'checkbox' : 'radio'}
              accessibilityState={{ checked: picked, disabled: closed }}
              accessibilityLabel={`${o.text}${showResults ? `, ${o.count} ${o.count === 1 ? 'vote' : 'votes'}` : ''}${who ? `: ${who}` : ''}`}
              style={({ pressed }) => [
                styles.option,
                {
                  borderColor: picked ? (own ? fg : c.accent) : alpha(fg, 0.2),
                  backgroundColor: alpha(own ? '#000000' : c.accent, pressed ? 0.16 : 0.06),
                },
              ]}
            >
              {showResults ? (
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      width: `${Math.round(share * 100)}%`,
                      backgroundColor: alpha(
                        own ? '#ffffff' : c.accent,
                        o.count === top && top > 0 ? 0.24 : 0.12,
                      ),
                    },
                  ]}
                />
              ) : null}
              {busy === o.optionId ? (
                <ActivityIndicator size="small" color={own ? fg : c.accent} />
              ) : (
                <Ionicons
                  name={
                    poll.multiple
                      ? picked
                        ? 'checkbox'
                        : 'square-outline'
                      : picked
                        ? 'radio-button-on'
                        : 'radio-button-off'
                  }
                  size={18}
                  color={picked ? (own ? fg : c.accent) : alpha(fg, 0.6)}
                />
              )}
              <View style={{ flex: 1 }}>
                <Text style={{ color: fg }}>{o.text}</Text>
                {showResults && who ? (
                  <Text variant="meta" style={{ color: fg, opacity: 0.7 }} numberOfLines={1}>
                    {who}
                  </Text>
                ) : null}
              </View>
              {showResults ? (
                <Text variant="label" style={{ color: fg }}>
                  {Math.round(share * 100)}%
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <Text variant="meta" style={{ color: error ? c.danger : fg, opacity: error ? 1 : 0.7 }}>
        {error ?? footer}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 9,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
});
