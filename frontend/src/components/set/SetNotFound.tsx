import { Button } from '@/components/ui/button';
import { AlertCircle, ArrowLeft, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface SetNotFoundProps {
  eventId?: string | number;
  onRetry?: () => void;
}

export function SetNotFound({ eventId, onRetry }: SetNotFoundProps) {
  const navigate = useNavigate();

  const handleBack = () => {
    if (eventId) {
      navigate(`/events/${eventId}`);
    } else {
      navigate('/dashboard');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[50vh] animate-fade-in">
      <div className="gaming-card max-w-md w-full text-center p-8 space-y-5">
        <div className="mx-auto h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
        </div>
        <h2 className="text-xl font-display uppercase tracking-wider">Set no encontrado</h2>
        <p className="text-sm text-muted-foreground">
          El set que buscas no existe o no tienes permisos para verlo.
        </p>
        <div className="flex flex-col gap-3 pt-2">
          {onRetry && (
            <Button variant="outline" onClick={onRetry} className="border-border/50">
              <RotateCcw className="mr-2 h-4 w-4" />
              Reintentar
            </Button>
          )}
          <Button onClick={handleBack} className="bg-gradient-primary">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {eventId ? 'Volver al Evento' : 'Volver al Dashboard'}
          </Button>
        </div>
      </div>
    </div>
  );
}
