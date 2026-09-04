import { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get('token');
    const error = searchParams.get('error');

    if (error) {
      console.error('OAuth error:', error);
      navigate('/login?error=auth_failed');
      return;
    }

    if (token) {
      // Guardar aquí antes de navegar: si /dashboard monta antes que useAuth,
      // ProtectedRoute vería sesión vacía y redirigiría a /login.
      sessionStorage.setItem('auth_token', token);
      const returnTo = sessionStorage.getItem('auth_return_to') || '/dashboard';
      sessionStorage.removeItem('auth_return_to');
      navigate(returnTo.startsWith('/') ? returnTo : '/dashboard', { replace: true });
    } else {
      navigate('/login?error=no_token');
    }
  }, [searchParams, navigate]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
        <p className="text-lg font-medium">Procesando autenticación...</p>
      </div>
    </div>
  );
}
