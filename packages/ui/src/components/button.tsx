import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import { cn } from '../cn.js';

export const buttonVariants = cva(
  [
    'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium',
    'transition-[background-color,color,box-shadow,transform,border-color] duration-[var(--sc-duration-fast)] ease-[var(--sc-ease-standard)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
    'disabled:pointer-events-none disabled:opacity-50 active:translate-y-px',
    '[&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-accent-fg shadow-sm hover:bg-accent-hover hover:shadow-md hover:-translate-y-px',
        secondary:
          'bg-surface-raised text-text border border-border hover:border-border-strong hover:-translate-y-px hover:shadow-sm',
        ghost: 'text-text-muted hover:text-text hover:bg-surface-raised',
        outline: 'border border-border-strong text-text hover:bg-surface-raised',
        danger: 'bg-danger text-bg hover:opacity-90',
        link: 'text-accent underline-offset-4 hover:underline px-0',
      },
      size: {
        sm: 'h-8 rounded-sm px-3 text-label',
        md: 'h-10 rounded-md px-4 text-label',
        lg: 'h-12 rounded-lg px-6 text-body',
        icon: 'size-9 rounded-md',
        'icon-sm': 'size-8 rounded-sm',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
        {children}
      </Comp>
    );
  },
);
Button.displayName = 'Button';
