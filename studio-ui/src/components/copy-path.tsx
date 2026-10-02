import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Tooltip } from '@/components/ui/tooltip';

/** A path cut short at its start, shown whole on hover and copied on click */
export function CopyPath({ path }: { path: string }) {
  const [copied, setCopied] = useState<'copied' | 'failed'>();

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(undefined), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () =>
    navigator.clipboard.writeText(path).then(
      () => setCopied('copied'),
      () => setCopied('failed'),
    );

  return (
    <Tooltip content={<span className="font-mono break-all">{path}</span>}>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy ${path}`}
        className="group flex w-full min-w-0 items-center gap-1.5 border-t px-4 py-2 text-left font-mono text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        {copied ? (
          <span className={copied === 'copied' ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}>
            {copied === 'copied' ? 'Copied' : 'Could not copy'}
          </span>
        ) : (
          // Not cut at the end: the end names the directory, which tells one data set from another
          <span className="min-w-0 flex-1 truncate [direction:rtl]">
            <bdi>{path}</bdi>
          </span>
        )}
        {copied === 'copied' ? (
          <Check className="ml-auto size-3 shrink-0" />
        ) : (
          <Copy className="ml-auto size-3 shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
        )}
      </button>
    </Tooltip>
  );
}
