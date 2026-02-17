import { cn } from '@/lib/utils';
import { Swords, Ban, Gamepad2, Send, Check } from 'lucide-react';

type FlowPhase = 'rps' | 'bans' | 'games' | 'submit';

interface SetFlowStepperProps {
  currentPhase: FlowPhase;
}

const STEPS: { phase: FlowPhase; label: string; icon: typeof Swords }[] = [
  { phase: 'rps', label: 'RPS', icon: Swords },
  { phase: 'bans', label: 'Bans', icon: Ban },
  { phase: 'games', label: 'Games', icon: Gamepad2 },
  { phase: 'submit', label: 'Enviar', icon: Send },
];

const phaseOrder: Record<FlowPhase, number> = { rps: 0, bans: 1, games: 2, submit: 3 };

export function SetFlowStepper({ currentPhase }: SetFlowStepperProps) {
  const currentIndex = phaseOrder[currentPhase];

  return (
    <div className="gaming-card p-4 animate-slide-up" style={{ animationDelay: '50ms' }}>
      <div className="flex items-center justify-between">
        {STEPS.map((step, i) => {
          const isCompleted = i < currentIndex;
          const isCurrent = i === currentIndex;
          const Icon = isCompleted ? Check : step.icon;

          return (
            <div key={step.phase} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300',
                    isCompleted && 'bg-primary/20 text-primary',
                    isCurrent && 'bg-primary text-primary-foreground glow-cyan scale-110',
                    !isCompleted && !isCurrent && 'bg-muted text-muted-foreground'
                  )}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <span
                  className={cn(
                    'text-xs font-medium transition-colors',
                    isCurrent ? 'text-primary' : isCompleted ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {step.label}
                </span>
              </div>

              {i < STEPS.length - 1 && (
                <div className="flex-1 mx-2">
                  <div
                    className={cn(
                      'h-0.5 rounded-full transition-all duration-300',
                      i < currentIndex ? 'bg-primary' : 'bg-muted'
                    )}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
