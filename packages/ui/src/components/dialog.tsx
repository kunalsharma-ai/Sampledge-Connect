'use client';
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { X } from 'lucide-react';
import { cn } from '../cn.js';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  bodyClassName,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
  /** Classes for the wrapper around children (e.g. a flex column for a scrolling body). */
  bodyClassName?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[50] bg-black/50 backdrop-blur-sm data-[state=open]:animate-[sc-fade-in_var(--sc-duration-base)_var(--sc-ease-standard)] data-[state=closed]:animate-[sc-fade-out_var(--sc-duration-fast)_var(--sc-ease-exit)]" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-[60] w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-6 shadow-lg',
          'data-[state=open]:animate-[sc-dialog-in_var(--sc-duration-slow)_var(--sc-ease-emphasized)] data-[state=closed]:animate-[sc-dialog-out_var(--sc-duration-fast)_var(--sc-ease-exit)]',
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="text-h2 text-text">{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-1 text-label font-normal text-text-muted">
            {description}
          </DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}
        <div className={cn('mt-5', bodyClassName)}>{children}</div>
        <DialogPrimitive.Close
          className="absolute right-4 top-4 rounded-sm p-1 text-text-subtle hover:bg-surface-raised hover:text-text"
          aria-label="Close"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  children,
  side = 'right',
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}) {
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          className="z-[90] rounded-sm border border-border bg-surface-raised px-2 py-1 text-meta text-text shadow-md data-[state=delayed-open]:animate-[sc-fade-in_var(--sc-duration-fast)_var(--sc-ease-standard)]"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
