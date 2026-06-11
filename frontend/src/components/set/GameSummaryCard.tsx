import { cn } from '@/lib/utils';
import { slugToLabel } from '@/lib/characters';
import { GameRecord, isGameComplete, areStocksUnknown } from '@/types';
import { Trophy, MapPin, Plus } from 'lucide-react';

interface GameSummaryCardProps {
  game: GameRecord;
  p1Name: string;
  p2Name: string;
  isCurrent?: boolean;
  onClick?: () => void;
  readOnly?: boolean;
}

export function GameSummaryCard({ game, p1Name, p2Name, isCurrent = false, onClick, readOnly = false }: GameSummaryCardProps) {
  const isComplete = isGameComplete(game);
  const winnerName = game.winner === 'p1' ? p1Name : game.winner === 'p2' ? p2Name : null;

  const Wrapper = readOnly ? 'div' : 'button';
  const wrapperProps = readOnly
    ? { className: 'gaming-card p-4 w-full text-left' }
    : {
        onClick,
        className: 'gaming-card p-4 w-full text-left hover:border-primary/50 transition-all active:scale-[0.98]',
      };

  if (!isComplete && !isCurrent) {
    if (readOnly) {
      return (
        <div className="gaming-card p-4 opacity-60">
          <p className="text-sm text-center text-muted-foreground">Game {game.index} pendiente</p>
        </div>
      );
    }
    return (
      <button
        onClick={onClick}
        className="gaming-card p-4 w-full text-left hover:border-primary/50 transition-all active:scale-[0.98]"
      >
        <div className="flex items-center justify-center gap-2 text-muted-foreground py-2">
          <Plus className="w-4 h-4" />
          <span className="text-sm">Toca para registrar Game {game.index}</span>
        </div>
      </button>
    );
  }

  return (
    <Wrapper
      {...wrapperProps}
      className={cn(
        readOnly ? 'gaming-card p-4 w-full text-left' : wrapperProps.className,
        isCurrent && 'border-primary/50 glow-cyan',
        isComplete && !isCurrent && 'border-success/30',
        !readOnly && 'hover:border-primary/50'
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold',
            isComplete ? 'bg-success/20 text-success' : 'bg-primary/20 text-primary'
          )}>
            G{game.index}
          </div>

          <div className="min-w-0 flex-1">
            {isComplete ? (
              <>
                <div className="flex items-center gap-1.5 text-sm">
                  <Trophy className={cn('w-3.5 h-3.5', game.winner === 'p1' ? 'text-primary' : 'text-secondary')} />
                  <span className="font-medium truncate">{winnerName}</span>
                  {game.winner && (
                    <span className="text-muted-foreground">
                      ({game.winner === 'p1' ? game.characterP1 && slugToLabel(game.characterP1) : game.characterP2 && slugToLabel(game.characterP2)})
                    </span>
                  )}
                </div>
                {game.stage && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                    <MapPin className="w-3 h-3" />
                    <span>{game.stage}</span>
                  </div>
                )}
              </>
            ) : (
              <span className="text-sm text-muted-foreground">En progreso...</span>
            )}
          </div>
        </div>

        {/* Stocks indicator */}
        {isComplete && game.winner && (
          <div className="flex items-center gap-1">
            {areStocksUnknown(game) ? (
              <span className="text-xs text-muted-foreground">?</span>
            ) : (
              Array.from({ length: game.winner === 'p1' ? (game.stocksP1 || 0) : (game.stocksP2 || 0) }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    'w-2 h-2 rounded-full',
                    game.winner === 'p1' ? 'bg-primary' : 'bg-secondary'
                  )}
                />
              ))
            )}
          </div>
        )}
      </div>
    </Wrapper>
  );
}
