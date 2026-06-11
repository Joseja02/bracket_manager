import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface BestOfDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (bestOf: 3 | 5) => void;
  isSubmitting?: boolean;
}

export function BestOfDialog({ open, onClose, onConfirm, isSubmitting = false }: BestOfDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="gaming-card border-border/30 max-w-xs mx-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-lg uppercase tracking-wider text-center">¿Formato del set?</DialogTitle>
          <DialogDescription className="text-center">
            Selecciona si el set será Bo3 o Bo5 antes de iniciarlo.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => onConfirm(3)}
            disabled={isSubmitting}
            className="gaming-card flex items-center justify-center aspect-square min-h-[80px] text-2xl font-display uppercase tracking-wider hover:border-primary/60 hover:shadow-[0_0_15px_rgba(0,212,255,0.15)] transition-all disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              'Bo3'
            )}
          </button>
          <button
            onClick={() => onConfirm(5)}
            disabled={isSubmitting}
            className="gaming-card flex items-center justify-center aspect-square min-h-[80px] text-2xl font-display uppercase tracking-wider hover:border-secondary/60 hover:shadow-[0_0_15px_rgba(153,69,255,0.15)] transition-all disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              'Bo5'
            )}
          </button>
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting} className="w-full border-border/50">
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

