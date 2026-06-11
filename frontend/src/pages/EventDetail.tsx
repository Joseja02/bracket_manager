import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { competitorApi, adminApi } from '@/lib/api';
import { ArrowLeft, Swords, Eye, Play, RefreshCw, Loader2, RotateCcw } from 'lucide-react';
import type { SetSummary } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { BestOfDialog } from '@/components/set/BestOfDialog';
import { cn } from '@/lib/utils';

export default function EventDetail() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pendingStartSetId, setPendingStartSetId] = useState<SetSummary['id'] | null>(null);
  const [forceBestOf, setForceBestOf] = useState(false);
  const [forcedBestOfValue, setForcedBestOfValue] = useState<3 | 5>(3);
  const [isRefreshingSets, setIsRefreshingSets] = useState(false);

  const { data: event, isLoading: eventLoading } = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => competitorApi.getEvent(eventId!),
    enabled: !!eventId,
  });

  const { data: sets, isLoading: setsLoading } = useQuery<SetSummary[]>({
    queryKey: ['eventSets', eventId],
    queryFn: () => competitorApi.getEventSets(eventId!),
    enabled: !!eventId,
    // Mantener datos previos en pantalla mientras se revalida (evita parpadeos)
    placeholderData: (prev) => prev,
    staleTime: 5_000,
    // Mantener la lista lo más sincronizada posible con start.gg sin spamear
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  const refreshSets = async () => {
    if (!eventId || isRefreshingSets) return;
    setIsRefreshingSets(true);
    try {
      await queryClient.fetchQuery({
        queryKey: ['eventSets', eventId],
        queryFn: () => competitorApi.getEventSets(eventId, { fresh: 1 }),
      });
    } finally {
      setIsRefreshingSets(false);
    }
  };

  // Verificación de admin por evento. El rol global 'admin' no implica ser
  // admin de ESTE torneo, así que se comprueba salvo que ya sea owner con rol
  // promocionado (el endpoint también promociona el rol global si procede).
  const { data: adminCheck } = useQuery({
    queryKey: ['eventAdminCheck', eventId],
    queryFn: () => competitorApi.getEventAdminCheck(eventId!, event?.tournamentSlug),
    enabled: !!eventId && !!event && (!event.isAdmin || user?.role !== 'admin'),
    staleTime: 60_000,
    retry: false,
  });

  const isEventAdmin = !!event?.isAdmin || adminCheck?.isAdmin === true;

  useEffect(() => {
    if (adminCheck?.isAdmin && user?.role !== 'admin') {
      queryClient.invalidateQueries({ queryKey: ['user'] });
    }
  }, [adminCheck?.isAdmin, queryClient, user?.role]);

  useEffect(() => {
    if (event?.isAdmin && eventId) {
      sessionStorage.setItem('admin_event_id', eventId);
    }
  }, [event?.isAdmin, eventId]);

  const startSetMutation = useMutation({
    mutationFn: ({ setId, bestOf }: { setId: string | number; bestOf: 3 | 5 }) =>
      competitorApi.startSet(setId, bestOf),
    onSuccess: () => {
      toast({
        title: 'Set iniciado',
        description: 'El set ha sido marcado como en progreso',
      });
      refreshSets();
      setPendingStartSetId(null);
    },
    onError: (error: unknown) => {
      const axErr = error as { response?: { data?: { message?: string; error?: string } } };
      const message = axErr?.response?.data?.message || axErr?.response?.data?.error || 'No se pudo iniciar el set';
      toast({
        title: 'Error al iniciar set',
        description: message,
        variant: 'destructive',
      });
      setPendingStartSetId(null);
    },
  });

  const resetSetMutation = useMutation({
    mutationFn: (setId: string | number) => adminApi.resetSet(setId),
    onSuccess: (data) => {
      toast({
        title: 'Set reiniciado',
        description: data?.startggReset === false
          ? 'Reiniciado localmente, pero no se pudo reiniciar en start.gg.'
          : 'El set se ha reiniciado también en start.gg. Vuelve a iniciarlo para definir el Best Of.',
        variant: data?.startggReset === false ? 'destructive' : undefined,
      });
      refreshSets();
    },
    onError: (error: unknown) => {
      const axErr = error as { response?: { data?: { message?: string; error?: string } } };
      const message = axErr?.response?.data?.message || axErr?.response?.data?.error || 'No se pudo reiniciar el set';
      toast({
        title: 'Error al reiniciar set',
        description: message,
        variant: 'destructive',
      });
    },
  });

  const changeBestOfMutation = useMutation({
    mutationFn: ({ setId, bestOf }: { setId: string | number; bestOf: 3 | 5 }) =>
      adminApi.setBestOf(setId, bestOf),
    onSuccess: (_data, variables) => {
      toast({
        title: 'Best Of actualizado',
        description: `El set ahora es BO${variables.bestOf}`,
      });
      refreshSets();
    },
    onError: (error: unknown) => {
      const axErr = error as { response?: { data?: { message?: string; error?: string } } };
      const message = axErr?.response?.data?.message || axErr?.response?.data?.error || 'No se pudo cambiar el Best Of';
      toast({
        title: 'Error al cambiar Best Of',
        description: message,
        variant: 'destructive',
      });
    },
  });

  const handleConfirmStart = (bestOf: 3 | 5) => {
    if (!pendingStartSetId) return;
    // Si el toggle está activo, usar el valor forzado
    const finalBestOf = forceBestOf ? forcedBestOfValue : bestOf;
    startSetMutation.mutate({ setId: pendingStartSetId, bestOf: finalBestOf });
  };

  const handleStartSetClick = (setId: SetSummary['id']) => {
    // Si el toggle está activo, iniciar directamente con el valor forzado
    if (forceBestOf) {
      startSetMutation.mutate({ setId, bestOf: forcedBestOfValue });
    } else {
      setPendingStartSetId(setId);
    }
  };

  // Solo mostramos "no encontrado" cuando la consulta del evento ya terminó.
  // No bloqueamos la lista de sets esperando al evento: ambas cargan en paralelo
  // y los sets pueden mostrarse en cuanto estén disponibles.
  if (!eventLoading && !event) {
    return (
      <AppLayout>
        <div className="gaming-card p-8 text-center">
          <Swords className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">Evento no encontrado</p>
        </div>
      </AppLayout>
    );
  }

  type SetStatus = SetSummary['status'];

  const getStatusBadge = (status: SetStatus) => {
    const variants: Record<SetStatus, { label: string; className: string }> = {
      in_progress: { label: 'En Progreso', className: 'bg-primary/20 text-primary border-primary/30' },
      not_started: { label: 'No Iniciado', className: 'bg-muted text-muted-foreground' },
      completed: { label: 'Completado', className: 'bg-success/20 text-success border-success/30' },
      reported: { label: 'Reportado', className: 'bg-amber/20 text-amber border-amber/30' },
      approved: { label: 'Aprobado', className: 'bg-success/20 text-success border-success/30' },
      rejected: { label: 'Rechazado', className: 'bg-destructive/20 text-destructive border-destructive/30' },
    };
    return variants[status];
  };

  const isUserSet = (set: SetSummary) => {
    if (!user?.startgg_user_id) return false;
    const userIdStr = String(user.startgg_user_id);
    return String(set.p1.userId) === userIdStr || String(set.p2.userId) === userIdStr;
  };

  return (
    <AppLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')} className="shrink-0 mt-0.5">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="min-w-0 flex-1">
            {event ? (
              <>
                <p className="text-xs text-muted-foreground truncate">{event.tournamentName}</p>
                <h1 className="font-display text-xl font-bold tracking-wider truncate">{event.name}</h1>
              </>
            ) : (
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-6 w-44" />
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={refreshSets}
            disabled={isRefreshingSets}
            className="shrink-0"
            aria-label="Actualizar sets"
          >
            <RefreshCw className={cn('w-4 h-4', isRefreshingSets && 'animate-spin')} />
          </Button>
        </div>

        {/* Sets Section */}
        <section className="space-y-3">
          <h2 className="font-display text-sm font-semibold tracking-wider text-muted-foreground uppercase">
            Sets
          </h2>

          {/* Force Best Of toggle (admin only) */}
          {isEventAdmin && (
            <div className="gaming-card p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Switch id="force-bestof" checked={forceBestOf} onCheckedChange={setForceBestOf} />
                  <Label htmlFor="force-bestof" className="text-sm font-medium cursor-pointer">
                    Forzar Bo:
                  </Label>
                </div>
                <Select
                  value={String(forcedBestOfValue)}
                  onValueChange={(value) => setForcedBestOfValue(value === '5' ? 5 : 3)}
                  disabled={!forceBestOf}
                >
                  <SelectTrigger className="w-[90px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">BO3</SelectItem>
                    <SelectItem value="5">BO5</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {setsLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
            </div>
          ) : !sets || sets.length === 0 ? (
            <div className="gaming-card p-8 text-center">
              <Swords className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No hay sets disponibles</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sets.map((set) => {
                const status = set.status;
                const canEditRejected = set.reportStatus === 'rejected' && set.status !== 'not_started';
                const statusInfo = getStatusBadge(status);
                const userOwnsSet = isUserSet(set);

                return (
                  <div key={set.id} className="gaming-card p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{set.round}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {set.p1.name} vs {set.p2.name}
                        </p>
                      </div>
                      <Badge className={cn('shrink-0 text-[10px]', statusInfo.className)}>
                        {statusInfo.label}
                      </Badge>
                    </div>

                    {!(isEventAdmin && set.status === 'in_progress' && !canEditRejected) && (
                      <div className="text-xs text-muted-foreground">Bo{set.bestOf}</div>
                    )}

                    {isEventAdmin ? (
                      <div className="space-y-2">
                        {set.status === 'not_started' && (
                          <button
                            onClick={() => handleStartSetClick(set.id)}
                            disabled={startSetMutation.isPending}
                            className="w-full py-2.5 px-4 rounded-lg bg-gradient-primary text-white text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] disabled:opacity-50 transition-all"
                          >
                            {startSetMutation.isPending && pendingStartSetId === set.id ? (
                              <><Loader2 className="w-4 h-4 animate-spin" /> Iniciando...</>
                            ) : (
                              <><Play className="w-4 h-4" /> Iniciar Set</>
                            )}
                          </button>
                        )}
                        {set.status === 'in_progress' && !canEditRejected && (
                          <div className="space-y-2">
                            {/* Acción principal: reportar si el admin juega este set, si no, monitorizar */}
                            {userOwnsSet ? (
                              <button
                                onClick={() => navigate(`/sets/${set.id}?mode=player`)}
                                className="w-full py-2.5 px-4 rounded-lg bg-gradient-primary text-white text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition-all"
                              >
                                <Swords className="w-4 h-4" /> Reportar Set
                              </button>
                            ) : (
                              <div className="space-y-2">
                                <button
                                  onClick={() => navigate(`/sets/${set.id}/spectate`)}
                                  className="w-full py-2.5 px-4 rounded-lg border border-border text-sm font-medium flex items-center justify-center gap-2 hover:border-primary/50 transition-all active:scale-[0.98]"
                                >
                                  <Eye className="w-4 h-4" /> Ver en vivo
                                </button>
                                <button
                                  onClick={() => navigate(`/admin/sets/${set.id}/live`)}
                                  className="w-full py-2 px-4 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-all active:scale-[0.98]"
                                >
                                  Monitor TO
                                </button>
                              </div>
                            )}
                            {/* Controles secundarios: cambiar Best Of y reiniciar */}
                            <div className="flex items-center gap-2">
                              <Select
                                value={String(set.bestOf)}
                                onValueChange={(value) =>
                                  changeBestOfMutation.mutate({ setId: set.id, bestOf: value === '5' ? 5 : 3 })
                                }
                                disabled={changeBestOfMutation.isPending}
                              >
                                <SelectTrigger className="flex-1 h-10">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="3">BO3</SelectItem>
                                  <SelectItem value="5">BO5</SelectItem>
                                </SelectContent>
                              </Select>
                              <button
                                onClick={() => {
                                  if (
                                    confirm(
                                      '¿Reiniciar este set por completo? Se reiniciará también en start.gg y se borrarán los reportes y borradores.',
                                    )
                                  ) {
                                    resetSetMutation.mutate(set.id);
                                  }
                                }}
                                disabled={resetSetMutation.isPending}
                                className="py-2.5 px-3 h-10 rounded-lg border border-destructive/30 text-destructive text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-destructive/10 transition-all active:scale-[0.98] disabled:opacity-50"
                                aria-label="Reiniciar set"
                              >
                                {resetSetMutation.isPending ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <RotateCcw className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                        {canEditRejected && userOwnsSet && (
                          <button
                            onClick={() => navigate(`/sets/${set.id}?mode=player&edit=1`)}
                            className="w-full py-2.5 px-4 rounded-lg bg-amber/20 text-amber text-sm font-medium flex items-center justify-center gap-2 hover:bg-amber/30 transition-all active:scale-[0.98]"
                          >
                            Editar Reporte
                          </button>
                        )}
                        {(set.status === 'completed' || set.status === 'reported' || set.status === 'approved') && (
                          <button
                            onClick={() => navigate(`/sets/${set.id}`)}
                            className="w-full py-2.5 px-4 rounded-lg border border-border text-sm font-medium flex items-center justify-center gap-2 hover:border-primary/50 transition-all active:scale-[0.98]"
                          >
                            <Eye className="w-4 h-4" /> Ver Resultados
                          </button>
                        )}
                      </div>
                    ) : userOwnsSet && (set.status === 'in_progress' || canEditRejected) ? (
                      <button
                        onClick={() =>
                          navigate(`/sets/${set.id}?mode=player${canEditRejected ? '&edit=1' : ''}`)
                        }
                        className="w-full py-2.5 px-4 rounded-lg bg-gradient-primary text-white text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition-all"
                      >
                        {canEditRejected ? 'Editar Reporte' : 'Reportar Set'}
                      </button>
                    ) : set.status === 'in_progress' ? (
                      <button
                        onClick={() => navigate(`/sets/${set.id}/spectate`)}
                        className="w-full py-2.5 px-4 rounded-lg border border-border text-sm font-medium flex items-center justify-center gap-2 hover:border-primary/50 transition-all active:scale-[0.98]"
                      >
                        <Eye className="w-4 h-4" /> Ver en vivo
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
      <BestOfDialog
        open={pendingStartSetId !== null && !forceBestOf}
        onClose={() => setPendingStartSetId(null)}
        onConfirm={handleConfirmStart}
        isSubmitting={startSetMutation.isPending}
      />
    </AppLayout>
  );
}
