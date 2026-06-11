import React, { useState } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import CharacterSelect from './CharacterSelect';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { GameRecord, StageName, STAGES } from '@/types';
import { Trophy } from 'lucide-react';
import { resolveCharacterSlug } from '@/lib/characters';

interface GameRowProps {
  game: GameRecord;
  p1Name: string;
  p2Name: string;
  onChange: (game: GameRecord) => void;
  readonly?: boolean;
  lockStage?: boolean; // when true, stage cannot be edited here (comes from bans flow)
}

export function GameRow({ game, p1Name, p2Name, onChange, readonly = false, lockStage = false }: GameRowProps) {
  const [p1ModalOpen, setP1ModalOpen] = useState(false);
  const [p2ModalOpen, setP2ModalOpen] = useState(false);
  const updateGame = (updates: Partial<GameRecord>) => {
    const updated = { ...game, ...updates };

    // Apply stocks constraint: solo establecer perdedor a 0, NO establecer ganador automáticamente
    if (updates.winner) {
      if (updates.winner === 'p1') {
        updated.stocksP2 = 0;
        // NO establecer stocksP1 automáticamente, dejar que el usuario lo seleccione
      } else if (updates.winner === 'p2') {
        updated.stocksP1 = 0;
        // NO establecer stocksP2 automáticamente, dejar que el usuario lo seleccione
      }
    }

    onChange(updated);
  };

  // Un game está completo solo si tiene todos los campos necesarios Y stocks válidas
  // Stocks válidas = (1, 2, 3) o null (unknown), pero NO puede estar sin definir si hay ganador
  const hasValidStocks = game.winner 
    ? (game.winner === 'p1' ? (game.stocksP1 !== null && game.stocksP1 !== undefined) : (game.stocksP2 !== null && game.stocksP2 !== undefined))
    : true; // Si no hay ganador, no se requieren stocks aún
  
  const isComplete = game.stage && game.winner && game.characterP1 && game.characterP2 && hasValidStocks;
  const stocksP1Value =
    game.stocksP1 === null ? 'unknown' : (game.stocksP1?.toString() || '');
  const stocksP2Value =
    game.stocksP2 === null ? 'unknown' : (game.stocksP2?.toString() || '');

  return (
    <div className={cn('gaming-card p-4 space-y-4', isComplete && 'border-primary/30')}>
        <div className="flex items-center justify-between">
          <h4 className="font-display text-sm uppercase tracking-wider flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber" />
            Game {game.index}
          </h4>
          {isComplete && <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">Completo</Badge>}
        </div>

        {/* Stage display (locked when lockStage) */}
        <div className="space-y-2">
          <Label>Stage</Label>
          {lockStage ? (
            <div className="rounded-lg border border-border/30 px-3 py-2 bg-gradient-surface text-sm">
              {game.stage || 'Selecciona escenario desde la sección de bans'}
            </div>
          ) : (
            <Select
              value={game.stage || ''}
              onValueChange={(value) => updateGame({ stage: value as StageName })}
              disabled={readonly}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un stage" />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((stage) => (
                  <SelectItem key={stage} value={stage}>
                    {stage}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Winner Selection */}
        <div className="space-y-2">
          <Label>Ganador</Label>
          <Select
            value={game.winner || ''}
            onValueChange={(value) => updateGame({ winner: value as 'p1' | 'p2' })}
            disabled={readonly}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecciona el ganador" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="p1">{p1Name}</SelectItem>
              <SelectItem value="p2">{p2Name}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Winner Stocks */}
        <div className="space-y-2">
          <Label>Stocks del ganador</Label>
          <Select
            value={
              game.winner === 'p1'
                ? stocksP1Value
                : game.winner === 'p2'
                  ? stocksP2Value
                  : ''
            }
            onValueChange={(value) => {
              if (!game.winner) return;
              if (value === 'unknown') {
                // desconocido: no enviar stocks
                updateGame({ stocksP1: null, stocksP2: null });
                return;
              }
              const winnerStocks = Number(value) as 1 | 2 | 3;
              if (game.winner === 'p1') {
                updateGame({ stocksP1: winnerStocks, stocksP2: 0 });
              } else {
                updateGame({ stocksP1: 0, stocksP2: winnerStocks });
              }
            }}
            disabled={readonly || !game.winner}
          >
            <SelectTrigger>
              <SelectValue placeholder={game.winner ? 'Selecciona stocks' : 'Selecciona ganador primero'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unknown">Desconocido</SelectItem>
              <SelectItem value="1">1 stock</SelectItem>
              <SelectItem value="2">2 stocks</SelectItem>
              <SelectItem value="3">3 stocks</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Characters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{p1Name} - Personaje</Label>
            {game.characterP1 ? (
              <div className="flex items-center gap-3">
              <img src={`${import.meta.env.BASE_URL}stock_icons/${resolveCharacterSlug(game.characterP1!)}.png`} alt={game.characterP1!} className="h-10 w-10 object-contain" />
                <span className="truncate text-base">{game.characterP1.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</span>
                {!readonly && (
                  <button className="ml-auto rounded-lg px-3 py-2 border border-border/30 text-sm hover:border-primary/50 transition-colors" onClick={() => setP1ModalOpen(true)}>
                    Cambiar
                  </button>
                )}
              </div>
            ) : (
              <button className="w-full sm:w-auto rounded-lg border border-border/30 px-3 py-3 text-center text-sm hover:border-primary/50 transition-colors" onClick={() => setP1ModalOpen(true)} disabled={readonly}>
                Añadir personaje
              </button>
            )}

            <AlertDialog open={p1ModalOpen} onOpenChange={setP1ModalOpen}>
              <AlertDialogContent className="gaming-card border-border/30 sm:max-w-md w-full h-full sm:h-auto sm:rounded-xl">
                <AlertDialogHeader>
                  <AlertDialogTitle>Selecciona personaje - {p1Name}</AlertDialogTitle>
                </AlertDialogHeader>

                <div className="py-2">
                  <CharacterSelect
                    value={game.characterP1 || null}
                    onChange={(val) => {
                      updateGame({ characterP1: val || '' });
                      setP1ModalOpen(false);
                    }}
                  />
                </div>

                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => setP1ModalOpen(false)}>Cerrar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <div className="space-y-2">
            <Label>{p2Name} - Personaje</Label>
            {game.characterP2 ? (
              <div className="flex items-center gap-3">
              <img src={`${import.meta.env.BASE_URL}stock_icons/${resolveCharacterSlug(game.characterP2!)}.png`} alt={game.characterP2!} className="h-10 w-10 object-contain" />
                <span className="truncate text-base">{game.characterP2.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</span>
                {!readonly && (
                  <button className="ml-auto rounded-lg px-3 py-2 border border-border/30 text-sm hover:border-secondary/50 transition-colors" onClick={() => setP2ModalOpen(true)}>
                    Cambiar
                  </button>
                )}
              </div>
            ) : (
              <button className="w-full sm:w-auto rounded-lg border border-border/30 px-3 py-3 text-center text-sm hover:border-secondary/50 transition-colors" onClick={() => setP2ModalOpen(true)} disabled={readonly}>
                Añadir personaje
              </button>
            )}

            <AlertDialog open={p2ModalOpen} onOpenChange={setP2ModalOpen}>
              <AlertDialogContent className="gaming-card border-border/30 sm:max-w-md w-full h-full sm:h-auto sm:rounded-xl">
                <AlertDialogHeader>
                  <AlertDialogTitle>Selecciona personaje - {p2Name}</AlertDialogTitle>
                </AlertDialogHeader>

                <div className="py-2">
                  <CharacterSelect
                    value={game.characterP2 || null}
                    onChange={(val) => {
                      updateGame({ characterP2: val || '' });
                      setP2ModalOpen(false);
                    }}
                  />
                </div>

                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => setP2ModalOpen(false)}>Cerrar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
    </div>
  );
}
