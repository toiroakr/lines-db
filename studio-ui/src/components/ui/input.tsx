import * as React from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      data-slot="input"
      className={cn(
        'h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-24 w-full rounded-md border border-input bg-transparent px-2.5 py-2 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Text over as many lines as it holds, growing with them: Enter is left to what holds it, such as setting
 * the value, and Shift+Enter breaks a line
 */
export function TextLines({
  className,
  onKeyDown,
  onEnter,
  ...props
}: React.ComponentProps<'textarea'> & { onEnter?: () => void }) {
  return (
    <textarea
      data-slot="text-lines"
      rows={1}
      className={cn(
        'field-sizing-content max-h-60 min-h-8 w-full min-w-0 resize-none rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
        className,
      )}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        onEnter?.();
      }}
      {...props}
    />
  );
}
