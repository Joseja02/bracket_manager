import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Calendar, Swords, Play, ShieldCheck, RefreshCw, ChevronRight } from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { competitorApi, adminApi } from '@/lib/api';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: events, isLoading: eventsLoading, refetch } = useQuery({
    queryKey: ['myEvents'],
    queryFn: competitorApi.getMyEvents,
  });

  const activeEvents = events?.filter((event) => event.status === 'active') || [];
  const upcomingEvents = events?.filter((event) => event.status === 'upcoming') || [];
  const adminEvents = activeEvents.filter((event) => event.isAdmin);

  const isAdmin = user?.role === 'admin';
  const adminEventId = useMemo(() => {
    const fromStorage = sessionStorage.getItem('admin_event_id');
    if (fromStorage) return fromStorage;
    return adminEvents[0]?.id ? String(adminEvents[0].id) : '';
  }, [adminEvents]);

  const { data: pendingReports, isLoading: pendingReportsLoading } = useQuery({
    queryKey: ['adminPendingReports', adminEventId],
    queryFn: () => adminApi.getReports({ status: 'pending', eventId: adminEventId }),
    enabled: !!isAdmin && !!adminEventId,
  });

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-wider text-gradient">
              {user?.gamerTag || 'Player'}
            </h1>
            <p className="text-sm text-muted-foreground">
              Gestiona tus eventos y sets
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetch()}
            className="shrink-0"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {/* Admin: Pending Reports */}
        {isAdmin && (
          <section className="space-y-3">
            <h2 className="font-display text-sm font-semibold tracking-wider text-muted-foreground uppercase flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              Reportes pendientes
            </h2>
            {!adminEventId ? (
              <div className="gaming-card p-6 text-center">
                <Swords className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Selecciona un evento admin para ver reportes</p>
              </div>
            ) : pendingReportsLoading ? (
              <Skeleton className="h-24 rounded-xl" />
            ) : !pendingReports || pendingReports.length === 0 ? (
              <div className="gaming-card p-6 text-center">
                <Swords className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Sin reportes pendientes</p>
              </div>
            ) : (
              <div className="gaming-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{pendingReports.length} por revisar</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      sessionStorage.setItem('admin_event_id', adminEventId);
                      navigate(`/admin/reports?eventId=${adminEventId}`);
                    }}
                    className="text-primary text-xs gap-1"
                  >
                    Ver todos <ChevronRight className="w-3 h-3" />
                  </Button>
                </div>
                {pendingReports.slice(0, 2).map((report) => (
                  <button
                    key={report.id}
                    onClick={() => {
                      if (adminEventId) sessionStorage.setItem('admin_event_id', adminEventId);
                      navigate(`/admin/reports/${report.id}${adminEventId ? `?eventId=${adminEventId}` : ''}`);
                    }}
                    className="w-full text-left p-3 rounded-lg bg-muted/50 border border-border/50 hover:border-primary/50 transition-all active:scale-[0.98]"
                  >
                    <p className="text-sm font-medium truncate">{report.round}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {report.p1.name} vs {report.p2.name} · {report.scoreP1} - {report.scoreP2}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Active Events */}
        <section className="space-y-3">
          <h2 className="font-display text-sm font-semibold tracking-wider text-muted-foreground uppercase flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary" />
            Eventos activos
          </h2>
          {eventsLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-28 rounded-xl" />
              <Skeleton className="h-28 rounded-xl" />
            </div>
          ) : activeEvents.length === 0 ? (
            <div className="gaming-card p-8 text-center">
              <Calendar className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No tienes eventos activos</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeEvents.map((event) => (
                <button
                  key={event.id}
                  onClick={() => navigate(`/events/${event.id}`)}
                  className="gaming-card p-4 w-full text-left hover:border-primary/50 transition-all active:scale-[0.98]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground truncate">{event.tournamentName}</p>
                      <p className="text-base font-semibold truncate">{event.name}</p>
                    </div>
                    <Badge className="shrink-0 bg-primary/20 text-primary border-primary/30">
                      Activo
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                    <span>Bo{event.bestOf}</span>
                    {event.isAdmin && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        <ShieldCheck className="w-3 h-3 mr-1" />
                        Admin
                      </Badge>
                    )}
                    <ChevronRight className="w-4 h-4 ml-auto text-muted-foreground" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Upcoming Events */}
        {upcomingEvents.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-display text-sm font-semibold tracking-wider text-muted-foreground uppercase flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              Próximos eventos
            </h2>
            <div className="space-y-3">
              {upcomingEvents.map((event) => (
                <div
                  key={event.id}
                  className="gaming-card p-4 opacity-70"
                >
                  <p className="text-xs text-muted-foreground truncate">{event.tournamentName}</p>
                  <p className="text-sm font-medium truncate">{event.name}</p>
                  <div className="flex items-center justify-between mt-2">
                    <Badge variant="secondary" className="text-xs">Próximamente</Badge>
                    {event.startAt && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(Number(event.startAt) * 1000).toLocaleDateString('es-ES', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppLayout>
  );
}
