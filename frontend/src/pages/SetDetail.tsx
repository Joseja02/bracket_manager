import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { GameRow } from '@/components/set/GameRow';
import { StageSelector } from '@/components/set/StageSelector';
import { LocalRps } from '@/components/set/LocalRps';
import { competitorApi } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { GameRecord, calculateScore, StageName, isGameComplete } from '@/types';
import { ArrowLeft, Send, Users, Save, CheckCircle2, Loader2 } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import { toast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function SetDetail() {
  const { setId } = useParams<{ setId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const { user } = useAuth();

  const [rpsWinner, setRpsWinner] = useState<'p1' | 'p2' | null>(null);
  const [rpsMode, setRpsMode] = useState<'local' | null>(null);
  const [bansByGame, setBansByGame] = useState<Record<number, StageName[]>>({ 1: [] });
  const [banInProgress, setBanInProgress] = useState(false);
  const [games, setGames] = useState<GameRecord[]>([
    { index: 1, stage: null, winner: null, stocksP1: null, stocksP2: null },
  ]);
  const [openSections, setOpenSections] = useState<string[]>(['bans-1', 'game-1']);
  const currentGame = games[games.length - 1];
  const [isEditingRejected, setIsEditingRejected] = useState(false);
  const [isDraftLoading, setIsDraftLoading] = useState(true);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [gentlemanGameIndex, setGentlemanGameIndex] = useState<number | null>(null);
  const [gentlemanConfirm, setGentlemanConfirm] = useState<Record<number, { p1: boolean; p2: boolean }>>({});

  const { data: setDetail, isLoading } = useQuery({
    queryKey: ['setDetail', setId],
    queryFn: () => competitorApi.getSetDetail(setId!),
    enabled: !!setId,
  });

  const isParticipant =
    !!user &&
    (String(user.startgg_user_id) === String(setDetail?.p1?.userId) ||
      String(user.startgg_user_id) === String(setDetail?.p2?.userId));

  // Sincronizar estado inicial con reporte existente (si lo hay) o con datos del servidor
  useEffect(() => {
    if (!setDetail) return;

    const initialize = async () => {
      // 1. Logic from original useEffect: Sync with existing report or server data
      let initialGames: GameRecord[] = [];
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

      // 2. Draft Loading Logic (Overrides partial server data if draft exists)
      const shouldCheckDraft = setDetail.status === 'in_progress' && isParticipant && !setDetail.existingReport;

      if (shouldCheckDraft) {
        try {
          const draft = await competitorApi.getSetDraft(setId!);
          if (draft && draft.data) {
            const d = draft.data;
            if (d.games && d.games.length > 0) initialGames = d.games;
            if (d.bansByGame) setBansByGame(d.bansByGame);
            if (d.rpsWinner) setRpsWinner(d.rpsWinner);
            if (d.rpsMode) setRpsMode(d.rpsMode);
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

      setGames(initialGames);
      setIsDraftLoading(false);
    };

    initialize();
  }, [setDetail, setId, isParticipant]);

  // Auto-Save Logic
  const stateToSave = { games, bansByGame, rpsWinner, rpsMode };
  const debouncedState = useDebounce(stateToSave, 2000);

  useEffect(() => {
    if (isDraftLoading || !setDetail || !isParticipant || setDetail.status !== 'in_progress' || !!setDetail.existingReport) return;

    // Prevent saving if state is essentially empty/default (optional but good)
    const isDefault = games.length === 1 && !games[0].winner && !rpsWinner;
    if (isDefault) return;

    const saveDraft = async () => {
      setIsSaving(true);
      try {
        await competitorApi.postSetDraft(setId!, debouncedState);
        setLastSaved(new Date());
      } catch (error) {
        console.error('Error saving draft:', error);
      } finally {
        setIsSaving(false);
      }
    };

    saveDraft();
  }, [debouncedState, setId, isDraftLoading, setDetail, isParticipant]);

  const submitMutation = useMutation({
    mutationFn: (data: { games: GameRecord[] }) => competitorApi.submitReport(setId!, data),
    onSuccess: () => {
      toast({
        title: '¡Reporte enviado!',
        description: 'El set ha sido reportado para revisión del admin',
      });
      queryClient.invalidateQueries({ queryKey: ['setDetail', setId] });
      setTimeout(() => navigate('/dashboard'), 1500);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || error?.response?.data?.error || 'No se pudo enviar el reporte';
      toast({
        title: 'Error al enviar reporte',
        description: message,
        variant: 'destructive',
      });
    },
  });

  useEffect(() => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      next.add(`bans-${currentGame.index}`);
      next.add(`game-${currentGame.index}`);
      return Array.from(next);
    });
  }, [currentGame.index]);

  const isAdminFromSet = !!setDetail?.isAdmin;
  const isAdminUser = user?.role === 'admin';
  const canViewSet = isAdminFromSet || isParticipant || isAdminUser;

  const reportStatus = setDetail?.existingReport?.status;
  const lockedByReport = reportStatus === 'pending' || reportStatus === 'approved';
  const rejectedReport = reportStatus === 'rejected';
  const editRequested = searchParams.get('edit') === '1';

  const effectiveBestOf = setDetail?.bestOf ?? 3;
  const score = useMemo(() => calculateScore(games), [games]);
  const gamesNeeded = Math.ceil(effectiveBestOf / 2);

  // Solo participantes pueden hacer RPS/Bans/Games (admins NO interfieren salvo que participen)
  const canPlayerWorkflow =
    isParticipant &&
    (setDetail?.status === 'in_progress' || (rejectedReport && isEditingRejected)) &&
    !lockedByReport;

  const isEditingRejectedFlow = rejectedReport && isEditingRejected;

  const resetForRejectedEdit = () => {
    setIsEditingRejected(true);
    setRpsWinner(null);
    setRpsMode(null);
    setBanInProgress(false);
    setBansByGame({ 1: [] });
    setOpenSections(['bans-1', 'game-1']);
    // Mantener los escenarios ya seleccionados (no resetear stage) para que el jugador solo corrija lo necesario
    setGames((prev) =>
      prev.length === 0 ? [{ index: 1, stage: null, winner: null, stocksP1: null, stocksP2: null }] : prev
    );
  };

  useEffect(() => {
    if (!rejectedReport) {
      setIsEditingRejected(false);
    }
  }, [rejectedReport]);

  useEffect(() => {
    if (rejectedReport && editRequested && isParticipant && !isEditingRejected) {
      resetForRejectedEdit();
    }
  }, [editRequested, isEditingRejected, isParticipant, rejectedReport]);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </AppLayout>
    );
  }

  // Blocking render until draft check is done, to avoid state jump
  if (isDraftLoading && setDetail?.status === 'in_progress' && isParticipant) {
    return (
      <AppLayout>
        <div className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </AppLayout>
    );
  }

  if (!setDetail) {
    return (
      <AppLayout>
        <div className="text-center py-10">
          <p className="text-muted-foreground">Set no encontrado</p>
        </div>
      </AppLayout>
    );
  }

  const getPrevWinner = (gameIndex: number) => games.find((g) => g.index === gameIndex - 1)?.winner;

  const getBannerForGame = (game: GameRecord, bans: StageName[]) => {
    if (!rpsWinner) return undefined;
    if (game.index === 1) {
      return bans.length < 3 ? rpsWinner : rpsWinner === 'p1' ? 'p2' : 'p1';
    }
    return getPrevWinner(game.index) || rpsWinner;
  };

  const getBanLimit = (gameIndex: number) => (gameIndex === 1 ? 7 : 3);

  const getStageFlow = (game: GameRecord) => {
    const bans = bansByGame[game.index] || [];
    const limit = getBanLimit(game.index);
    // Permitir banear/gentleman si es el game actual, hay rpsWinner, y NO hay bans activos (se reseteó)
    // O si no hay stage seleccionado aún
    const canBanOrPick = game.index === currentGame.index && !!rpsWinner && (bans.length === 0 || !game.stage);
    if (!canBanOrPick) {
      return { mode: 'view' as const, bansRemaining: 0, banner: getBannerForGame(game, bans), limit };
    }

    if (bans.length < limit) {
      return { mode: 'ban' as const, bansRemaining: limit - bans.length, banner: getBannerForGame(game, bans), limit };
    }

    return { mode: 'pick' as const, bansRemaining: 0, banner: getBannerForGame(game, bans), limit };
  };

  const readonlyGames = games.length > 0 ? games : setDetail?.games ?? [];

  const handleRpsComplete = (winner: 'p1' | 'p2') => {
    setRpsWinner(winner);
    setRpsMode(null);
    toast({
      title: 'RPS completado',
      description: `${winner === 'p1' ? setDetail.p1.name : setDetail.p2.name} decide quién banea primero`,
    });
  };

  const handleBan = (gameIndex: number) => (stage: StageName) => {
    if (banInProgress) return;
    const game = games.find((g) => g.index === gameIndex);
    if (!game) return;
    if (game.index !== currentGame.index || game.stage || !rpsWinner) return;
    const bans = bansByGame[gameIndex] || [];
    const { mode, limit } = getStageFlow(game);
    if (mode !== 'ban') {
      toast({ title: 'Aún no', description: 'No es el momento de banear', variant: 'destructive' });
      return;
    }
    if (bans.includes(stage)) return;
    setBanInProgress(true);

    setTimeout(() => {
      const newBans = [...bans, stage];
      setBansByGame((prev) => ({ ...prev, [gameIndex]: newBans }));

      if (newBans.length === limit) {
        toast({ title: 'Bans completados', description: 'Selecciona el escenario final' });
      }

      setBanInProgress(false);
    }, 120);
  };

  const handlePick = (stage: StageName) => {
    const updated = [...games];
    updated[updated.length - 1] = { ...currentGame, stage };
    setGames(updated);
    toast({ title: 'Escenario seleccionado', description: `Game ${currentGame.index} se jugará en ${stage}` });
  };

  const handleRepeatBans = () => {
    setGames((prev) => prev.map((g) => (g.index === currentGame.index ? { ...g, stage: null } : g)));
    setBansByGame((prev) => ({ ...prev, [currentGame.index]: [] }));
  };

  const resetBansForGame = (gameIndex: number) => {
    setBansByGame((prev) => ({ ...prev, [gameIndex]: [] }));
    // Limpiar stage para permitir volver a banear/gentleman/pick
    setGames((prev) => prev.map((g) => (g.index === gameIndex ? { ...g, stage: null } : g)));
  };

  const handleGameChange = (updatedGame: GameRecord) => {
    const updated = games.map((g) => (g.index === updatedGame.index ? updatedGame : g));
    setGames(updated);

    const isComplete = isGameComplete(updatedGame);
    
    if (isComplete && games.length < effectiveBestOf) {
      const newScore = calculateScore(updated);
      const hasWinner = newScore.p1 >= gamesNeeded || newScore.p2 >= gamesNeeded;

      if (!hasWinner && updated.length === games.length) {
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
              // Mantener selección de personajes por defecto entre games
              characterP1: lastGame.characterP1,
              characterP2: lastGame.characterP2,
            },
          ]);
          setBansByGame((prev) => ({ ...prev, [nextIndex]: [] }));
          setRpsWinner(lastGame.winner || 'p1');
        }
      }
    }
  };

  const openGentleman = (gameIndex: number) => {
    setGentlemanGameIndex(gameIndex);
    setGentlemanConfirm((prev) => ({ ...prev, [gameIndex]: { p1: false, p2: false } }));
  };

  const closeGentleman = () => setGentlemanGameIndex(null);

  const setGentlemanStage = (gameIndex: number, stage: StageName) => {
    // Gentleman: elegir stage sin bans
    setBansByGame((prev) => ({ ...prev, [gameIndex]: [] }));
    setGames((prev) => prev.map((g) => (g.index === gameIndex ? { ...g, stage } : g)));
    toast({ title: 'Gentleman confirmado', description: `Game ${gameIndex} se jugará en ${stage}` });
    closeGentleman();
  };

  const canSubmit = () => {
    const hasWinner = score.p1 >= gamesNeeded || score.p2 >= gamesNeeded;
    const completedGames = games.filter(isGameComplete);
    return hasWinner && completedGames.length >= Math.max(score.p1, score.p2);
  };

  const handleSubmit = () => {
    if (!canSubmit()) {
      toast({
        variant: 'destructive',
        title: 'Set incompleto',
        description: 'Completa todos los games antes de enviar',
      });
      return;
    }

    submitMutation.mutate({ games });
  };

  if (lockedByReport && setDetail.existingReport) {
    const report = setDetail.existingReport;
    return (
      <AppLayout>
        <div className="space-y-6 max-w-xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex-1">
              <h1 className="text-2xl font-bold truncate">{setDetail.round}</h1>
              <p className="text-muted-foreground text-sm truncate">
                {setDetail.p1.name} vs {setDetail.p2.name}
              </p>
            </div>
          </div>

          <Card className="border-primary/40">
            <CardHeader className="space-y-2">
              <div className="flex items-center justify-between">
                <CardTitle>Reporte enviado</CardTitle>
                <Badge variant={report.status === 'pending' ? 'secondary' : 'default'}>
                  {report.status === 'pending' ? 'Pendiente de revisión' : 'Aprobado'}
                </Badge>
              </div>
              <CardDescription>
                {report.status === 'pending'
                  ? 'El admin revisará este resultado. Te avisaremos cuando sea validado.'
                  : 'Este set ya fue validado por un admin.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex flex-col rounded-lg border p-3">
                  <span className="text-muted-foreground">{setDetail.p1.name}</span>
                  <span className="text-2xl font-bold">{report.scoreP1}</span>
                </div>
                <div className="flex flex-col rounded-lg border p-3 text-right">
                  <span className="text-muted-foreground">{setDetail.p2.name}</span>
                  <span className="text-2xl font-bold">{report.scoreP2}</span>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold">Games reportados</p>
                <div className="space-y-2">
                  {report.games.map((game) => (
                    <div key={game.index} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">Game {game.index}</span>
                        {game.stage && <span className="text-muted-foreground">{game.stage}</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-2 text-muted-foreground">
                        <span>Winner: {game.winner === 'p1' ? setDetail.p1.name : setDetail.p2.name}</span>
                        <span className="text-xs">Stocks {game.stocksP1} - {game.stocksP2}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {report.notes && (
                <div className="rounded-lg bg-muted p-3 text-sm">
                  <p className="font-semibold mb-1">Notas</p>
                  <p className="text-muted-foreground whitespace-pre-wrap">{report.notes}</p>
                </div>
              )}

              <Button className="w-full" onClick={() => navigate('/dashboard')}>
                Volver al dashboard
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6 max-w-xl mx-auto px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold truncate">{setDetail.round}</h1>
            <p className="text-muted-foreground text-sm truncate">
              {setDetail.p1.name} vs {setDetail.p2.name}
            </p>
          </div>
        </div>

        <div className="w-full">
          <div className="bg-gradient-to-r from-primary/20 to-secondary/10 rounded-lg p-4 flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm text-muted-foreground">{setDetail.p1.name}</span>
              <span className="text-2xl font-bold">{score.p1}</span>
            </div>
            <div className="text-center">
              <span className="text-sm text-muted-foreground">Best of</span>
              <div className="text-lg font-semibold">{effectiveBestOf}</div>
            </div>
            <div className="flex flex-col text-right">
              <span className="text-sm text-muted-foreground">{setDetail.p2.name}</span>
              <span className="text-2xl font-bold">{score.p2}</span>
            </div>
          </div>
        </div>

        {/* Draft Status Indicator */}
        {canPlayerWorkflow && (
          <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground mt-1 px-1">
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

      {rejectedReport && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Reporte rechazado</CardTitle>
            <CardDescription>
              El admin rechazó el reporte anterior. Corrige la información y envía uno nuevo.
            </CardDescription>
          </CardHeader>
          {setDetail.existingReport?.rejectionReason && (
            <CardContent className="text-sm text-destructive">
              Motivo: {setDetail.existingReport.rejectionReason}
            </CardContent>
          )}
          {isParticipant && !isEditingRejected && (
            <CardContent>
              <Button className="w-full" onClick={resetForRejectedEdit}>
                Editar reporte
              </Button>
            </CardContent>
          )}
        </Card>
      )}

      {canPlayerWorkflow ? (
        <>
          {!rpsWinner && !isEditingRejectedFlow && (
            <Card>
              <CardHeader>
                <CardTitle>Comenzar set</CardTitle>
                <CardDescription>Usa RPS local en este dispositivo para decidir quién banea primero.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!rpsMode && (
                  <Button onClick={() => setRpsMode('local')} className="w-full gap-2">
                    <Users className="h-4 w-4" />
                    Iniciar Piedra, Papel o Tijeras
                  </Button>
                )}
                {rpsMode === 'local' && (
                  <LocalRps
                    p1Name={setDetail.p1.name}
                    p2Name={setDetail.p2.name}
                    onComplete={handleRpsComplete}
                  />
                )}
              </CardContent>
            </Card>
          )}

          <Accordion type="multiple" value={openSections} onValueChange={setOpenSections} className="space-y-3">
            {games.map((game, idx) => {
              const bans = bansByGame[game.index] || [];
              const flow = getStageFlow(game);
              const isCurrent = game.index === currentGame.index;
              const showRepeat = isCurrent && !!game.stage;
              // Permitir gentleman si es el game actual, hay rpsWinner, y NO hay bans activos (se reseteó) o no hay stage
              const canGentleman = isCurrent && !!rpsWinner && (bans.length === 0 || !game.stage) && !isEditingRejectedFlow;
              const gConfirm = gentlemanConfirm[game.index] || { p1: false, p2: false };
              const isGentlemanReady = gConfirm.p1 && gConfirm.p2;

              return (
                <React.Fragment key={game.index}>
                  {!isEditingRejectedFlow && (
                    <AccordionItem value={`bans-${game.index}`} className="border rounded-lg px-4">
                      <AccordionTrigger className="text-lg font-semibold">
                        <div className="flex items-center gap-2">
                          <span>Bans Game {game.index}</span>
                          {flow.banner && (
                            <span className="text-xs text-muted-foreground">Turno: {flow.banner === 'p1' ? setDetail.p1.name : setDetail.p2.name}</span>
                          )}
                          {flow.mode === 'ban' && <span className="text-xs text-muted-foreground">({flow.bansRemaining} bans restantes)</span>}
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-3 pt-1">
                          <div className="flex flex-col sm:flex-row gap-2">
                            <Button
                              variant="outline"
                              className="w-full sm:w-auto"
                              disabled={!canGentleman}
                              onClick={() => openGentleman(game.index)}
                            >
                              ¿Gentleman?
                            </Button>
                            <Button
                              variant="outline"
                              className="w-full sm:w-auto"
                              disabled={bans.length === 0 && !game.stage}
                              onClick={() => resetBansForGame(game.index)}
                            >
                              Reestablecer bans
                            </Button>
                          </div>

                          <StageSelector
                            bannedStages={bans}
                            pickedStage={game.stage}
                            mode={flow.mode}
                            bansRemaining={flow.bansRemaining}
                            busy={banInProgress && isCurrent}
                            onBan={handleBan(game.index)}
                            onPick={flow.mode === 'pick' && isCurrent ? handlePick : (_stage) => { }}
                            currentBanner={flow.banner}
                            p1Name={setDetail.p1.name}
                            p2Name={setDetail.p2.name}
                          />

                          {showRepeat && (
                            <Button variant="outline" className="w-full" onClick={handleRepeatBans}>
                              Repetir bans de este game
                            </Button>
                          )}

                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  <AccordionItem value={`game-${game.index}`} className="border rounded-lg px-4">
                    <AccordionTrigger className="text-lg font-semibold">
                      <div className="flex items-center gap-2">
                        <span>Game {game.index}</span>
                        {game.stage && <span className="text-xs text-muted-foreground">{game.stage}</span>}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="pt-1">
                        <GameRow
                          game={game}
                          p1Name={setDetail.p1.name}
                          p2Name={setDetail.p2.name}
                          onChange={handleGameChange}
                          readonly={false}
                          lockStage={!isEditingRejectedFlow && isCurrent && !!rpsWinner && (flow.mode === 'ban' || flow.mode === 'pick')}
                        />
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* Gentleman modal per game */}
                  <AlertDialog open={gentlemanGameIndex === game.index} onOpenChange={(open) => !open && closeGentleman()}>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>¿Gentleman? (Game {game.index})</AlertDialogTitle>
                      </AlertDialogHeader>

                      <div className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <Button
                            variant={gConfirm.p1 ? 'default' : 'outline'}
                            onClick={() =>
                              setGentlemanConfirm((prev) => ({
                                ...prev,
                                [game.index]: { ...(prev[game.index] || { p1: false, p2: false }), p1: true },
                              }))
                            }
                          >
                            Confirmar {setDetail.p1.name}
                          </Button>
                          <Button
                            variant={gConfirm.p2 ? 'default' : 'outline'}
                            onClick={() =>
                              setGentlemanConfirm((prev) => ({
                                ...prev,
                                [game.index]: { ...(prev[game.index] || { p1: false, p2: false }), p2: true },
                              }))
                            }
                          >
                            Confirmar {setDetail.p2.name}
                          </Button>
                        </div>

                        {!isGentlemanReady ? (
                          <p className="text-sm text-muted-foreground">
                            Deben confirmar ambos jugadores para elegir escenario sin bans.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-sm font-medium">Elige escenario (sin bans)</p>
                            <StageSelector
                              bannedStages={[]}
                              pickedStage={game.stage}
                              mode="pick"
                              bansRemaining={0}
                              busy={false}
                              onBan={() => {}}
                              onPick={(stage) => setGentlemanStage(game.index, stage)}
                              currentBanner={undefined}
                              p1Name={setDetail.p1.name}
                              p2Name={setDetail.p2.name}
                            />
                          </div>
                        )}
                      </div>

                      <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                        <AlertDialogCancel
                          onClick={() => {
                            // reset confirmations
                            setGentlemanConfirm((prev) => ({ ...prev, [game.index]: { p1: false, p2: false } }));
                            closeGentleman();
                          }}
                        >
                          Cancelar
                        </AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => {
                            // no-op: stage selection is done inside StageSelector
                            closeGentleman();
                          }}
                        >
                          Cerrar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </React.Fragment>
              );
            })}
          </Accordion>

          <Button
            onClick={handleSubmit}
            disabled={!canSubmit() || submitMutation.isPending}
            className="w-full bg-gradient-primary py-6 text-lg"
            size="lg"
          >
            {submitMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                <Send className="mr-2 h-5 w-5" />
                Enviar Reporte para Revisión
              </>
            )}
          </Button>
        </>
      ) : (
        <>
          {!canViewSet ? (
            <div className="text-center py-6">
              <p className="text-muted-foreground">No tienes permisos para ver este set.</p>
            </div>
          ) : (
            <>
              {setDetail.status === 'not_started' && (
                <Card>
                  <CardHeader>
                    <CardTitle>Set sin iniciar</CardTitle>
                    <CardDescription>
                      Este set aún no ha sido marcado como iniciado. El admin puede iniciarlo desde la lista del evento.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button className="w-full" variant="outline" onClick={() => navigate(`/events/${setDetail.eventId}`)}>
                      Volver al evento
                    </Button>
                  </CardContent>
                </Card>
              )}

              {setDetail.status !== 'not_started' && (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {setDetail.status === 'in_progress' ? 'Vista de solo lectura' : 'Resultados'}
                    </CardTitle>
                    <CardDescription>
                      {isParticipant
                        ? 'Para reportar, entra al modo Progreso desde la lista del evento.'
                        : 'Aquí puedes ver el estado y los games del set.'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {readonlyGames.length > 0 ? (
                      <div className="space-y-3">
                        {readonlyGames.map((game) => (
                          <GameRow
                            key={game.index}
                            game={game}
                            p1Name={setDetail.p1.name}
                            p2Name={setDetail.p2.name}
                            onChange={() => { }}
                            readonly={true}
                            lockStage={false}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No hay games disponibles para mostrar.</p>
                    )}

                    <Button className="w-full" variant="outline" onClick={() => navigate(`/events/${setDetail.eventId}`)}>
                      Volver al evento
                    </Button>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
    </AppLayout>
  );
}
