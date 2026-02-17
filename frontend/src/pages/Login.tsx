import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Swords, Loader2 } from 'lucide-react';
import { AuthLayout } from '@/components/layouts/AuthLayout';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated } = useAuth();
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      setIsAuthenticating(true);
      toast({
        title: 'Autenticando...',
        description: 'Verificando credenciales',
      });
      setTimeout(() => {
        navigate('/dashboard');
      }, 1000);
    }
  }, [searchParams, navigate]);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  const handleLogin = () => {
    setIsAuthenticating(true);
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
        {/* Logo / Icon */}
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 rounded-2xl bg-gradient-primary flex items-center justify-center glow-cyan">
            <Swords className="w-10 h-10 text-white" />
          </div>
        </div>

        {/* Title */}
        <h1 className="font-display text-3xl font-bold tracking-wider text-gradient mb-2">
          BRACKET MANAGER
        </h1>
        <p className="text-muted-foreground text-sm mb-8">
          Gestiona tus brackets de Smash Ultimate
        </p>

        {/* Login Button */}
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

        {/* Footer text */}
        <p className="text-xs text-muted-foreground mt-6">
          Conecta tu cuenta de start.gg para acceder a tus eventos y sets
        </p>
      </div>
    </AuthLayout>
  );
}
