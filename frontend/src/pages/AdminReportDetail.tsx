import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScoreBoard } from '@/components/set/ScoreBoard';
import { GameRow } from '@/components/set/GameRow';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { adminApi } from '@/lib/api';
import { ArrowLeft, Check, X, Pencil } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { GameRecord } from '@/types';
import { slugToLabel, resolveCharacterSlug } from '@/lib/characters';

const assetBase = import.meta.env.BASE_URL;

export default function AdminReportDetail() {
  const { reportId } = useParams<{ reportId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [rejectionReason, setRejectionReason] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [notes, setNotes] = useState('');
  const [games, setGames] = useState<GameRecord[]>([]);

  const { data: report, isLoading } = useQuery({
    queryKey: ['reportDetail', reportId],
    queryFn: () => adminApi.getReportDetail(reportId!),
    enabled: !!reportId,
  });

  useEffect(() => {
    if (!report) return;
    setNotes(report.notes || '');
    setGames(report.games.map((g) => ({
      index: g.index,
      stage: g.stage,
      winner: g.winner,
      stocksP1: g.stocksP1 ?? null,
      stocksP2: g.stocksP2 ?? null,
      characterP1: g.characterP1 || '',
      characterP2: g.characterP2 || '',
    })));
  }, [report]);

  const canSaveEdits = useMemo(() => {
    if (!games.length) return false;
    return games.every((g) => !!g.stage && !!g.winner && !!g.characterP1 && !!g.characterP2);
  }, [games]);

  const updateMutation = useMutation({
    mutationFn: () => adminApi.updateReport(reportId!, { games, notes: notes || undefined }),
    onSuccess: () => {
      toast({ title: 'Cambios guardados', description: 'El reporte volvió a estado pendiente.' });
      queryClient.invalidateQueries({ queryKey: ['reportDetail', reportId] });
      queryClient.invalidateQueries({ queryKey: ['adminReports'] });
      setIsEditing(false);
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'No se pudo guardar el reporte',
        variant: 'destructive',
      });
    },
  });

  const approveMutation = useMutation({
    mutationFn: () => adminApi.approveReport(reportId!),
    onSuccess: () => {
      toast({
        title: 'Reporte aprobado',
        description: 'Gracias maja',
      });
      queryClient.invalidateQueries({ queryKey: ['adminReports'] });
      setTimeout(() => navigate('/admin/reports'), 1000);
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'No se pudo aprobar el reporte',
        variant: 'destructive',
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (reason: string) => adminApi.rejectReport(reportId!, reason),
    onSuccess: () => {
      toast({
        title: 'Reporte rechazado',
        description: 'El competidor será notificado',
      });
      queryClient.invalidateQueries({ queryKey: ['adminReports'] });
      setTimeout(() => navigate('/admin/reports'), 1000);
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'No se pudo rechazar el reporte',
        variant: 'destructive',
      });
    },
  });

  if (isLoading) {
    return (
      <AppLayout>
        <div className="space-y-4">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  if (!report) {
    return (
      <AppLayout>
        <div className="gaming-card text-center py-10 animate-fade-in">
          <p className="text-muted-foreground mb-4">Reporte no encontrado</p>
          <Button
            variant="outline"
            onClick={() => navigate('/admin/reports')}
            className="border-border/50"
          >
            Volver
          </Button>
        </div>
      </AppLayout>
    );
  }

  const handleApprove = () => {
    approveMutation.mutate();
  };

  const handleReject = () => {
    if (!rejectionReason.trim()) {
      toast({
        variant: 'destructive',
        title: 'Motivo requerido',
        description: 'Debes indicar un motivo para rechazar',
      });
      return;
    }
    rejectMutation.mutate(rejectionReason);
  };

  const isPending = report.status === 'pending';
  const isEditable = report.status === 'pending' || report.status === 'rejected';

  return (
    <AppLayout>
      <div className="space-y-5 animate-slide-up">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/admin/reports')}
            className="shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-display uppercase tracking-wider truncate">{report.round}</h1>
            <p className="text-sm text-muted-foreground truncate">{report.eventName}</p>
          </div>
          <Badge
            className={cn(
              'shrink-0 border',
              report.status === 'rejected' && 'bg-destructive/20 text-destructive border-destructive/30',
              report.status === 'approved' && 'bg-green-500/20 text-green-400 border-green-500/30',
              report.status === 'pending' && 'bg-amber/20 text-amber border-amber/30'
            )}
          >
            {report.status === 'approved' ? 'Aprobado' : report.status === 'rejected' ? 'Rechazado' : 'Pendiente'}
          </Badge>
        </div>

        {/* Score Board */}
        <ScoreBoard
          p1Name={report.p1.name}
          p2Name={report.p2.name}
          p1Score={report.scoreP1}
          p2Score={report.scoreP2}
          bestOf={report.games.length}
        />

        {/* Set Info */}
        <div className="gaming-card p-4 space-y-3">
          <h3 className="text-sm font-display uppercase tracking-wider text-muted-foreground">Información</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Jugadores</span>
              <span className="font-medium truncate ml-2">{report.p1.name} vs {report.p2.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Enviado por</span>
              <span className="font-medium">{report.submittedBy}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fecha</span>
              <span className="font-medium">
                {new Date(report.createdAt).toLocaleDateString('es-ES', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          </div>
        </div>

        {/* Games */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-display uppercase tracking-wider">Games</h2>
            {isEditable && (
              <Button variant="outline" size="sm" onClick={() => setIsEditing((v) => !v)} className="gap-1.5 border-border/50">
                <Pencil className="w-3.5 h-3.5" />
                {isEditing ? 'Cancelar' : 'Editar'}
              </Button>
            )}
          </div>

          {isEditing ? (
            <div className="space-y-3">
              <div className="gaming-card p-4 space-y-2">
                <p className="text-sm font-display uppercase tracking-wider text-muted-foreground">Notas</p>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas..." className="bg-gradient-surface border-border/30" />
              </div>

              {games.map((g) => (
                <GameRow
                  key={g.index}
                  game={g}
                  p1Name={report.p1.name}
                  p2Name={report.p2.name}
                  onChange={(updated) => setGames((prev) => prev.map((x) => (x.index === updated.index ? updated : x)))}
                  readonly={false}
                  lockStage={false}
                />
              ))}

              <Button
                onClick={() => updateMutation.mutate()}
                disabled={!canSaveEdits || updateMutation.isPending}
                className="w-full bg-gradient-primary"
              >
                {updateMutation.isPending ? 'Guardando...' : 'Guardar cambios'}
              </Button>
            </div>
          ) : (
            report.games.map((game) => (
              <div key={game.index} className="gaming-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-display text-sm uppercase tracking-wider">Game {game.index}</span>
                  <Badge variant="outline" className="border-border/30 text-xs">{game.stage}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className={cn(
                    'p-3 rounded-lg text-center border space-y-1.5',
                    game.winner === 'p1' ? 'bg-primary/10 border-primary/30' : 'bg-gradient-surface border-border/20'
                  )}>
                    <p className="text-xs text-muted-foreground">{report.p1.name}</p>
                    {game.characterP1 ? (
                      <div className="flex flex-col items-center gap-1">
                        <img
                          src={`${assetBase}stock_icons/${resolveCharacterSlug(game.characterP1)}.png`}
                          alt={slugToLabel(game.characterP1)}
                          className="h-10 w-10 object-contain"
                        />
                        <p className="font-semibold text-xs leading-tight">{slugToLabel(game.characterP1)}</p>
                      </div>
                    ) : (
                      <p className="font-semibold">-</p>
                    )}
                    <p className="text-xs text-muted-foreground">{game.stocksP1 ?? '?'} stocks</p>
                  </div>
                  <div className={cn(
                    'p-3 rounded-lg text-center border space-y-1.5',
                    game.winner === 'p2' ? 'bg-secondary/10 border-secondary/30' : 'bg-gradient-surface border-border/20'
                  )}>
                    <p className="text-xs text-muted-foreground">{report.p2.name}</p>
                    {game.characterP2 ? (
                      <div className="flex flex-col items-center gap-1">
                        <img
                          src={`${assetBase}stock_icons/${resolveCharacterSlug(game.characterP2)}.png`}
                          alt={slugToLabel(game.characterP2)}
                          className="h-10 w-10 object-contain"
                        />
                        <p className="font-semibold text-xs leading-tight">{slugToLabel(game.characterP2)}</p>
                      </div>
                    ) : (
                      <p className="font-semibold">-</p>
                    )}
                    <p className="text-xs text-muted-foreground">{game.stocksP2 ?? '?'} stocks</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </section>

        {/* Actions */}
        {isPending && (
          <div className="space-y-3 pt-2">
            <Button
              onClick={handleApprove}
              disabled={approveMutation.isPending}
              size="lg"
              className="w-full bg-green-600 hover:bg-green-700 text-white shadow-[0_0_15px_rgba(34,197,94,0.2)]"
            >
              <Check className="w-5 h-5 mr-2" />
              {approveMutation.isPending ? 'Aprobando...' : 'Aprobar Reporte'}
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="lg" className="w-full">
                  <X className="w-5 h-5 mr-2" />
                  Rechazar Reporte
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="gaming-card border-border/30 max-w-sm mx-4">
                <AlertDialogHeader>
                  <AlertDialogTitle className="font-display uppercase tracking-wider">¿Rechazar reporte?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Indica el motivo del rechazo. El competidor será notificado.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Textarea
                  placeholder="Motivo del rechazo..."
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  rows={3}
                  className="mt-2 bg-gradient-surface border-border/30"
                />
                <AlertDialogFooter className="gap-2">
                  <AlertDialogCancel className="border-border/50">Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleReject}
                    disabled={rejectMutation.isPending || !rejectionReason.trim()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {rejectMutation.isPending ? 'Rechazando...' : 'Confirmar'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}

        {report.status === 'rejected' && report.rejectionReason && (
          <div className="gaming-card p-4 border-destructive/30">
            <p className="text-sm font-display uppercase tracking-wider text-destructive mb-2">Motivo del rechazo</p>
            <p className="text-sm text-muted-foreground">{report.rejectionReason}</p>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
