import { Badge } from '@/components/ui/badge';

/** Marks which side of a value a line shows: what the file holds, or what the schema makes of it */
export function SideBadge({ side }: { side: 'in' | 'out' }) {
  return (
    <Badge variant={side === 'in' ? 'secondary' : 'outline'} className="w-7 shrink-0 justify-center font-sans">
      {side}
    </Badge>
  );
}
