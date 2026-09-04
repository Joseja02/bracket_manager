import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'Ha ocurrido un error inesperado',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught', error, info);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, message: '' });
  };

  private handleDashboard = () => {
    window.location.href = `${import.meta.env.BASE_URL || '/'}dashboard`.replace(/\/{2,}/g, '/');
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="gaming-card max-w-md w-full p-8 space-y-4 text-center">
          <h1 className="font-display text-xl uppercase tracking-wider">Algo salió mal</h1>
          <p className="text-sm text-muted-foreground">{this.state.message}</p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <Button variant="outline" onClick={this.handleRetry}>
              Reintentar
            </Button>
            <Button onClick={this.handleDashboard}>
              Ir al dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
