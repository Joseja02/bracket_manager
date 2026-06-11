import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { adminApi } from '@/lib/api';
import { ArrowLeft, Wifi } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ScoreBoard } from '@/components/set/ScoreBoard';
import type { GameRecord } from '@/types';
import { GameRow } from '@/components/set/GameRow';

export default function AdminLiveSet() {
    const { setId } = useParams<{ setId: string }>();
    const navigate = useNavigate();
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

    const { data: liveData, isLoading, isError } = useQuery({
        queryKey: ['adminLiveSet', setId],
        queryFn: () => adminApi.getSetLiveState(setId!),
        enabled: !!setId,
        refetchInterval: 5000, // Polling every 5 seconds
    });

    useEffect(() => {
        if (liveData) {
            setLastUpdate(new Date());
        }
    }, [liveData]);

    if (isLoading && !liveData) {
        return (
            <AppLayout>
                <div className="space-y-4">
                    <Skeleton className="h-16" />
                    <Skeleton className="h-32" />
                    <Skeleton className="h-48" />
                </div>
            </AppLayout>
        );
    }

    if (isError || !liveData) {
        return (
            <AppLayout>
                <div className="text-center py-10">
                    <p className="text-muted-foreground">Error al cargar el set en vivo.</p>
                    <Button variant="outline" onClick={() => navigate(-1)} className="mt-4">
                        Volver
                    </Button>
                </div>
            </AppLayout>
        );
    }

    const { setDetail, state, draft } = liveData;

    // Determinar juegos a mostrar
    // Prioridad: 1. Borrador (Datos activos del usuario), 2. Reporte/Juegos (Datos oficiales)
    let displayGames: GameRecord[] = [];
    if (draft && draft.games && draft.games.length > 0) {
        displayGames = draft.games;
    } else if (setDetail.games && setDetail.games.length > 0) {
        displayGames = setDetail.games;
    } else {
        displayGames = [{ index: 1, stage: null, winner: null, stocksP1: null, stocksP2: null }];
    }

    // Calcular puntuación manualmente ya que las importaciones pueden ser complicadas con alias en archivos nuevos
    const calculateScore = (games: GameRecord[]) => {
        let p1 = 0;
        let p2 = 0;
        games.forEach((g) => {
            if (g.winner === 'p1') p1++;
            if (g.winner === 'p2') p2++;
        });
        return { p1, p2 };
    };

    const score = calculateScore(displayGames);
    const bestOf = state?.best_of || setDetail.bestOf || 3;

    // Lógica de estado
    const isDraft = !!draft;
    const phase = state?.phase || 'unknown';
    const hasRpsWinner = state?.p1_choice && state?.p2_choice;

    return (
        <AppLayout>
            <div className="space-y-5">
                {/* Header */}
                <div className="flex items-start gap-3">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => (setDetail.eventId ? navigate(`/events/${setDetail.eventId}`) : navigate(-1))}
                        className="shrink-0"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <h1 className="text-xl font-display truncate">Monitor en Vivo</h1>
                            <Badge variant="outline" className="animate-pulse border-green-500 text-green-600 gap-1">
                                <Wifi className="w-3 h-3" />
                                Live
                            </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{setDetail.eventName} - {setDetail.round}</p>
                    </div>
                    <div className="text-xs text-muted-foreground text-right">
                        <p>{lastUpdate ? lastUpdate.toLocaleTimeString() : 'Cargando...'}</p>
                        <p className="text-[10px] opacity-70">Actualiza 5s</p>
                    </div>
                </div>

                {/* Score Board */}
                <ScoreBoard
                    p1Name={setDetail.p1.name}
                    p2Name={setDetail.p2.name}
                    p1Score={score.p1}
                    p2Score={score.p2}
                    bestOf={bestOf}
                />

                {/* State Indicators */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Card>
                        <CardHeader className="p-3 pb-1">
                            <CardTitle className="text-xs font-medium text-muted-foreground">Fase Actual</CardTitle>
                        </CardHeader>
                        <CardContent className="p-3 pt-1">
                            <p className="font-bold capitalize">{phase === 'rps' ? 'RPS (Piedra/Papel/Tijera)' : phase === 'banning' ? 'Bans de Escenarios' : phase === 'picked' ? 'Jugando' : phase}</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="p-3 pb-1">
                            <CardTitle className="text-xs font-medium text-muted-foreground">Origen Datos</CardTitle>
                        </CardHeader>
                        <CardContent className="p-3 pt-1">
                            <Badge variant={isDraft ? "secondary" : "outline"}>
                                {isDraft ? 'Borrador (En progreso)' : 'Confirmado'}
                            </Badge>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="p-3 pb-1">
                            <CardTitle className="text-xs font-medium text-muted-foreground">RPS</CardTitle>
                        </CardHeader>
                        <CardContent className="p-3 pt-1">
                            <p className="font-bold">{hasRpsWinner ? 'Completado' : 'Pendiente'}</p>
                            {hasRpsWinner && <span className="text-xs text-muted-foreground">Ganador decidió bans</span>}
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="p-3 pb-1">
                            <CardTitle className="text-xs font-medium text-muted-foreground">Bans activos</CardTitle>
                        </CardHeader>
                        <CardContent className="p-3 pt-1">
                            <p className="font-bold">{state?.bans?.length || 0}</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Games List */}
                <section className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-display">Progreso de la partida</h2>
                    </div>

                    {displayGames.map((g) => (
                        <div key={g.index} className="opacity-90">
                            <GameRow
                                game={g}
                                p1Name={setDetail.p1.name}
                                p2Name={setDetail.p2.name}
                                onChange={() => { }} // Read only
                                readonly={true}
                                lockStage={true}
                            />
                        </div>
                    ))}
                </section>

            </div>
        </AppLayout>
    );
}
