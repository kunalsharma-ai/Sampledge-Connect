import { Ionicons } from '@expo/vector-icons';
import type { LocalApproval } from '../../db/work';
import type { UpdateApprovalRequest } from '@sampledge/contracts';
import { SyncBanner } from '../../components/SyncBanner';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Button } from '../../components/Button';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { dueLabel, Pill, useStatusColor } from '../../components/WorkRows';
import {
  APPROVAL_CATEGORY_LABEL,
  APPROVAL_STATUS_LABEL,
  approvalProgress,
  formatMoney,
  isMyTurn,
  parseAmount,
} from '../../lib/work';
import { useWorkspace } from '../../state/AppProvider';
import {
  conversationTitle,
  useConversations,
  usePeople,
  useTenantRole,
  useWorkList,
} from '../../state/hooks';
import { radius, space, type as typeScale } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/** One approval request: what is asked, who decides, and the decision buttons when it is your turn. */
export default function ApprovalDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  const nameOf = usePeople();
  const role = useTenantRole();
  const { conversations } = useConversations();
  const color = useStatusColor();
  const one = useWorkList<LocalApproval>(
    (fresh) => engine.getApproval(id, { fresh }).then((a) => [a]),
    [id],
  );
  const a = one.items?.[0];
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ title: string; description: string; amount: string } | null>(
    null,
  );
  const blocked = engine.queueBlocker();

  if (!a)
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: 'Approval' }} />
        <View style={styles.center}>
          {one.error || blocked ? (
            <Text tone="muted" style={{ textAlign: 'center' }}>
              {one.error ?? blocked}
            </Text>
          ) : (
            <ActivityIndicator color={c.accent} />
          )}
        </View>
      </Screen>
    );

  const turn = isMyTurn(a, selfId) && !a.local;
  const canCancel =
    a.status === 'pending' &&
    !a.syncError &&
    (a.requesterId === selfId || role === 'owner' || role === 'admin');
  const who = (u: string) => (u === selfId ? 'You' : nameOf(u));
  // Yours, still pending, and nobody has decided: you can still fix it.
  const canEdit =
    a.requesterId === selfId &&
    a.status === 'pending' &&
    a.decisions.length === 0 &&
    a.origin !== 'module' &&
    !a.syncError;
  const saveEdit = async () => {
    if (!edit) return;
    if (!edit.title.trim()) return setError('Say what needs approving.');
    const minor = edit.amount.trim() ? parseAmount(edit.amount) : null;
    if (edit.amount.trim() && minor === null) return setError('Enter the amount as a number.');
    const patch: UpdateApprovalRequest = {};
    if (edit.title.trim() !== a.title) patch.title = edit.title.trim();
    if (edit.description.trim() !== a.description) patch.description = edit.description.trim();
    if ((minor ?? null) !== (a.amount?.amountMinor ?? null))
      patch.amount =
        minor === null ? null : { amountMinor: minor, currency: a.amount?.currency ?? 'USD' };
    setError(null);
    try {
      if (Object.keys(patch).length) await engine.updateApproval(a.approvalId, patch);
      setEdit(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const input = [
    typeScale.body,
    {
      color: c.text,
      backgroundColor: c.surfaceSunken,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: 10,
    },
  ];
  const conv = a.conversationId
    ? conversations.find((x) => x.conversationId === a.conversationId)
    : undefined;

  const act = async (what: 'approve' | 'reject' | 'cancel') => {
    setBusy(what);
    setError(null);
    try {
      if (what === 'cancel') await engine.cancelApproval(a.approvalId);
      else await engine.decideApproval(a.approvalId, { decision: what, comment: comment.trim() });
      setComment('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Approval',
          headerRight:
            canEdit && !edit
              ? () => (
                  <Pressable
                    onPress={() =>
                      setEdit({
                        title: a.title,
                        description: a.description,
                        amount: a.amount ? (a.amount.amountMinor / 100).toFixed(2) : '',
                      })
                    }
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Edit request"
                    style={{ paddingHorizontal: space.sm }}
                  >
                    <Ionicons name="create-outline" size={22} color={c.accent} />
                  </Pressable>
                )
              : undefined,
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}
          keyboardShouldPersistTaps="handled"
        >
          {edit ? (
            <Glass style={{ padding: space.md, gap: space.md }}>
              <Text variant="meta" tone="muted">
                You can change the request until someone decides.
              </Text>
              <TextInput
                value={edit.title}
                onChangeText={(title) => setEdit({ ...edit, title })}
                maxLength={200}
                accessibilityLabel="What needs approving"
                style={input}
              />
              <TextInput
                value={edit.description}
                onChangeText={(description) => setEdit({ ...edit, description })}
                maxLength={4000}
                multiline
                placeholder="Details"
                placeholderTextColor={c.textSubtle}
                accessibilityLabel="Details"
                style={[input, { minHeight: 72, textAlignVertical: 'top' }]}
              />
              <TextInput
                value={edit.amount}
                onChangeText={(amount) => setEdit({ ...edit, amount })}
                keyboardType="decimal-pad"
                placeholder={`Amount (${a.amount?.currency ?? 'USD'})`}
                placeholderTextColor={c.textSubtle}
                accessibilityLabel="Amount"
                style={input}
              />
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button
                  title="Cancel"
                  kind="quiet"
                  onPress={() => setEdit(null)}
                  style={{ flex: 1 }}
                />
                <Button title="Save changes" onPress={() => void saveEdit()} style={{ flex: 1 }} />
              </View>
            </Glass>
          ) : null}
          <View style={{ gap: space.sm }}>
            <Text variant="title" accessibilityRole="header">
              {a.title}
            </Text>
            <View style={styles.pills}>
              <Pill label={APPROVAL_STATUS_LABEL[a.status]} color={color(a.status)} />
              <Pill label={APPROVAL_CATEGORY_LABEL[a.category]} color={c.accent} />
              {a.dueAt && a.status === 'pending' ? (
                <Text variant="label" tone="muted">
                  {dueLabel(a.dueAt).replace('Due', 'Decide by')}
                </Text>
              ) : null}
            </View>
          </View>
          <SyncBanner
            item={a}
            what="approval request"
            onRetry={() => void engine.retryLocal('approval', a.approvalId)}
            onDiscard={() => {
              void engine.discardLocal('approval', a.approvalId);
              router.back();
            }}
          />
          {a.amount ? (
            <Text variant="display" accessibilityLabel={`Amount ${formatMoney(a.amount)}`}>
              {formatMoney(a.amount)}
            </Text>
          ) : null}
          {a.description ? <Text>{a.description}</Text> : null}

          <Glass style={{ padding: space.md, gap: space.md }}>
            <View style={{ gap: 2 }}>
              <Text variant="meta" tone="muted">
                Requested by
              </Text>
              <Text variant="bodyStrong">
                {who(a.requesterId)} ·{' '}
                {new Date(a.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}
              </Text>
            </View>
            <View style={{ gap: space.sm }}>
              <Text variant="meta" tone="muted">
                Approvers · {approvalProgress(a)}
              </Text>
              {a.approverIds.map((u) => {
                const d = a.decisions.find((x) => x.userId === u);
                return (
                  <View key={u} style={styles.approver}>
                    <Ionicons
                      name={
                        d?.decision === 'approve'
                          ? 'checkmark-circle'
                          : d?.decision === 'reject'
                            ? 'close-circle'
                            : 'ellipse-outline'
                      }
                      size={20}
                      color={
                        d?.decision === 'approve'
                          ? c.success
                          : d?.decision === 'reject'
                            ? c.danger
                            : c.textSubtle
                      }
                    />
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong">{who(u)}</Text>
                      <Text variant="meta" tone="muted">
                        {d
                          ? `${d.decision === 'approve' ? 'Approved' : 'Rejected'}${d.comment ? `: “${d.comment}”` : ''}`
                          : a.status === 'pending'
                            ? 'Not decided yet'
                            : 'Did not decide'}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </Glass>

          {a.conversationId ? (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/conversation/[id]',
                  params: a.sourceMessageId
                    ? { id: a.conversationId!, focus: a.sourceMessageId }
                    : { id: a.conversationId! },
                })
              }
              accessibilityRole="button"
              accessibilityLabel="Open the conversation"
            >
              <Glass style={styles.source}>
                <Ionicons name="chatbubble-ellipses-outline" size={20} color={c.accent} />
                <Text variant="label" style={{ flex: 1 }}>
                  From {conv ? conversationTitle(conv, nameOf, selfId) : 'a conversation'}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
              </Glass>
            </Pressable>
          ) : null}

          {turn ? (
            <View style={{ gap: space.md }}>
              <Text variant="bodyStrong">Your decision</Text>
              <TextInput
                value={comment}
                onChangeText={setComment}
                placeholder="Add a comment (optional)"
                placeholderTextColor={c.textSubtle}
                maxLength={2000}
                multiline
                accessibilityLabel="Comment"
                style={[
                  typeScale.body,
                  styles.input,
                  { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
                ]}
              />
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Reject"
                    kind="danger"
                    icon="close"
                    busy={busy === 'reject'}
                    disabled={!!blocked || !!busy}
                    onPress={() => void act('reject')}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Approve"
                    icon="checkmark"
                    busy={busy === 'approve'}
                    disabled={!!blocked || !!busy}
                    onPress={() => void act('approve')}
                  />
                </View>
              </View>
            </View>
          ) : null}
          {canCancel ? (
            <Button
              title="Cancel request"
              kind="quiet"
              icon="arrow-undo-outline"
              busy={busy === 'cancel'}
              disabled={!!blocked || !!busy}
              onPress={() => void act('cancel')}
            />
          ) : null}
          {error || blocked ? (
            <Text variant="meta" tone="danger" accessibilityLiveRegion="polite">
              {error ?? `${blocked}`}
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  pills: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  approver: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  source: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  input: {
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 60,
    textAlignVertical: 'top',
  },
});
