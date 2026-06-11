import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layouts/AppLayout';
import { ScoreHeader } from '@/components/set/ScoreHeader';
import { SetFlowStepper } from '@/components/set/SetFlowStepper';
import { GameSummaryCard } from '@/components/set/GameSummaryCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { competitorApi } from '@/lib/api';
import { calculateScore, type GameRecord, type SetSpectateResponse } from '@/types';
import { ArrowLeft, Wifi, RefreshCw } from 'lucide-react';

const PHASE_LABELS: Record<string, string> = {
  waiting: 'Esperando que comiencen el reporte',
  rps: 'RPS en curso',
  bans: 'Bans de escenarios',
  games: 'Games en curso',
  submit: 'Set decidido — pendiente de envío',
};

function getDisplayGames(data: SetSpectateResponse): GameRecord[] {
  const draftGames = data.draft?.games;
  if (draftGames && draftGames.length > 0) {
    return draftGames;
  }
  return [{ index: 1, stage: null, winner: null, stocksP1: null, stocksP2: null }];
}

export default function SpectateSetPage() {
  const { setId } = useParams<{ setId: string }>();
  const navigate = useNavigate();

  const { data, isLoading, isError, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['setSpectate', setId],
    queryFn: () => competitorApi.getSetSpectate(setId!),
    enabled: !!setId,
    refetchInterval: 8000,
    refetchIntervalInBackground: false,
    retry: (failureCount, err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) return false;
      return failureCount < 2;
    },
  });

  const axiosError = error as { response?: { status?: number; data?: SetSpectateResponse } } | undefined;
  const unavailable = axiosError?.response?.status === 409 ? axiosError.response.data : null;
  const spectate = data ?? (unavailable?.available === false ? unavailable : null);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="space-y-4 max-w-lg mx-auto">
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  if (isError && !spectate) {
    return (
      <AppLayout>
        <div className="gaming-card p-8 text-center max-w-lg mx-auto space-y-4">
          <p className="text-muted-foreground text-sm">No se pudo cargar la vista en vivo.</p>
          <Button variant="outline" onClick={() => refetch()}>
            Reintentar
          </Button>
        </div>
      </AppLayout>
    );
  }

  if (!spectate?.setDetail) {
    return null;
  }

  const { setDetail } = spectate;
  const isLive = spectate.available !== false && setDetail.status === 'in_progress';
  const displayGames = getDisplayGames(spectate as SetSpectateResponse);
  const score = spectate.score ?? calculateScore(displayGames);
  const phase = spectate.phase ?? 'waiting';
  const stepperPhase = phase === 'waiting' ? 'rps' : phase;

  const completedIndices = displayGames
    .filter((g) => g.stage && g.winner && g.characterP1 && g.characterP2)
    .map((g) => g.index);
  const currentGame = displayGames[displayGames.length - 1];

  const backToEvent = () => {
    if (setDetail.eventId) {
      navigate(`/events/${setDetail.eventId}`);
    } else {
      navigate(-1);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-4 max-w-lg mx-auto pb-8">
        {/* Nav */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" onClick={backToEvent} className="shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="text-center min-w-0 flex-1 px-2">
            <p className="text-xs text-muted-foreground truncate">{setDetail.eventName}</p>
            <p className="text-sm font-semibold truncate">{setDetail.round}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => refetch()} className="shrink-0">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {!isLive ? (
          <div className="gaming-card p-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              {spectate.reason === 'not_started'
                ? 'Este set aún no ha comenzado.'
                : 'Este set ya ha finalizado.'}
            </p>
            <Button variant="outline" onClick={backToEvent}>
              Volver al evento
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-center gap-2">
              <Badge variant="outline" className="animate-pulse border-green-500 text-green-600 gap-1">
                <Wifi className="w-3 h-3" />
                En vivo
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                Actualizado {new Date(dataUpdatedAt).toLocaleTimeString()} · cada 8s
              </span>
            </div>

            <ScoreHeader
              p1Name={setDetail.p1.name}
              p2Name={setDetail.p2.name}
              scoreP1={score.p1}
              scoreP2={score.p2}
              bestOf={setDetail.bestOf}
              round={setDetail.round}
            />

            <SetFlowStepper currentPhase={stepperPhase as 'rps' | 'bans' | 'games' | 'submit'} />

            <p className="text-xs text-center text-muted-foreground px-2">
              {PHASE_LABELS[phase] ?? 'En progreso'}
            </p>

            <section className="space-y-3">
              <h3 className="font-display text-sm font-semibold tracking-wider text-muted-foreground uppercase px-1">
                Progreso
              </h3>
              {displayGames.map((game) => (
                <GameSummaryCard
                  key={game.index}
                  game={game}
                  p1Name={setDetail.p1.name}
                  p2Name={setDetail.p2.name}
                  isCurrent={game.index === currentGame?.index && !completedIndices.includes(game.index)}
                  readOnly
                />
              ))}
            </section>
          </>
        )}
      </div>
    </AppLayout>
  );
}
