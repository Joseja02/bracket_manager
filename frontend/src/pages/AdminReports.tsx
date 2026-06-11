import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { adminApi } from '@/lib/api';
import { FileCheck, AlertCircle, RefreshCw, ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { ReportSummary } from '@/types';

export default function AdminReports() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get('eventId') || sessionStorage.getItem('admin_event_id') || '';

  useEffect(() => {
    if (eventId) {
      sessionStorage.setItem('admin_event_id', eventId);
    }
  }, [eventId]);

  const { data: reports, isLoading } = useQuery({
    queryKey: ['adminReports', filter, eventId],
    queryFn: async () => adminApi.getReports({ status: filter, eventId }),
    enabled: !!eventId,
  });

  const filters = [
    { value: 'pending' as const, label: 'Pendientes' },
    { value: 'approved' as const, label: 'Aprobados' },
    { value: 'rejected' as const, label: 'Rechazados' },
  ];

  return (
    <AppLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-display uppercase tracking-wider">Reportes</h1>
            <p className="text-sm text-muted-foreground">Revisa y aprueba reportes de sets</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['adminReports'] })}
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-gaming">
          {filters.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all touch-target',
                filter === f.value
                  ? 'bg-gradient-primary text-primary-foreground shadow-[0_0_12px_rgba(0,212,255,0.2)]'
                  : 'bg-gradient-surface border border-border/20 text-muted-foreground hover:text-foreground'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Lista de Reportes */}
        {!eventId ? (
          <div className="gaming-card flex flex-col items-center justify-center py-10 border-dashed">
            <AlertCircle className="w-10 h-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-center text-sm">
              Selecciona un evento para ver sus reportes
            </p>
          </div>
        ) : isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        ) : !reports || reports.length === 0 ? (
          <div className="gaming-card flex flex-col items-center justify-center py-10 border-dashed">
            {filter === 'pending' ? (
              <FileCheck className="w-10 h-10 text-muted-foreground mb-3" />
            ) : (
              <AlertCircle className="w-10 h-10 text-muted-foreground mb-3" />
            )}
            <p className="text-muted-foreground text-center text-sm">
              No hay reportes {filter === 'pending' ? 'pendientes' : filter === 'approved' ? 'aprobados' : 'rechazados'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {reports.map((report) => (
              <button
                key={report.id}
                onClick={() => navigate(`/admin/reports/${report.id}${eventId ? `?eventId=${eventId}` : ''}`)}
                className="gaming-card w-full text-left p-4 space-y-3 hover:border-primary/40 transition-all group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-base uppercase tracking-wide truncate">{report.round}</p>
                    <p className="text-xs text-muted-foreground truncate">{report.eventName}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="border-border/30 font-display">
                      {report.scoreP1} - {report.scoreP2}
                    </Badge>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                </div>

                <div className="text-sm">
                  <p className="font-medium truncate">{report.p1.name} vs {report.p2.name}</p>
                </div>

                <div className="flex justify-between text-xs text-muted-foreground">
                  <span className="truncate">Por: {report.submittedBy}</span>
                  <span>
                    {new Date(report.createdAt).toLocaleDateString('es-ES', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
