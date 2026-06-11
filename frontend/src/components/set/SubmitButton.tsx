import { cn } from '@/lib/utils';
import { Send, Loader2 } from 'lucide-react';

interface SubmitButtonProps {
  canSubmit: boolean;
  isSubmitting: boolean;
  onClick: () => void;
}

export function SubmitButton({ canSubmit, isSubmitting, onClick }: SubmitButtonProps) {
  return (
    <div className="animate-slide-up" style={{ animationDelay: '200ms' }}>
      <button
        onClick={onClick}
        disabled={!canSubmit || isSubmitting}
        className={cn(
          'w-full py-4 px-6 rounded-xl font-display text-lg font-bold tracking-wider transition-all duration-300',
          'flex items-center justify-center gap-3',
          canSubmit
            ? 'bg-gradient-primary text-white hover:opacity-90 active:scale-[0.98] glow-cyan'
            : 'bg-muted text-muted-foreground cursor-not-allowed'
        )}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            ENVIANDO...
          </>
        ) : (
          <>
            <Send className="w-5 h-5" />
            ENVIAR REPORTE
          </>
        )}
      </button>
    </div>
  );
}
