import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { adminApi, competitorApi } from '@/lib/api';
import { FileCheck, AlertCircle, RefreshCw, Wifi } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { ReportSummary, SetSummary } from '@/types';

export default function AdminReports() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'active'>('pending');
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get('eventId') || sessionStorage.getItem('admin_event_id') || '';

  useEffect(() => {
    if (eventId) {
      sessionStorage.setItem('admin_event_id', eventId);
    }
  }, [eventId]);

  const { data: reports, isLoading } = useQuery({
    queryKey: ['adminReports', filter, eventId],
    queryFn: async () => {
      if (filter === 'active') {
        // Reutilizando el endpoint de competidor para obtener sets en progreso
        return competitorApi.getEventSets(eventId, { status: 'in_progress' });
      }
      return adminApi.getReports({ status: filter, eventId });
    },
    enabled: !!eventId,
  });

  const filters = [
    { value: 'pending' as const, label: 'Pendientes' },
    { value: 'active' as const, label: 'En Curso' },
    { value: 'approved' as const, label: 'Aprobados' },
    { value: 'rejected' as const, label: 'Rechazados' },
  ];

  return (
    <AppLayout>
      <div className="space-y-5">
        {/* Encabezado */}
        <div className="space-y-1">
          <h1 className="text-2xl font-display">Reportes</h1>
          <p className="text-sm text-muted-foreground">Revisa y aprueba reportes de sets</p>
        </div>

        {/* Acciones */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['adminReports'] })}
          className="gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Actualizar
        </Button>

        {/* Pestañas de Filtro */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-gaming">
          {filters.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all touch-target',
                filter === f.value
                  ? 'bg-gradient-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Lista de Reportes */}
        {!eventId ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-10">
              <AlertCircle className="w-10 h-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground text-center">
                Selecciona un evento para ver sus reportes
              </p>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        ) : !reports || reports.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-10">
              {filter === 'pending' ? (
                <FileCheck className="w-10 h-10 text-muted-foreground mb-3" />
              ) : (
                <AlertCircle className="w-10 h-10 text-muted-foreground mb-3" />
              )}
              <p className="text-muted-foreground text-center">
                No hay reportes {filter === 'pending' ? 'pendientes' : filter === 'active' ? 'en curso' : filter === 'approved' ? 'aprobados' : 'rechazados'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {reports.map((item: any) => {
              // Manejar tanto ReportSummary como SetSummary (para sets activos)
              const isSet = filter === 'active';
              const id = isSet ? item.id : item.id;
              const title = isSet ? item.round : item.round;
              const eventName = item.eventName || 'Evento';
              const p1Name = isSet ? item.p1?.name : item.p1?.name;
              const p2Name = isSet ? item.p2?.name : item.p2?.name;
              const scoreText = isSet ? 'En Progreso' : `${item.scoreP1} - ${item.scoreP2}`;

              return (
                <Card key={id} className="overflow-hidden">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base truncate">{title}</CardTitle>
                          {isSet && (
                            <Badge variant="outline" className="text-green-600 border-green-500 gap-1 h-5 px-1.5">
                              <Wifi className="w-3 h-3 animate-pulse" /> Live
                            </Badge>
                          )}
                        </div>
                        <CardDescription className="truncate">{eventName}</CardDescription>
                      </div>
                      <Badge variant={isSet ? 'secondary' : 'outline'} className="shrink-0">
                        {scoreText}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-sm">
                      <p className="text-muted-foreground text-xs">Jugadores</p>
                      <p className="font-medium truncate">{p1Name} vs {p2Name}</p>
                    </div>

                    {!isSet && (
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <p className="text-muted-foreground">Enviado por</p>
                          <p className="font-medium truncate">{item.submittedBy}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-muted-foreground">Fecha</p>
                          <p className="font-medium">
                            {new Date(item.createdAt).toLocaleDateString('es-ES', {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        </div>
                      </div>
                    )}

                    <Button
                      onClick={() => {
                        if (isSet) {
                          navigate(`/admin/sets/${id}/live`);
                        } else {
                          navigate(`/admin/reports/${id}${eventId ? `?eventId=${eventId}` : ''}`);
                        }
                      }}
                      className={cn('w-full', filter === 'pending' ? '' : 'bg-muted text-foreground hover:bg-muted/80')}
                      variant={filter === 'pending' ? 'default' : 'outline'}
                    >
                      {isSet ? 'Ver Live' : filter === 'pending' ? 'Revisar' : 'Ver Detalle'}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
