import * as React from 'react';
import { cn } from '../cn.js';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Translucent layered surface with backdrop blur. */
  glass?: boolean;
  interactive?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, glass, interactive, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-lg border border-border shadow-md',
        glass ? 'bg-surface-glass backdrop-blur-xl backdrop-saturate-150' : 'bg-surface',
        interactive &&
          'transition-[transform,box-shadow,border-color] duration-[var(--sc-duration-base)] ease-[var(--sc-ease-standard)] hover:-translate-y-0.5 hover:shadow-lg hover:border-border-strong',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-5 pb-3', className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-h3 text-text', className)} {...props} />;
}
export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-label font-normal text-text-muted', className)} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 pt-0', className)} {...props} />;
}
