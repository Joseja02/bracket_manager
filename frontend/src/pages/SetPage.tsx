/**
 * SetPage - Container principal para la vista de un Set
 * Diseño gaming esports con flujo wizard para registrar games
 */

import { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { ScoreHeader } from '@/components/set/ScoreHeader';
import { SetFlowStepper } from '@/components/set/SetFlowStepper';
import { SetActions } from '@/components/set/SetActions';
import { LocalRps } from '@/components/set/LocalRps';
import { StageSelector } from '@/components/set/StageSelector';
import { GameSummaryCard } from '@/components/set/GameSummaryCard';
import { GameWizardModal } from '@/components/set/GameWizardModal';
import { SubmitButton } from '@/components/set/SubmitButton';
import { SetNotFound } from '@/components/set/SetNotFound';
import { ScopeErrorModal } from '@/components/set/ScopeErrorModal';
import { BestOfDialog } from '@/components/set/BestOfDialog';
import { GamesHistory } from '@/components/set/GamesHistory';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useSetData } from '@/hooks/useSetData';
import { GameRecord, StageName, STAGES, calculateScore } from '@/types';
import { toast } from '@/hooks/use-toast';
import { ArrowLeft, RefreshCw } from 'lucide-react';

export default function SetPage() {
  const { setId } = useParams<{ setId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const mode = searchParams.get('mode');
  const isPlayerMode = mode === 'player';
  
  const {
    setDetail,
    isLoading,
    isError,
    refetch,
    startSet,
    isStarting,
    submitReport,
    isSubmitting,
  } = useSetData(setId);

  // Local state for player workflow
  const [rpsWinner, setRpsWinner] = useState<'p1' | 'p2' | null>(null);
  const [bannedStages, setBannedStages] = useState<StageName[]>([]);
  const [games, setGames] = useState<GameRecord[]>([]);
  const [notes, setNotes] = useState('');
  const [scopeErrorOpen, setScopeErrorOpen] = useState(false);
  const [scopeErrorMessage, setScopeErrorMessage] = useState('');
  const [bestOfDialogOpen, setBestOfDialogOpen] = useState(false);
  const [wizardGameIndex, setWizardGameIndex] = useState<number | null>(null);

  // Initialize state from server data
  useEffect(() => {
    if (setDetail) {
      if (setDetail.rpsWinner) setRpsWinner(setDetail.rpsWinner);
      if (setDetail.stagesBanned?.length) setBannedStages(setDetail.stagesBanned);
      if (setDetail.games?.length) {
        setGames(setDetail.games);
      } else if (games.length === 0) {
        setGames([{ index: 1, stage: null, winner: null, stocksP1: null, stocksP2: null }]);
      }
    }
  }, [setDetail, games.length]);

  // Determine if user can access player mode
  const canAccessPlayerMode = useMemo(() => {
    if (!setDetail || !user) return false;
    const userStartggId = user.startgg_user_id;
    const isP1 = setDetail.p1.userId?.toString() === userStartggId;
    const isP2 = setDetail.p2.userId?.toString() === userStartggId;
    const isAdminOrCanAccess = user.role === 'admin' || ('isAdmin' in setDetail && (setDetail as { isAdmin?: boolean }).isAdmin);
    return isP1 || isP2 || isAdminOrCanAccess;
  }, [setDetail, user]);

  const isAdmin = user?.role === 'admin' || ('isAdmin' in (setDetail || {}) && (setDetail as { isAdmin?: boolean })?.isAdmin);
  const showPlayerView = isPlayerMode && canAccessPlayerMode && setDetail?.status === 'in_progress';

  // Calculate scores
  const score = useMemo(() => calculateScore(games), [games]);
  const gamesNeeded = setDetail ? Math.ceil(setDetail.bestOf / 2) : 2;

  // Stage selection logic
  const currentGame = games[games.length - 1];
  const isGame1 = games.length === 1 && !currentGame?.stage;
  const needsStagePick = currentGame && !currentGame.stage && bannedStages.length > 0;

  const bansRemaining = useMemo(() => {
    if (isGame1) {
      return Math.max(0, 7 - bannedStages.length);
    } else {
      return Math.max(0, 3 - bannedStages.length);
    }
  }, [isGame1, bannedStages]);

  // Determine current ban turn for game 1
  const currentBanner = useMemo((): 'p1' | 'p2' | undefined => {
    if (!rpsWinner || !isGame1) return undefined;
    // Game 1: RPS winner bans first 3, then loser bans 4
    if (bannedStages.length < 3) {
      return rpsWinner;
    } else {
      return rpsWinner === 'p1' ? 'p2' : 'p1';
    }
  }, [rpsWinner, isGame1, bannedStages]);

  const showStageSelection = rpsWinner && currentGame && !currentGame.stage;
  const hasWinner = score.p1 >= gamesNeeded || score.p2 >= gamesNeeded;

  // Determine current flow phase for stepper
  const currentPhase = useMemo((): 'rps' | 'bans' | 'games' | 'submit' => {
    if (!rpsWinner) return 'rps';
    if (currentGame && !currentGame.stage) return 'bans';
    if (!hasWinner) return 'games';
    return 'submit';
  }, [rpsWinner, currentGame, hasWinner]);

  // Completed game indices
  const completedGameIndices = useMemo(
    () => games.filter((g) => g.stage && g.winner && g.characterP1 && g.characterP2).map((g) => g.index),
    [games]
  );

  // Loading state
  if (isLoading) {
    return (
      <AppLayout>
        <div className="space-y-4 max-w-lg mx-auto">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  // Error / Not found state
  if (isError || !setDetail) {
    return (
      <AppLayout>
        <SetNotFound eventId={setDetail?.eventId} onRetry={() => refetch()} />
      </AppLayout>
    );
  }

  // Handlers
  const handleStartSet = async (bestOf: 3 | 5) => {
    try {
      await startSet(bestOf);
      await refetch();
      setBestOfDialogOpen(false);
    } catch (err) {
      const axiosError = err as { response?: { status?: number; data?: { message?: string } } } | undefined;
      if (axiosError?.response?.status === 403) {
        setScopeErrorMessage(axiosError?.response?.data?.message || '');
        setScopeErrorOpen(true);
      }
    }
  };

  const handleViewSet = () => navigate(`/sets/${setId}?mode=player`);

  const handleForceStatus = (status: string) => {
    toast({
      title: 'Función en desarrollo',
      description: `Forzar estado a "${status}" requiere implementación del backend`,
    });
  };

  const handleRpsComplete = (winner: 'p1' | 'p2') => {
    setRpsWinner(winner);
    toast({
      title: 'RPS completado',
      description: `${winner === 'p1' ? setDetail.p1.name : setDetail.p2.name} empieza baneando`,
    });
  };

  const handleBan = (stage: StageName) => {
    if (bannedStages.includes(stage)) return;
    const newBanned = [...bannedStages, stage];
    setBannedStages(newBanned);
    const available = STAGES.filter((s) => !newBanned.includes(s));
    if (available.length === 1) handlePick(available[0]);
    toast({ description: `${stage} baneado` });
  };

  const handlePick = (stage: StageName) => {
    if (currentGame && !currentGame.stage) {
      const updated = [...games];
      updated[updated.length - 1] = { ...currentGame, stage };
      setGames(updated);
      toast({ title: 'Stage seleccionado', description: `${stage} para Game ${currentGame.index}` });
    }
  };

  const handleGameSave = (savedGame: GameRecord) => {
    const updated = games.map((g) => (g.index === savedGame.index ? savedGame : g));
    setGames(updated);

    const isComplete = savedGame.stage && savedGame.winner && savedGame.characterP1 && savedGame.characterP2;
    if (isComplete && games.length < setDetail.bestOf) {
      const newScore = calculateScore(updated);
      const setHasWinner = newScore.p1 >= gamesNeeded || newScore.p2 >= gamesNeeded;

      if (!setHasWinner && updated.length === games.length) {
        const lastGame = updated[updated.length - 1];
        if (lastGame.stage) {
          const nextIndex = updated.length + 1;
          setGames([...updated, { index: nextIndex, stage: null, winner: null, stocksP1: null, stocksP2: null }]);
          setBannedStages([lastGame.stage]);
        }
      }
    }
  };

  const canSubmit = () => {
    const completedGames = games.filter((g) => g.stage && g.winner && g.characterP1 && g.characterP2);
    return hasWinner && completedGames.length >= Math.max(score.p1, score.p2);
  };

  const handleSubmit = async () => {
    if (!canSubmit()) {
      toast({ variant: 'destructive', title: 'Set incompleto', description: 'Completa todos los games antes de enviar' });
      return;
    }
    try {
      await submitReport({ games, notes: notes || undefined });
      setTimeout(() => navigate('/dashboard'), 1500);
    } catch (err) {
      const axiosError = err as { response?: { status?: number; data?: { message?: string } } } | undefined;
      if (axiosError?.response?.status === 403) {
        setScopeErrorMessage(axiosError?.response?.data?.message || '');
        setScopeErrorOpen(true);
      }
    }
  };

  const wizardGame = wizardGameIndex !== null ? games.find((g) => g.index === wizardGameIndex) : null;

  return (
    <AppLayout>
      <div className="space-y-4 max-w-lg mx-auto pb-8">
        {/* Navigation Bar */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDetail.eventId ? navigate(`/events/${setDetail.eventId}`) : navigate(-1)}
            className="shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {/* Score Header */}
        <ScoreHeader
          p1Name={setDetail.p1.name}
          p2Name={setDetail.p2.name}
          scoreP1={score.p1}
          scoreP2={score.p2}
          bestOf={setDetail.bestOf}
          round={setDetail.round}
        />

        {/* Admin Actions (non-player view) */}
        {isAdmin && !showPlayerView && (
          <SetActions
            status={setDetail.status}
            isAdmin={isAdmin}
            onStart={() => setBestOfDialogOpen(true)}
            onView={handleViewSet}
            onForceStatus={handleForceStatus}
            isStarting={isStarting}
          />
        )}

        {/* Player View Workflow */}
        {showPlayerView && (
          <>
            {/* Flow Stepper */}
            <SetFlowStepper currentPhase={currentPhase} />

            {/* RPS Phase */}
            {!rpsWinner && (
              <LocalRps
                p1Name={setDetail.p1.name}
                p2Name={setDetail.p2.name}
                onComplete={handleRpsComplete}
              />
            )}

            {/* Bans/Pick Phase */}
            {showStageSelection && (
              <StageSelector
                bannedStages={bannedStages}
                pickedStage={currentGame.stage}
                mode={needsStagePick && bansRemaining === 0 ? 'pick' : 'ban'}
                bansRemaining={bansRemaining}
                onBan={handleBan}
                onPick={handlePick}
                currentBanner={currentBanner}
                p1Name={setDetail.p1.name}
                p2Name={setDetail.p2.name}
              />
            )}

            {/* Games Phase - Summary Cards */}
            {rpsWinner && currentGame?.stage && (
              <div className="space-y-3">
                <h3 className="font-display text-sm font-semibold tracking-wider text-muted-foreground uppercase px-1">
                  Games
                </h3>
                {games.map((game) => (
                  <GameSummaryCard
                    key={game.index}
                    game={game}
                    p1Name={setDetail.p1.name}
                    p2Name={setDetail.p2.name}
                    isCurrent={game.index === currentGame.index && !completedGameIndices.includes(game.index)}
                    onClick={() => setWizardGameIndex(game.index)}
                  />
                ))}
              </div>
            )}

            {/* Notes (when set has a winner) */}
            {hasWinner && (
              <div className="gaming-card p-4 space-y-3 animate-slide-up">
                <h3 className="font-display text-sm font-semibold tracking-wider text-muted-foreground uppercase">
                  Notas (opcional)
                </h3>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ej: Buenos games, DQ de oponente, etc."
                  className="bg-muted/50 border-border/50 resize-none"
                  rows={2}
                />
              </div>
            )}

            {/* Submit Button */}
            {rpsWinner && currentGame?.stage && (
              <SubmitButton
                canSubmit={canSubmit()}
                isSubmitting={isSubmitting}
                onClick={handleSubmit}
                completedGames={completedGameIndices.length}
                totalGamesNeeded={gamesNeeded}
              />
            )}
          </>
        )}

        {/* Admin View - Games History (readonly) */}
        {!showPlayerView && setDetail.games?.length > 0 && (
          <GamesHistory
            games={setDetail.games}
            p1Name={setDetail.p1.name}
            p2Name={setDetail.p2.name}
          />
        )}

        {/* Game Wizard Modal */}
        {wizardGame && (
          <GameWizardModal
            open={wizardGameIndex !== null}
            onClose={() => setWizardGameIndex(null)}
            game={wizardGame}
            p1Name={setDetail.p1.name}
            p2Name={setDetail.p2.name}
            bannedStages={bannedStages}
            onSave={handleGameSave}
            lockStage={!!wizardGame.stage}
            isGame1={wizardGame.index === 1}
          />
        )}

        <BestOfDialog
          open={bestOfDialogOpen}
          onClose={() => setBestOfDialogOpen(false)}
          onConfirm={handleStartSet}
          isSubmitting={isStarting}
        />
        <ScopeErrorModal
          open={scopeErrorOpen}
          onClose={() => setScopeErrorOpen(false)}
          message={scopeErrorMessage}
        />
      </div>
    </AppLayout>
  );
}
