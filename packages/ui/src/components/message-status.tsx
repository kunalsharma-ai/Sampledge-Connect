import { Check, CheckCheck, CircleAlert, Clock, LoaderCircle, PenLine } from 'lucide-react';
import type { MessageStatus } from '@sampledge/contracts';
import { cn } from '../cn.js';

export const MESSAGE_STATUS_LABEL: Record<MessageStatus, string> = {
  draft: 'Draft',
  queued: 'Queued, will send when online',
  sending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Not sent',
};

/** Compact, accessible delivery state for a message. */
export function MessageStatusIcon({
  status,
  className,
}: {
  status: MessageStatus;
  className?: string;
}) {
  const label = MESSAGE_STATUS_LABEL[status];
  const common = cn('size-3.5 shrink-0', className);
  const icon = {
    draft: <PenLine className={cn(common, 'text-text-subtle')} aria-hidden />,
    queued: <Clock className={cn(common, 'text-warning')} aria-hidden />,
    sending: (
      <LoaderCircle
        className={cn(common, 'animate-spin text-text-subtle motion-reduce:animate-none')}
        aria-hidden
      />
    ),
    sent: <Check className={cn(common, 'text-text-subtle')} aria-hidden />,
    delivered: <CheckCheck className={cn(common, 'text-text-subtle')} aria-hidden />,
    read: <CheckCheck className={cn(common, 'text-accent')} aria-hidden />,
    failed: <CircleAlert className={cn(common, 'text-danger')} aria-hidden />,
  }[status];
  return (
    <span role="img" aria-label={label} title={label} data-status={status} className="inline-flex">
      {icon}
    </span>
  );
}
