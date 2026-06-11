import { Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ScoreBoardProps {
  p1Name: string;
  p2Name: string;
  p1Score: number;
  p2Score: number;
  bestOf: number;
}

export function ScoreBoard({ p1Name, p2Name, p1Score, p2Score, bestOf }: ScoreBoardProps) {
  const gamesNeeded = Math.ceil(bestOf / 2);

  return (
    <div className="gaming-card p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 text-center space-y-1.5">
          <p className="text-xs text-muted-foreground truncate">{p1Name}</p>
          <p className={cn(
            'text-4xl font-display',
            p1Score > p2Score ? 'text-primary glow-cyan' : 'text-foreground'
          )}>{p1Score}</p>
        </div>

        <div className="text-center space-y-1 shrink-0">
          <Trophy className="h-6 w-6 text-amber mx-auto" />
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-display">
            Bo{bestOf}
          </p>
        </div>

        <div className="flex-1 text-center space-y-1.5">
          <p className="text-xs text-muted-foreground truncate">{p2Name}</p>
          <p className={cn(
            'text-4xl font-display',
            p2Score > p1Score ? 'text-secondary glow-magenta' : 'text-foreground'
          )}>{p2Score}</p>
        </div>
      </div>
    </div>
  );
}
