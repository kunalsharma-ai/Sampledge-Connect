import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../cn.js';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-medium leading-none',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-raised text-text-muted border border-border',
        accent: 'bg-accent-soft text-accent',
        accent2: 'bg-accent2-soft text-accent2',
        success: 'bg-success/15 text-success',
        warning: 'bg-warning/15 text-warning',
        danger: 'bg-danger/15 text-danger',
        planned: 'border border-dashed border-border-strong text-text-subtle',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
