import * as React from 'react';
import { cn } from '../cn.js';

const fieldBase =
  'w-full rounded-md border border-border bg-surface-sunken px-3 text-body text-text placeholder:text-text-subtle ' +
  'transition-[border-color,box-shadow] duration-[var(--sc-duration-fast)] ' +
  'hover:border-border-strong focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-ring ' +
  'disabled:opacity-50 aria-[invalid=true]:border-danger';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldBase, 'h-10', className)} {...props} />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, 'py-2', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}

/** Label + control + hint/error with correct aria wiring. */
export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-label text-text">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-meta text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-meta text-text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
