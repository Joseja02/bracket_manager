import { cn } from '@/lib/utils';

interface ScoreHeaderProps {
  p1Name: string;
  p2Name: string;
  scoreP1: number;
  scoreP2: number;
  bestOf: number;
  round: string;
}

export function ScoreHeader({ p1Name, p2Name, scoreP1, scoreP2, bestOf, round }: ScoreHeaderProps) {
  const gamesNeeded = Math.ceil(bestOf / 2);
  const p1Leading = scoreP1 > scoreP2;
  const p2Leading = scoreP2 > scoreP1;
  const p1Won = scoreP1 >= gamesNeeded;
  const p2Won = scoreP2 >= gamesNeeded;

  return (
    <div className="gaming-card p-6 animate-slide-up">
      {/* Round Badge */}
      <div className="text-center mb-4">
        <span className="inline-block px-4 py-1 rounded-full bg-muted text-muted-foreground text-sm font-medium uppercase tracking-wider">
          {round}
        </span>
      </div>

      {/* Score Display */}
      <div className="flex items-center justify-between gap-4">
        {/* Player 1 */}
        <div className={cn(
          "flex-1 text-center transition-all duration-300",
          p1Won && "scale-105"
        )}>
          <div className="flex flex-col items-center gap-2">
            <div className={cn(
              "w-16 h-16 rounded-full border-2 flex items-center justify-center text-2xl font-bold bg-muted transition-all duration-300",
              p1Leading || p1Won ? "border-primary glow-cyan" : "border-border"
            )}>
              {p1Name.charAt(0).toUpperCase()}
            </div>
            <span className="text-sm font-medium text-muted-foreground truncate max-w-[100px]">
              {p1Name}
            </span>
            <span className={cn(
              "text-5xl font-bold tabular-nums transition-all duration-300",
              p1Leading || p1Won ? "text-primary" : "text-foreground"
            )}>
              {scoreP1}
            </span>
          </div>
        </div>

        {/* VS Divider */}
        <div className="flex flex-col items-center gap-2">
          <div className="text-4xl font-display font-bold text-muted-foreground/50">
            VS
          </div>
          <div className="px-3 py-1 rounded-lg bg-muted/50 text-xs font-medium text-muted-foreground">
            Bo{bestOf}
          </div>
        </div>

        {/* Player 2 */}
        <div className={cn(
          "flex-1 text-center transition-all duration-300",
          p2Won && "scale-105"
        )}>
          <div className="flex flex-col items-center gap-2">
            <div className={cn(
              "w-16 h-16 rounded-full border-2 flex items-center justify-center text-2xl font-bold bg-muted transition-all duration-300",
              p2Leading || p2Won ? "border-secondary glow-magenta" : "border-border"
            )}>
              {p2Name.charAt(0).toUpperCase()}
            </div>
            <span className="text-sm font-medium text-muted-foreground truncate max-w-[100px]">
              {p2Name}
            </span>
            <span className={cn(
              "text-5xl font-bold tabular-nums transition-all duration-300",
              p2Leading || p2Won ? "text-secondary" : "text-foreground"
            )}>
              {scoreP2}
            </span>
          </div>
        </div>
      </div>

      {/* Progress Indicator */}
      <div className="mt-6 flex justify-center gap-2">
        {Array.from({ length: bestOf }).map((_, i) => {
          const isP1Win = i < scoreP1;
          const isP2Win = i >= bestOf - scoreP2;
          return (
            <div
              key={i}
              className={cn(
                "w-3 h-3 rounded-full transition-all duration-300",
                isP1Win && "bg-primary glow-cyan",
                isP2Win && "bg-secondary glow-magenta",
                !isP1Win && !isP2Win && "bg-muted"
              )}
            />
          );
        })}
      </div>
    </div>
  );
}
