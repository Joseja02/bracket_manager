import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/hooks/useAuth';
import Login from './Login';

vi.mock('@/lib/api', () => ({
  authApi: {
    me: vi.fn().mockRejectedValue(new Error('unauth')),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

function renderLogin(entry: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Login', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('shows auth_failed error message', async () => {
    renderLogin('/login?error=auth_failed');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/No se pudo completar el inicio de sesión/i);
    });
  });

  it('shows no_token error message', async () => {
    renderLogin('/login?error=no_token');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/no devolvió un token válido/i);
    });
  });

  it('shows session_expired error message', async () => {
    renderLogin('/login?error=session_expired');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/sesión ha expirado/i);
    });
  });
});
