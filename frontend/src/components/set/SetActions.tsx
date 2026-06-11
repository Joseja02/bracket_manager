import { Button } from '@/components/ui/button';
import { Play, Loader2 } from 'lucide-react';

interface SetActionsProps {
  status: 'not_started' | 'in_progress' | 'completed' | 'reported' | 'approved' | 'rejected';
  isAdmin: boolean;
  onStart?: () => void;
  isStarting?: boolean;
}

export function SetActions({ status, isAdmin, onStart, isStarting = false }: SetActionsProps) {
  if (!isAdmin || status !== 'not_started') return null;

  return (
    <Button
      onClick={onStart}
      disabled={isStarting}
      className="w-full bg-gradient-primary"
    >
      {isStarting ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Play className="mr-2 h-4 w-4" />
      )}
      {isStarting ? 'Iniciando...' : 'Iniciar Set'}
    </Button>
  );
}
