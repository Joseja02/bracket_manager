import { GameRecord } from '@/types';
import { Trophy, MapPin, Heart } from 'lucide-react';
import { cn } from '@/lib/utils';

interface GamesHistoryProps {
  games: GameRecord[];
  p1Name: string;
  p2Name: string;
}

export function GamesHistory({ games, p1Name, p2Name }: GamesHistoryProps) {
  if (!games.length) {
    return (
      <div className="gaming-card p-6 text-center">
        <Trophy className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No hay games registrados aún</p>
      </div>
    );
  }

  return (
    <div className="gaming-card p-4 space-y-3 animate-slide-up">
      <h3 className="font-display text-sm font-semibold tracking-wider text-muted-foreground uppercase flex items-center gap-2">
        <Trophy className="w-4 h-4 text-primary" />
        Historial de Games
      </h3>
      <div className="space-y-2">
        {games.map((game) => (
          <div
            key={game.index}
            className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50"
          >
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center text-xs font-bold">
                G{game.index}
              </span>
              
              {game.stage && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  <span>{game.stage}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/* Player 1 */}
              <div className={cn(
                'flex items-center gap-1.5 text-xs',
                game.winner === 'p1' ? 'text-primary font-medium' : 'text-muted-foreground'
              )}>
                <span className="truncate max-w-[60px]">{game.characterP1 || p1Name}</span>
                {game.stocksP1 !== null && game.stocksP1 > 0 && (
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: game.stocksP1 }).map((_, i) => (
                      <Heart key={i} className="h-2.5 w-2.5 fill-current" />
                    ))}
                  </div>
                )}
                {game.winner === 'p1' && <Trophy className="h-3 w-3 text-primary" />}
              </div>

              <span className="text-xs text-muted-foreground/50">vs</span>

              {/* Player 2 */}
              <div className={cn(
                'flex items-center gap-1.5 text-xs',
                game.winner === 'p2' ? 'text-secondary font-medium' : 'text-muted-foreground'
              )}>
                {game.winner === 'p2' && <Trophy className="h-3 w-3 text-secondary" />}
                {game.stocksP2 !== null && game.stocksP2 > 0 && (
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: game.stocksP2 }).map((_, i) => (
                      <Heart key={i} className="h-2.5 w-2.5 fill-current" />
                    ))}
                  </div>
                )}
                <span className="truncate max-w-[60px]">{game.characterP2 || p2Name}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
