import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-3 py-2.5 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-2.5 [&>svg]:size-4 [&>svg]:translate-y-0.5',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive:
          'bg-card text-destructive [&>svg]:text-current *:data-[slot=alert-description]:text-destructive/90',
        warning: 'border-changed bg-changed/40 text-changed-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-title" className={cn('col-start-2 font-medium', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-description" className={cn('col-start-2 grid gap-1 text-sm', className)} {...props} />;
}
