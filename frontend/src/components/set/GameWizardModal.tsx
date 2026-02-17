import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { GameRecord, StageName, STAGES } from '@/types';
import { ArrowLeft, Check, Trophy, MapPin, Ban } from 'lucide-react';
import { CharacterSelect } from './CharacterSelect';
import { slugToLabel } from '@/lib/characters';

type WizardStep = 'stage' | 'winner' | 'charP1' | 'charP2' | 'stocks' | 'preview';

interface GameWizardModalProps {
  open: boolean;
  onClose: () => void;
  game: GameRecord;
  p1Name: string;
  p2Name: string;
  bannedStages: StageName[];
  onSave: (game: GameRecord) => void;
  lockStage?: boolean;
  isGame1?: boolean;
}

const assetBase = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

const STAGE_IMAGES: Record<StageName, string> = {
  Battlefield: `${assetBase}stages/battlefield.png`,
  'Small Battlefield': `${assetBase}stages/smallbattlefield.jpg`,
  'Final Destination': `${assetBase}stages/finaldestination.jpg`,
  'Pokemon Stadium 2': `${assetBase}stages/pokemonstadium2.png`,
  Smashville: `${assetBase}stages/smashville.png`,
  'Town and City': `${assetBase}stages/townandcity.png`,
  'Kalos Pokemon League': `${assetBase}stages/kalos.png`,
  'Hollow Bastion': `${assetBase}stages/hollowbastion.jpg`,
  "Yoshi's Story": `${assetBase}stages/yoshistory.png`,
};

