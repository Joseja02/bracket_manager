import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ExternalLink } from 'lucide-react';

interface ScopeErrorModalProps {
  open: boolean;
  onClose: () => void;
  message?: string;
}

export function ScopeErrorModal({ open, onClose, message }: ScopeErrorModalProps) {
  const baseUrl = import.meta.env.VITE_API_BASE_URL;

  const handleReauth = () => {
    const normalized =
      !baseUrl || baseUrl === 'undefined' || baseUrl === 'null' ? '' : baseUrl;
    window.location.href = normalized ? `${normalized}/auth/login` : '/auth/login';
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="gaming-card border-border/30 max-w-sm mx-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display uppercase tracking-wider">
            <AlertTriangle className="h-5 w-5 text-amber" />
            Permisos Insuficientes
          </DialogTitle>
          <DialogDescription>
            {message || 'No tienes los permisos necesarios para realizar esta acción. Puede que necesites re-autenticarte con start.gg para obtener el scope tournament.reporter.'}
          </DialogDescription>
        </DialogHeader>
        
        <div className="bg-gradient-surface rounded-lg p-4 text-sm border border-border/20">
          <p className="font-semibold mb-2 text-foreground">¿Qué significa esto?</p>
          <p className="text-muted-foreground leading-relaxed">
            Para iniciar o reportar sets en start.gg, necesitas autorizar a la aplicación con permisos adicionales. 
            Al re-autenticarte, se te pedirán los permisos necesarios.
          </p>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose} className="border-border/50">
            Cancelar
          </Button>
          <Button onClick={handleReauth} className="bg-gradient-primary">
            <ExternalLink className="mr-2 h-4 w-4" />
            Re-autenticar con start.gg
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
