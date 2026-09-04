import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Swords, Loader2, AlertCircle } from 'lucide-react';
import { AuthLayout } from '@/components/layouts/AuthLayout';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: 'No se pudo completar el inicio de sesión con start.gg. Inténtalo de nuevo.',
  no_token: 'La autenticación no devolvió un token válido. Vuelve a iniciar sesión.',
  session_expired: 'Tu sesión ha expirado. Inicia sesión de nuevo para continuar.',
};

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated } = useAuth();
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const errorKey = searchParams.get('error') || '';
  const errorMessage = useMemo(() => ERROR_MESSAGES[errorKey] || null, [errorKey]);
  const returnTo = searchParams.get('from') || '/dashboard';

  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      setIsAuthenticating(true);
      sessionStorage.setItem('auth_token', token);
      toast({
        title: 'Autenticando...',
        description: 'Verificando credenciales',
      });
      navigate(returnTo.startsWith('/') ? returnTo : '/dashboard', { replace: true });
    }
  }, [searchParams, navigate, returnTo]);

  useEffect(() => {
    if (isAuthenticated) {
      navigate(returnTo.startsWith('/') ? returnTo : '/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate, returnTo]);

  const handleLogin = () => {
    setIsAuthenticating(true);
    if (returnTo && returnTo !== '/dashboard') {
      sessionStorage.setItem('auth_return_to', returnTo);
    }
    toast({
      title: 'Iniciando sesión...',
      description: 'Redirigiendo a start.gg',
    });
    const base = import.meta.env.VITE_API_BASE_URL;
    const normalized =
      !base || base === 'undefined' || base === 'null' ? '' : base;
    window.location.href = normalized ? `${normalized}/auth/login` : '/auth/login';
  };

  return (
    <AuthLayout>
      <div className="gaming-card p-8 text-center animate-slide-up">
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 rounded-2xl bg-gradient-primary flex items-center justify-center glow-cyan">
            <Swords className="w-10 h-10 text-white" />
          </div>
        </div>

        <h1 className="font-display text-3xl font-bold tracking-wider text-gradient mb-2">
          BRACKET MANAGER
        </h1>
        <p className="text-muted-foreground text-sm mb-8">
          Gestiona tus brackets de Smash Ultimate
        </p>

        {errorMessage && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-left text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <button
          onClick={handleLogin}
          disabled={isAuthenticating}
          className="w-full py-4 px-6 rounded-xl bg-gradient-primary text-white font-display text-lg font-bold tracking-wider transition-all duration-300 hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed glow-cyan flex items-center justify-center gap-3"
        >
          {isAuthenticating ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              AUTENTICANDO...
            </>
          ) : (
            'INICIAR SESIÓN CON START.GG'
          )}
        </button>

        <p className="text-xs text-muted-foreground mt-6">
          Conecta tu cuenta de start.gg para acceder a tus eventos y sets
        </p>
      </div>
    </AuthLayout>
  );
}