export function GameWizardModal({
  open,
  onClose,
  game,
  p1Name,
  p2Name,
  bannedStages,
  onSave,
  lockStage = false,
  isGame1 = false,
}: GameWizardModalProps) {
  const [step, setStep] = useState<WizardStep>('stage');
  const [draft, setDraft] = useState<GameRecord>(game);

  // Auto-advance refs
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepRef = useRef(step);
  stepRef.current = step;

  const clearAutoAdvance = () => {
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (open) {
      setDraft(game);
      setStep(lockStage && game.stage ? 'winner' : 'stage');
      clearAutoAdvance();
    }
    return () => clearAutoAdvance();
  }, [open, game, lockStage]);

  const availableStages = useMemo(
    () => STAGES.filter((s) => !bannedStages.includes(s)),
    [bannedStages]
  );

  const steps: WizardStep[] = useMemo(() => {
    const base: WizardStep[] = [];
    if (!lockStage || !game.stage) base.push('stage');
    base.push('winner', 'charP1', 'charP2', 'stocks', 'preview');
    return base;
  }, [lockStage, game.stage]);

  const currentStepIndex = steps.indexOf(step);
  const canGoBack = currentStepIndex > 0;
  const canGoForward = (() => {
    switch (step) {
      case 'stage': return !!draft.stage;
      case 'winner': return !!draft.winner;
      case 'charP1': return !!draft.characterP1;
      case 'charP2': return !!draft.characterP2;
      case 'stocks': return true;
      case 'preview': return true;
      default: return false;
    }
  })();

  const handleNext = () => {
    clearAutoAdvance();
    if (step === 'preview') {
      onSave(draft);
      onClose();
      return;
    }
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < steps.length) {
      setStep(steps[nextIndex]);
    }
  };

  const handleBack = () => {
    clearAutoAdvance();
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setStep(steps[prevIndex]);
    }
  };

  /** Schedules auto-advance 0.6s after a selection */
  const scheduleAutoAdvance = () => {
    clearAutoAdvance();
    autoAdvanceTimerRef.current = setTimeout(() => {
      const currentStep = stepRef.current;
      if (currentStep === 'preview') return;
      const idx = steps.indexOf(currentStep);
      const nextIdx = idx + 1;
      if (nextIdx > 0 && nextIdx < steps.length) {
        setStep(steps[nextIdx]);
      }
      autoAdvanceTimerRef.current = null;
    }, 600);
  };

  const progressPercent = ((currentStepIndex + 1) / steps.length) * 100;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto p-0 gap-0 bg-card border-border">
        {/* Progress bar */}
        <div className="h-1 bg-muted">
          <div
            className="h-full bg-gradient-primary transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="font-display text-lg tracking-wide">
            Game {game.index} — {getStepTitle(step)}
          </DialogTitle>
        </DialogHeader>

        <div className="px-4 pb-4 min-h-[300px] flex flex-col">
          {/* Step: stage */}
          {step === 'stage' && (
            <div className="flex-1 space-y-3">
              <p className="text-sm text-muted-foreground">
                {isGame1
                  ? 'Selecciona el escenario para Game 1'
                  : 'Selecciona el escenario'
                }
              </p>
              <div className="grid grid-cols-3 gap-2">
                {STAGES.map((stage) => {
                  const isBanned = bannedStages.includes(stage);
                  const isSelected = draft.stage === stage;

                  return (
                    <button
                      key={stage}
                      onClick={() => {
                        if (!isBanned) {
                          setDraft({ ...draft, stage });
                          scheduleAutoAdvance();
                        }
                      }}
                      disabled={isBanned}
                      className={cn(
                        'stage-card relative aspect-[3/4] p-2 flex flex-col justify-end overflow-hidden',
                        'bg-muted/70 border border-border/60',
                        isBanned && 'stage-banned opacity-50',
                        isSelected && 'stage-picked ring-2 ring-primary',
                        !isBanned && !isSelected && 'hover:scale-[1.02]'
                      )}
                    >
                      <img
                        src={STAGE_IMAGES[stage]}
                        alt={stage}
                        className="absolute inset-0 w-full h-full object-cover"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-gradient-to-b from-slate-950/20 via-slate-950/35 to-slate-950/50" />
                      {isBanned && (
                        <div className="absolute inset-0 bg-red-500/30 flex items-center justify-center">
                          <Ban className="w-5 h-5 text-destructive" />
                        </div>
                      )}
                      {isSelected && (
                        <div className="absolute inset-0 bg-emerald-500/20 flex items-center justify-center">
                          <Check className="w-6 h-6 text-success" />
                        </div>
                      )}
                      <span className={cn(
                        'relative z-10 text-[10px] font-medium text-center leading-tight',
                        isBanned && 'line-through'
                      )}>
                        {stage}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step: winner */}
          {step === 'winner' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-6">
              <p className="text-sm text-muted-foreground">¿Quién ganó este game?</p>
              <div className="grid grid-cols-2 gap-4 w-full">
                {(['p1', 'p2'] as const).map((p) => {
                  const name = p === 'p1' ? p1Name : p2Name;
                  const isSelected = draft.winner === p;
                  return (
                    <button
                      key={p}
                      onClick={() => {
                        const updated = { ...draft, winner: p };
                        if (p === 'p1') { updated.stocksP2 = 0; }
                        else { updated.stocksP1 = 0; }
                        setDraft(updated);
                        scheduleAutoAdvance();
                      }}
                      className={cn(
                        'flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all duration-200',
                        isSelected
                          ? p === 'p1'
                            ? 'border-primary bg-primary/10 glow-cyan'
                            : 'border-secondary bg-secondary/10 glow-magenta'
                          : 'border-border hover:border-muted-foreground'
                      )}
                    >
                      <div className={cn(
                        'w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold',
                        isSelected
                          ? p === 'p1' ? 'bg-primary/20 text-primary' : 'bg-secondary/20 text-secondary'
                          : 'bg-muted text-muted-foreground'
                      )}>
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium truncate max-w-full">{name}</span>
                      {isSelected && <Trophy className={cn('w-5 h-5', p === 'p1' ? 'text-primary' : 'text-secondary')} />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step: charP1 */}
          {step === 'charP1' && (
            <div className="flex-1 space-y-3">
              <p className="text-sm text-muted-foreground">
                Personaje de <span className="text-primary font-medium">{p1Name}</span>
              </p>
              <CharacterSelect
                value={draft.characterP1 || null}
                onChange={(val) => {
                  setDraft({ ...draft, characterP1: val || '' });
                  scheduleAutoAdvance();
                }}
              />
            </div>
          )}

          {/* Step: charP2 */}
          {step === 'charP2' && (
            <div className="flex-1 space-y-3">
              <p className="text-sm text-muted-foreground">
                Personaje de <span className="text-secondary font-medium">{p2Name}</span>
              </p>
              <CharacterSelect
                value={draft.characterP2 || null}
                onChange={(val) => {
                  setDraft({ ...draft, characterP2: val || '' });
                  scheduleAutoAdvance();
                }}
              />
            </div>
          )}

          {/* Step: stocks */}
          {step === 'stocks' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-6">
              <p className="text-sm text-muted-foreground">
                ¿Cuántos stocks le quedaban al ganador?
              </p>
              <div className="grid grid-cols-4 gap-3">
                {([null, 1, 2, 3] as const).map((s) => {
                  const winnerStocks = draft.winner === 'p1' ? draft.stocksP1 : draft.stocksP2;
                  const isSelected = s === null ? winnerStocks === null : winnerStocks === s;
                  return (
                    <button
                      key={s ?? 'unknown'}
                      onClick={() => {
                        if (draft.winner === 'p1') {
                          setDraft({ ...draft, stocksP1: s, stocksP2: 0 });
                        } else {
                          setDraft({ ...draft, stocksP1: 0, stocksP2: s });
                        }
                        scheduleAutoAdvance();
                      }}
                      className={cn(
                        'px-4 py-3 rounded-lg border-2 text-sm font-medium transition-all',
                        isSelected ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-muted-foreground'
                      )}
                    >
                      {s === null ? '?' : s}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Selecciona "?" si no recuerdas
              </p>
            </div>
          )}

          {/* Step: preview */}
          {step === 'preview' && (
            <div className="flex-1 space-y-4">
              <p className="text-sm text-muted-foreground">Confirma los datos del game</p>
              <div className="gaming-card p-4 space-y-3">
                {/* Stage */}
                {draft.stage && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{draft.stage}</span>
                  </div>
                )}

                {/* Winner */}
                <div className="flex items-center gap-2">
                  <Trophy className={cn('w-4 h-4', draft.winner === 'p1' ? 'text-primary' : 'text-secondary')} />
                  <span className="text-sm font-medium">
                    {draft.winner === 'p1' ? p1Name : p2Name} gana
                  </span>
                </div>

                {/* Characters */}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="flex items-center gap-2">
                    {draft.characterP1 && (
                      <img
                        src={`${assetBase}stock_icons/${draft.characterP1}.png`}
                        alt={draft.characterP1}
                        className="w-8 h-8 object-contain"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{p1Name}</p>
                      <p className="text-sm font-medium truncate">{draft.characterP1 ? slugToLabel(draft.characterP1) : '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {draft.characterP2 && (
                      <img
                        src={`${assetBase}stock_icons/${draft.characterP2}.png`}
                        alt={draft.characterP2}
                        className="w-8 h-8 object-contain"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{p2Name}</p>
                      <p className="text-sm font-medium truncate">{draft.characterP2 ? slugToLabel(draft.characterP2) : '—'}</p>
                    </div>
                  </div>
                </div>

                {/* Stocks */}
                <div className="pt-2 border-t border-border/50">
                  <p className="text-xs text-muted-foreground">
                    Stocks restantes: {
                      draft.winner === 'p1'
                        ? draft.stocksP1 === null ? 'Desconocido' : draft.stocksP1
                        : draft.stocksP2 === null ? 'Desconocido' : draft.stocksP2
                    }
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex items-center justify-between pt-4 mt-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              disabled={!canGoBack}
              className="gap-1"
            >
              <ArrowLeft className="w-4 h-4" />
              Atrás
            </Button>

            <div className="flex items-center gap-1">
              {steps.map((s, i) => (
                <div
                  key={s}
                  className={cn(
                    'w-2 h-2 rounded-full transition-all',
                    i <= currentStepIndex ? 'bg-primary' : 'bg-muted'
                  )}
                />
              ))}
            </div>

            {step === 'preview' ? (
              <Button
                size="sm"
                onClick={handleNext}
                disabled={!canGoForward}
                className="gap-1 bg-gradient-primary"
              >
                <Check className="w-4 h-4" />
                Confirmar
              </Button>
            ) : (
              /* Spacer to balance layout when no explicit Next button */
              <div className="w-[72px]" />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getStepTitle(step: WizardStep): string {
  switch (step) {
    case 'stage': return 'Escenario';
    case 'winner': return 'Ganador';
    case 'charP1': return 'Personaje P1';
    case 'charP2': return 'Personaje P2';
    case 'stocks': return 'Stocks';
    case 'preview': return 'Resumen';
  }
}
