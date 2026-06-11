/**
 * SetPage - Container principal para la vista de un Set
 * Diseño gaming esports con flujo wizard para registrar games
 * Incluye: draft persistence, gentleman, ban reset, rejected editing, access control
 */

import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/hooks/useAuth';
import { useSetData } from '@/hooks/useSetData';
import { useDebounce } from '@/hooks/useDebounce';
import { competitorApi } from '@/lib/api';
import { GameRecord, StageName, STAGES, calculateScore } from '@/types';
import { toast } from '@/hooks/use-toast';
import { ArrowLeft, RefreshCw, Save, CheckCircle2, RotateCcw, Handshake, AlertTriangle, Repeat } from 'lucide-react';

export default function SetPage() {
  const { setId } = useParams<{ setId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const mode = searchParams.get('mode');
  const isPlayerMode = mode === 'player';
  const editRequested = searchParams.get('edit') === '1';

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

  // ─── Core state ───────────────────────────────────────────────
  const [rpsWinner, setRpsWinner] = useState<'p1' | 'p2' | null>(null);
  const [bansByGame, setBansByGame] = useState<Record<number, StageName[]>>({ 1: [] });
  const [banInProgress, setBanInProgress] = useState(false);
  const [games, setGames] = useState<GameRecord[]>([]);
  const [notes, setNotes] = useState('');
  const [scopeErrorOpen, setScopeErrorOpen] = useState(false);
  const [scopeErrorMessage, setScopeErrorMessage] = useState('');
  const [bestOfDialogOpen, setBestOfDialogOpen] = useState(false);
  const [wizardGameIndex, setWizardGameIndex] = useState<number | null>(null);

  // ─── Draft persistence state ──────────────────────────────────
  const [isDraftLoading, setIsDraftLoading] = useState(true);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // ─── Gentleman state ──────────────────────────────────────────
  const [gentlemanGameIndex, setGentlemanGameIndex] = useState<number | null>(null);
  const [gentlemanConfirm, setGentlemanConfirm] = useState<Record<number, { p1: boolean; p2: boolean }>>({});

  // ─── Rejected report editing state ────────────────────────────
  const [isEditingRejected, setIsEditingRejected] = useState(false);

  // ─── Derived values ───────────────────────────────────────────
  const isParticipant = useMemo(() => {
    if (!setDetail || !user) return false;
    const uid = user.startgg_user_id;
    return String(setDetail.p1.userId) === String(uid) || String(setDetail.p2.userId) === String(uid);
  }, [setDetail, user]);

  // Admin por evento: el admin-check del evento (cacheado 60s).
  const { data: adminCheck } = useQuery({
    queryKey: ['eventAdminCheck', String(setDetail?.eventId ?? '')],
    queryFn: () => competitorApi.getEventAdminCheck(setDetail!.eventId!),
    enabled: !!setDetail?.eventId,
    staleTime: 60_000,
    retry: false,
  });

  const isAdmin = adminCheck?.isAdmin === true;

  // Report status helpers
  const reportStatus = setDetail?.existingReport?.status;
  const lockedByReport = reportStatus === 'pending' || reportStatus === 'approved';
  const rejectedReport = reportStatus === 'rejected';

  // Can player interact: participant + (in_progress OR rejected+editing) + not locked
  const canPlayerWorkflow =
    isParticipant &&
    (setDetail?.status === 'in_progress' || (rejectedReport && isEditingRejected)) &&
    !lockedByReport;

  // Show player view: participants auto-see workflow for in_progress sets,
  // admins need ?mode=player explicitly
  const showPlayerView = useMemo(() => {
    if (!setDetail) return false;
    // Locked by report -> show locked view instead
    if (lockedByReport) return false;
    // Participant with active set -> auto player view
    if (isParticipant && setDetail.status === 'in_progress') return true;
    // Rejected + editing
    if (isParticipant && rejectedReport && isEditingRejected) return true;
    // Admin explicitly requested player mode
    if (isPlayerMode && isAdmin && setDetail.status === 'in_progress') return true;
    return false;
  }, [setDetail, isParticipant, isPlayerMode, isAdmin, lockedByReport, rejectedReport, isEditingRejected]);

  const effectiveBestOf = setDetail?.bestOf ?? 3;
  const score = useMemo(() => calculateScore(games), [games]);
  const gamesNeeded = Math.ceil(effectiveBestOf / 2);

  const currentGame = useMemo(
    () => games[games.length - 1] || { index: 1, stage: null, winner: null, stocksP1: null, stocksP2: null },
    [games]
  );
  const isGame1 = games.length === 1 && !currentGame.stage;

  // Bans for the current game
  const bannedStages = useMemo(
    () => bansByGame[currentGame.index] || [],
    [bansByGame, currentGame.index]
  );

  const bansRemaining = useMemo(() => {
    const limit = isGame1 ? 7 : 3;
    return Math.max(0, limit - bannedStages.length);
  }, [isGame1, bannedStages]);

  const currentBanner = useMemo((): 'p1' | 'p2' | undefined => {
    if (!rpsWinner) return undefined;
    if (isGame1) {
      // Game 1: RPS winner bans first 3, then other player bans 4
      return bannedStages.length < 3 ? rpsWinner : rpsWinner === 'p1' ? 'p2' : 'p1';
    }
    // Games 2+: Previous game winner bans (rpsWinner is updated to prev winner)
    return rpsWinner;
  }, [rpsWinner, isGame1, bannedStages]);

  const showStageSelection = rpsWinner && currentGame && !currentGame.stage;
  const needsStagePick = currentGame && !currentGame.stage && bannedStages.length > 0;
  const hasWinner = score.p1 >= gamesNeeded || score.p2 >= gamesNeeded;

  const currentPhase = useMemo((): 'rps' | 'bans' | 'games' | 'submit' => {
    if (!rpsWinner) return 'rps';
    if (currentGame && !currentGame.stage) return 'bans';
    if (!hasWinner) return 'games';
    return 'submit';
  }, [rpsWinner, currentGame, hasWinner]);

  const completedGameIndices = useMemo(
    () => games.filter((g) => g.stage && g.winner && g.characterP1 && g.characterP2).map((g) => g.index),
    [games]
  );

  // Escenario del game anterior, para la opción de repetir stage (gentleman rápido)
  const previousStage = useMemo(() => {
    if (currentGame.index <= 1) return null;
    return games.find((g) => g.index === currentGame.index - 1)?.stage ?? null;
  }, [games, currentGame.index]);

  // ─── Draft loading on mount ───────────────────────────────────
  useEffect(() => {
    if (!setDetail) return;

    const initialize = async () => {
      let initialGames: GameRecord[] = [];

      // 1. From existing report
      if (setDetail.existingReport && setDetail.existingReport.games?.length > 0) {
        initialGames = setDetail.existingReport.games.map((g) => ({
          index: g.index,
          stage: g.stage,
          winner: g.winner,
          stocksP1: g.stocksP1,
          stocksP2: g.stocksP2,
          characterP1: g.characterP1,
          characterP2: g.characterP2,
        } as GameRecord));
      } else if (setDetail.games?.length > 0) {
        initialGames = setDetail.games;
      } else {
        initialGames = [{ index: 1, stage: null, winner: null, stocksP1: null, stocksP2: null }];
      }

      // 2. Load draft if applicable (in_progress + participant + no existing report)
      const shouldCheckDraft =
        setDetail.status === 'in_progress' && isParticipant && !setDetail.existingReport;

      if (shouldCheckDraft) {
        try {
          const draft = await competitorApi.getSetDraft(setId!);
          if (draft && draft.data) {
            const d = draft.data;
            if (d.games && d.games.length > 0) initialGames = d.games;
            if (d.bansByGame) setBansByGame(d.bansByGame);
            if (d.rpsWinner) setRpsWinner(d.rpsWinner);
            toast({
              title: 'Borrador cargado',
              description: 'Se ha restaurado tu progreso anterior',
              duration: 3000,
            });
          }
        } catch (error) {
          console.error('Error loading draft:', error);
        }
      }

      // 3. Initialize bans from server if no draft loaded
      if (setDetail.stagesBanned?.length && Object.values(bansByGame).every(b => b.length === 0)) {
        setBansByGame(prev => ({ ...prev, 1: setDetail.stagesBanned }));
      }

      if (setDetail.rpsWinner && !rpsWinner) {
        setRpsWinner(setDetail.rpsWinner);
      }

      setGames(initialGames);
      setIsDraftLoading(false);
    };

    initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setDetail, setId, isParticipant]);

  // ─── Draft auto-save with debounce ────────────────────────────
  const stateToSave = useMemo(
    () => ({ games, bansByGame, rpsWinner }),
    [games, bansByGame, rpsWinner]
  );
  const debouncedState = useDebounce(stateToSave, 2000);

  useEffect(() => {
    if (
      isDraftLoading ||
      !setDetail ||
      !isParticipant ||
      setDetail.status !== 'in_progress' ||
      !!setDetail.existingReport
    )
      return;

    // Check if state is essentially the default (nothing to save)
    const ds = debouncedState;
    const isDefault = ds.games.length === 1 && !ds.games[0]?.winner && !ds.rpsWinner;
    if (isDefault) return;

    const saveDraft = async () => {
      setIsSaving(true);
      try {
        await competitorApi.postSetDraft(setId!, ds);
        setLastSaved(new Date());
      } catch (error) {
        console.error('Error saving draft:', error);
      } finally {
        setIsSaving(false);
      }
    };

    saveDraft();
  }, [debouncedState, setId, isDraftLoading, setDetail, isParticipant]);

  // ─── Rejected report auto-edit ────────────────────────────────
  useEffect(() => {
    if (!rejectedReport) setIsEditingRejected(false);
  }, [rejectedReport]);

  useEffect(() => {
    if (rejectedReport && editRequested && isParticipant && !isEditingRejected) {
      resetForRejectedEdit();
    }
  }, [editRequested, isEditingRejected, isParticipant, rejectedReport]);

  // ─── Loading states ───────────────────────────────────────────
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

  if (isError || !setDetail) {
    return (
      <AppLayout>
        <SetNotFound eventId={setDetail?.eventId} onRetry={() => refetch()} />
      </AppLayout>
    );
  }

  // Block render until draft check is done
  if (isDraftLoading && setDetail.status === 'in_progress' && isParticipant) {
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

  // ─── Handlers ─────────────────────────────────────────────────
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

  const handleRpsComplete = (winner: 'p1' | 'p2') => {
    setRpsWinner(winner);
    toast({
      title: 'RPS completado',
      description: `${winner === 'p1' ? setDetail.p1.name : setDetail.p2.name} empieza baneando`,
    });
  };

  const handleBan = (stage: StageName) => {
    if (banInProgress) return;
    const gameIndex = currentGame.index;
    const bans = bansByGame[gameIndex] || [];
    if (bans.includes(stage)) return;

    setBanInProgress(true);
    setTimeout(() => {
      const newBans = [...bans, stage];
      setBansByGame((prev) => ({ ...prev, [gameIndex]: newBans }));

      // Auto-pick if only 1 stage remains
      const available = STAGES.filter((s) => !newBans.includes(s));
      if (available.length === 1) {
        handlePick(available[0]);
      }

      const limit = isGame1 ? 7 : 3;
      if (newBans.length === limit) {
        toast({ title: 'Bans completados', description: 'Selecciona el escenario final' });
      } else {
        toast({ description: `${stage} baneado` });
      }

      setBanInProgress(false);
    }, 120);
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
    if (isComplete && games.length < effectiveBestOf) {
      const newScore = calculateScore(updated);
      const setHasWinner = newScore.p1 >= gamesNeeded || newScore.p2 >= gamesNeeded;

      if (!setHasWinner && updated.length === games.length) {
        const lastGame = updated[updated.length - 1];
        if (lastGame.stage) {
          const nextIndex = updated.length + 1;
          setGames([
            ...updated,
            {
              index: nextIndex,
              stage: null,
              winner: null,
              stocksP1: null,
              stocksP2: null,
              // Preserve character selection between games
              characterP1: lastGame.characterP1,
              characterP2: lastGame.characterP2,
            },
          ]);
          // Auto-ban winning stage for counterpick, track per-game
          setBansByGame((prev) => ({ ...prev, [nextIndex]: lastGame.stage ? [lastGame.stage] : [] }));
          // Update rpsWinner to previous game winner (for banner logic in games 2+)
          setRpsWinner(lastGame.winner || 'p1');
        }
      }
    }
  };

  // ─── Gentleman ────────────────────────────────────────────────
  const openGentleman = (gameIndex: number) => {
    setGentlemanGameIndex(gameIndex);
    setGentlemanConfirm((prev) => ({ ...prev, [gameIndex]: { p1: false, p2: false } }));
  };

  const closeGentleman = () => setGentlemanGameIndex(null);

  const setGentlemanStage = (gameIndex: number, stage: StageName) => {
    setBansByGame((prev) => ({ ...prev, [gameIndex]: [] }));
    setGames((prev) => prev.map((g) => (g.index === gameIndex ? { ...g, stage } : g)));
    toast({ title: 'Gentleman confirmado', description: `Game ${gameIndex} se jugará en ${stage}` });
    closeGentleman();
  };

  // ─── Repetir escenario del game anterior (gentleman rápido) ───
  const repeatPreviousStage = () => {
    if (!previousStage) return;
    const gameIndex = currentGame.index;
    setBansByGame((prev) => ({ ...prev, [gameIndex]: [] }));
    setGames((prev) => prev.map((g) => (g.index === gameIndex ? { ...g, stage: previousStage } : g)));
    toast({ title: 'Escenario repetido', description: `Game ${gameIndex} se jugará en ${previousStage}` });
  };

  // ─── Reset bans ───────────────────────────────────────────────
  const resetBansForGame = () => {
    const gameIndex = currentGame.index;
    setBansByGame((prev) => ({ ...prev, [gameIndex]: [] }));
    setGames((prev) => prev.map((g) => (g.index === gameIndex ? { ...g, stage: null } : g)));
    toast({ description: 'Bans reestablecidos' });
  };

  // ─── Rejected report editing ──────────────────────────────────
  function resetForRejectedEdit() {
    setIsEditingRejected(true);
    setRpsWinner(null);
    setBanInProgress(false);
    setBansByGame({ 1: [] });
    setGames((prev) =>
      prev.length === 0 ? [{ index: 1, stage: null, winner: null, stocksP1: null, stocksP2: null }] : prev
    );
  }

  // ─── Submit ───────────────────────────────────────────────────
  const canSubmit = () => {
    const completedGames = games.filter((g) => {
      const hasValidStocks = g.winner
        ? g.winner === 'p1' ? g.stocksP1 !== null && g.stocksP1 !== undefined : g.stocksP2 !== null && g.stocksP2 !== undefined
        : true;
      return g.stage && g.winner && g.characterP1 && g.characterP2 && hasValidStocks;
    });
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

  // Gentleman state for current game
  const gConfirm = gentlemanConfirm[currentGame.index] || { p1: false, p2: false };
  const isGentlemanReady = gConfirm.p1 && gConfirm.p2;
  const canGentleman = rpsWinner && currentGame && !currentGame.stage;

  // ─── Locked report view ───────────────────────────────────────
  if (lockedByReport && setDetail.existingReport) {
    const report = setDetail.existingReport;
    return (
      <AppLayout>
        <div className="space-y-4 max-w-lg mx-auto pb-8">
          {/* Nav */}
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => (setDetail.eventId ? navigate(`/events/${setDetail.eventId}`) : navigate(-1))}
              className="shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>

          <ScoreHeader
            p1Name={setDetail.p1.name}
            p2Name={setDetail.p2.name}
            scoreP1={report.scoreP1}
            scoreP2={report.scoreP2}
            bestOf={effectiveBestOf}
            round={setDetail.round}
          />

          {/* Report status card */}
          <div className="gaming-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold tracking-wider uppercase">Reporte enviado</h3>
              <Badge variant={report.status === 'pending' ? 'secondary' : 'default'}>
                {report.status === 'pending' ? 'Pendiente de revisión' : 'Aprobado'}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {report.status === 'pending'
                ? 'El admin revisará este resultado.'
                : 'Este set ya fue validado por un admin.'}
            </p>

            {/* Games list */}
            <div className="space-y-2">
              {report.games.map((game) => (
                <div key={game.index} className="rounded-lg border border-border/40 bg-muted/30 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold">Game {game.index}</span>
                    {game.stage && <span className="text-muted-foreground">{game.stage}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span>Ganador: {game.winner === 'p1' ? setDetail.p1.name : setDetail.p2.name}</span>
                    <span>Stocks {game.stocksP1} - {game.stocksP2}</span>
                  </div>
                </div>
              ))}
            </div>

            {report.notes && (
              <div className="rounded-lg bg-muted/50 p-3 text-sm">
                <p className="font-semibold mb-1">Notas</p>
                <p className="text-muted-foreground whitespace-pre-wrap">{report.notes}</p>
              </div>
            )}

            <Button className="w-full" variant="outline" onClick={() => navigate('/dashboard')}>
              Volver al dashboard
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  // ─── Main render ──────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="space-y-4 max-w-lg mx-auto pb-8">
        {/* Navigation Bar */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => (setDetail.eventId ? navigate(`/events/${setDetail.eventId}`) : navigate(-1))}
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
          bestOf={effectiveBestOf}
          round={setDetail.round}
        />

        {/* Draft Status Indicator */}
        {canPlayerWorkflow && (
          <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground px-1">
            {isSaving ? (
              <>
                <Save className="h-3 w-3 animate-pulse" />
                <span>Guardando...</span>
              </>
            ) : lastSaved ? (
              <>
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                <span>Guardado {lastSaved.toLocaleTimeString()}</span>
              </>
            ) : null}
          </div>
        )}

        {/* Rejected Report Card */}
        {rejectedReport && (
          <div className="gaming-card p-4 border-destructive/40 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-destructive">
                Reporte rechazado
              </h3>
            </div>
            <p className="text-sm text-muted-foreground">
              El admin rechazó el reporte anterior. Corrige la información y envía uno nuevo.
            </p>
            {setDetail.existingReport?.rejectionReason && (
              <p className="text-sm text-destructive">
                Motivo: {setDetail.existingReport.rejectionReason}
              </p>
            )}
            {isParticipant && !isEditingRejected && (
              <Button className="w-full" onClick={resetForRejectedEdit}>
                Editar reporte
              </Button>
            )}
          </div>
        )}

        {/* Admin Actions (non-player view) */}
        {isAdmin && !showPlayerView && (
          <SetActions
            status={setDetail.status}
            isAdmin={isAdmin}
            onStart={() => setBestOfDialogOpen(true)}
            isStarting={isStarting}
          />
        )}

        {/* Player View Workflow */}
        {showPlayerView && (
          <>
            {/* Flow Stepper */}
            <SetFlowStepper currentPhase={currentPhase} />

            {/* RPS Phase */}
            {!rpsWinner && !isEditingRejected && (
              <LocalRps
                p1Name={setDetail.p1.name}
                p2Name={setDetail.p2.name}
                onComplete={handleRpsComplete}
              />
            )}

            {/* Repetir escenario anterior (games 2+) */}
            {showStageSelection && previousStage && (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
                onClick={repeatPreviousStage}
              >
                <Repeat className="w-4 h-4" />
                Repetir escenario ({previousStage})
              </Button>
            )}

            {/* Gentleman & Reset Bans Buttons */}
            {showStageSelection && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-1.5"
                  disabled={!canGentleman}
                  onClick={() => openGentleman(currentGame.index)}
                >
                  <Handshake className="w-4 h-4" />
                  Gentleman
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-1.5"
                  disabled={bannedStages.length === 0 && !currentGame.stage}
                  onClick={resetBansForGame}
                >
                  <RotateCcw className="w-4 h-4" />
                  Reestablecer bans
                </Button>
              </div>
            )}

            {/* Bans/Pick Phase */}
            {showStageSelection && (
              <StageSelector
                bannedStages={bannedStages}
                pickedStage={currentGame.stage}
                mode={needsStagePick && bansRemaining === 0 ? 'pick' : 'ban'}
                bansRemaining={bansRemaining}
                busy={banInProgress}
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

                {/* Permite deshacer el stage elegido (gentleman/repetido/pick) mientras el game no tenga ganador */}
                {!currentGame.winner && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full gap-1.5 text-xs text-muted-foreground"
                    onClick={resetBansForGame}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Cambiar escenario de Game {currentGame.index}
                  </Button>
                )}
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

            {/* Submit Button: solo visible cuando el set ya tiene ganador */}
            {hasWinner && (
              <SubmitButton
                canSubmit={canSubmit()}
                isSubmitting={isSubmitting}
                onClick={handleSubmit}
              />
            )}
          </>
        )}

        {/* Non-participant / non-admin readonly + not_started message */}
        {!showPlayerView && !isAdmin && setDetail.status === 'not_started' && (
          <div className="gaming-card p-6 text-center space-y-3">
            <p className="text-muted-foreground text-sm">Este set aún no ha sido iniciado.</p>
            <Button variant="outline" onClick={() => navigate(`/events/${setDetail.eventId}`)}>
              Volver al evento
            </Button>
          </div>
        )}

        {/* Readonly games view (admin not in player mode, or completed sets, or non-participant) */}
        {!showPlayerView && setDetail.games?.length > 0 && (
          <GamesHistory
            games={setDetail.games}
            p1Name={setDetail.p1.name}
            p2Name={setDetail.p2.name}
          />
        )}

        {/* Gentleman Dialog */}
        <AlertDialog
          open={gentlemanGameIndex !== null}
          onOpenChange={(open) => !open && closeGentleman()}
        >
          <AlertDialogContent className="bg-card border-border">
            <AlertDialogHeader>
              <AlertDialogTitle className="font-display tracking-wide">
                Gentleman (Game {currentGame.index})
              </AlertDialogTitle>
            </AlertDialogHeader>

            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Ambos jugadores deben confirmar para elegir escenario sin bans.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant={gConfirm.p1 ? 'default' : 'outline'}
                  className={gConfirm.p1 ? 'bg-gradient-primary' : ''}
                  onClick={() =>
                    setGentlemanConfirm((prev) => ({
                      ...prev,
                      [currentGame.index]: { ...(prev[currentGame.index] || { p1: false, p2: false }), p1: true },
                    }))
                  }
                >
                  {gConfirm.p1 ? <CheckCircle2 className="w-4 h-4 mr-1" /> : null}
                  {setDetail.p1.name}
                </Button>
                <Button
                  variant={gConfirm.p2 ? 'default' : 'outline'}
                  className={gConfirm.p2 ? 'bg-gradient-primary' : ''}
                  onClick={() =>
                    setGentlemanConfirm((prev) => ({
                      ...prev,
                      [currentGame.index]: { ...(prev[currentGame.index] || { p1: false, p2: false }), p2: true },
                    }))
                  }
                >
                  {gConfirm.p2 ? <CheckCircle2 className="w-4 h-4 mr-1" /> : null}
                  {setDetail.p2.name}
                </Button>
              </div>

              {isGentlemanReady && (
                <div className="space-y-2 animate-slide-up">
                  <p className="text-sm font-medium">Elige escenario (sin bans)</p>
                  <StageSelector
                    bannedStages={[]}
                    pickedStage={null}
                    mode="pick"
                    bansRemaining={0}
                    busy={false}
                    onBan={() => {}}
                    onPick={(stage) => setGentlemanStage(currentGame.index, stage)}
                    currentBanner={undefined}
                    p1Name={setDetail.p1.name}
                    p2Name={setDetail.p2.name}
                  />
                </div>
              )}
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => {
                  setGentlemanConfirm((prev) => ({ ...prev, [currentGame.index]: { p1: false, p2: false } }));
                  closeGentleman();
                }}
              >
                Cancelar
              </AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

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
