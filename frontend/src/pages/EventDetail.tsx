import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
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
import { ScopeErrorModal } from '@/components/set/ScopeErrorModal';
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
  const [selectedPoolKey, setSelectedPoolKey] = useState('');
  const [scopeErrorOpen, setScopeErrorOpen] = useState(false);
  const [scopeErrorMessage, setScopeErrorMessage] = useState('');

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
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const refreshSets = async () => {
    if (!eventId || isRefreshingSets) return;
    setIsRefreshingSets(true);
    try {
      await queryClient.refetchQueries({ queryKey: ['eventSets', eventId] });
    } finally {
      setIsRefreshingSets(false);
    }
  };

  // Verificación de admin por evento. event.isAdmin solo refleja owner;
  // los colaboradores se confirman siempre vía admin-check.
  const { data: adminCheck } = useQuery({
    queryKey: ['eventAdminCheck', eventId],
    queryFn: () => competitorApi.getEventAdminCheck(eventId!),
    enabled: !!eventId && !!event && !event.isAdmin,
    staleTime: 60_000,
    retry: false,
  });

  const isEventAdmin = !!event?.isAdmin || adminCheck?.isAdmin === true;

  useEffect(() => {
    if (adminCheck?.isAdmin && user?.role !== 'admin') {
      queryClient.invalidateQueries({ queryKey: ['user'] });
    }
  }, [adminCheck?.isAdmin, queryClient, user?.role]);

  const startSetMutation = useMutation({
    mutationFn: ({ setId, bestOf }: { setId: string | number; bestOf: 3 | 5 }) =>
      competitorApi.startSet(setId, bestOf, eventId),
    onSuccess: (_data, variables) => {
      toast({
        title: 'Set iniciado',
        description: 'El set ha sido marcado como en progreso',
      });
      queryClient.setQueryData(['eventSets', eventId], (old: SetSummary[] | undefined) =>
        old?.map((set) =>
          String(set.id) === String(variables.setId)
            ? { ...set, status: 'in_progress' as const, bestOf: variables.bestOf }
            : set,
        ),
      );
      void queryClient.invalidateQueries({ queryKey: ['eventSets', eventId] });
      setPendingStartSetId(null);
    },
    onError: (error: unknown) => {
      const axErr = error as {
        response?: {
          status?: number;
          data?: { message?: string; error?: string; action?: string };
        };
      };
      const status = axErr?.response?.status;
      const data = axErr?.response?.data;
      const message = data?.message || data?.error || 'No se pudo iniciar el set';

      if (status === 403 || data?.action === 'reauthenticate') {
        setScopeErrorMessage(message);
        setScopeErrorOpen(true);
      } else {
        toast({
          title: 'Error al iniciar set',
          description: message,
          variant: 'destructive',
        });
      }
      setPendingStartSetId(null);
    },
  });

  const resetSetMutation = useMutation({
    mutationFn: (setId: string | number) => adminApi.resetSet(setId, eventId),
    onSuccess: (data, setId) => {
      toast({
        title: 'Set reiniciado',
        description: data?.startggReset === false
          ? 'Reiniciado localmente, pero no se pudo reiniciar en start.gg.'
          : 'El set se ha reiniciado también en start.gg. Vuelve a iniciarlo para definir el Best Of.',
        variant: data?.startggReset === false ? 'destructive' : undefined,
      });
      queryClient.setQueryData(['eventSets', eventId], (old: SetSummary[] | undefined) =>
        old?.map((set) =>
          String(set.id) === String(setId) ? { ...set, status: 'not_started' as const } : set,
        ),
      );
      void queryClient.invalidateQueries({ queryKey: ['eventSets', eventId] });
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
      queryClient.setQueryData(['eventSets', eventId], (old: SetSummary[] | undefined) =>
        old?.map((set) =>
          String(set.id) === String(variables.setId) ? { ...set, bestOf: variables.bestOf } : set,
        ),
      );
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
    if (!pendingStartSetId || startSetMutation.isPending) return;
    const finalBestOf = forceBestOf ? forcedBestOfValue : bestOf;
    startSetMutation.mutate({ setId: pendingStartSetId, bestOf: finalBestOf });
  };

  const handleStartSetClick = (setId: SetSummary['id']) => {
    if (startSetMutation.isPending) return;
    if (forceBestOf) {
      startSetMutation.mutate({ setId, bestOf: forcedBestOfValue });
    } else {
      setPendingStartSetId(setId);
    }
  };

  // Agrupar por pool solo si start.gg tiene varias pools creadas. Si no hay pools
  // (o solo una), se muestra la lista plana tal y como estaba.
  const poolGroups = useMemo(() => {
    if (!sets) return [];
    const distinctPools = new Set(sets.filter((s) => s.poolId).map((s) => String(s.poolId)));
    if (distinctPools.size <= 1) return [];

    const map = new Map<string, { key: string; label: string; sets: SetSummary[] }>();
    for (const s of sets) {
      const key = s.poolId ? String(s.poolId) : '__nopool__';
      if (!map.has(key)) {
        map.set(key, { key, label: s.poolLabel ?? (s.poolId ? `Pool ${s.poolIdentifier ?? ''}` : 'Otros'), sets: [] });
      }
      map.get(key)!.sets.push(s);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }),
    );
  }, [sets]);

  const hasMultiplePools = poolGroups.length > 1;

  // Mantener una pool válida seleccionada cuando cambian los datos
  useEffect(() => {
    if (!hasMultiplePools) return;
    const stillValid = poolGroups.some((g) => g.key === selectedPoolKey);
    if (!selectedPoolKey || !stillValid) {
      setSelectedPoolKey(poolGroups[0]?.key ?? '');
    }
  }, [hasMultiplePools, poolGroups, selectedPoolKey]);

  const visibleSets = useMemo(() => {
    if (!sets) return [];
    if (!hasMultiplePools) return sets;
    return poolGroups.find((g) => g.key === selectedPoolKey)?.sets ?? [];
  }, [sets, hasMultiplePools, poolGroups, selectedPoolKey]);

  // Contador global de sets en progreso (todas las pools/fases), solo relevante para admins
  const inProgressCount = useMemo(
    () => sets?.filter((s) => s.status === 'in_progress').length ?? 0,
    [sets],
  );

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
    const entrantId = event?.userEntrantId;
    if (entrantId) {
      return String(set.p1.entrantId) === String(entrantId) || String(set.p2.entrantId) === String(entrantId);
    }
    if (!user?.startgg_user_id) return false;
    const userIdStr = String(user.startgg_user_id);
    return String(set.p1.userId) === userIdStr || String(set.p2.userId) === userIdStr;
  };

  const renderSetCard = (set: SetSummary) => {
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
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-sm font-semibold tracking-wider text-muted-foreground uppercase">
              Sets
            </h2>
            {isEventAdmin && !setsLoading && sets && (
              <div
                className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1 shrink-0"
                title="Sets en progreso en todo el evento (todas las pools)"
                aria-label={`${inProgressCount} sets en progreso en todo el evento`}
              >
                <Play className="w-3.5 h-3.5 text-primary" />
                <span className="font-display text-lg font-bold text-primary tabular-nums leading-none">
                  {inProgressCount}
                </span>
              </div>
            )}
          </div>

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

          {hasMultiplePools && (
            <div className="gaming-card p-4 space-y-2">
              <Label htmlFor="pool-select" className="text-sm font-medium">
                Pool
              </Label>
              <Select value={selectedPoolKey} onValueChange={setSelectedPoolKey}>
                <SelectTrigger id="pool-select" className="w-full">
                  <SelectValue placeholder="Selecciona una pool" />
                </SelectTrigger>
                <SelectContent>
                  {poolGroups.map((group) => (
                    <SelectItem key={group.key} value={group.key}>
                      {group.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
          ) : visibleSets.length === 0 ? (
            <div className="gaming-card p-8 text-center">
              <Swords className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No hay sets en esta pool</p>
            </div>
          ) : (
            <div className="space-y-3">{visibleSets.map((set) => renderSetCard(set))}</div>
          )}
        </section>
      </div>
      <BestOfDialog
        open={pendingStartSetId !== null && !forceBestOf}
        onClose={() => setPendingStartSetId(null)}
        onConfirm={handleConfirmStart}
        isSubmitting={startSetMutation.isPending}
      />
      <ScopeErrorModal
        open={scopeErrorOpen}
        onClose={() => setScopeErrorOpen(false)}
        message={scopeErrorMessage}
      />
    </AppLayout>
  );
}
