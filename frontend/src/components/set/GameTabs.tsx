import { cn } from '@/lib/utils';
import { Check, Lock, Swords } from 'lucide-react';

interface GameTabsProps {
  totalGames: number;
  currentGameIndex: number;
  completedGames: number[];
  onTabClick: (index: number) => void;
}

export function GameTabs({ totalGames, currentGameIndex, completedGames, onTabClick }: GameTabsProps) {
  return (
    <div className="gaming-card p-3 animate-slide-up" style={{ animationDelay: '150ms' }}>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide">
        {Array.from({ length: totalGames }).map((_, i) => {
          const gameIndex = i + 1;
          const isCompleted = completedGames.includes(gameIndex);
          const isCurrent = gameIndex === currentGameIndex;
          const isLocked = gameIndex > currentGameIndex && !isCompleted;

          return (
            <button
              key={gameIndex}
              onClick={() => !isLocked && onTabClick(gameIndex)}
              disabled={isLocked}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap',
                isCurrent && 'bg-primary text-primary-foreground glow-cyan',
                isCompleted && !isCurrent && 'bg-primary/15 text-primary hover:bg-primary/25',
                isLocked && 'bg-muted text-muted-foreground cursor-not-allowed opacity-50',
                !isCurrent && !isCompleted && !isLocked && 'bg-muted text-foreground hover:bg-muted/80'
              )}
            >
              {isCompleted && !isCurrent && <Check className="w-3.5 h-3.5" />}
              {isLocked && <Lock className="w-3.5 h-3.5" />}
              {isCurrent && <Swords className="w-3.5 h-3.5" />}
              G{gameIndex}
            </button>
          );
        })}
      </div>
    </div>
  );
}
