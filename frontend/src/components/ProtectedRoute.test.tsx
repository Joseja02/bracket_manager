import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/hooks/useAuth';
import { ProtectedRoute } from '@/components/ProtectedRoute';

vi.mock('@/lib/api', () => ({
  authApi: {
    me: vi.fn(),
  },
}));

function renderWithAuth(entry: string, requireAdmin = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Routes>
            <Route
              path="/secret"
              element={
                <ProtectedRoute requireAdmin={requireAdmin}>
                  <div>Secret content</div>
                </ProtectedRoute>
              }
            />
            <Route path="/login" element={<div>Login page</div>} />
            <Route path="/dashboard" element={<div>Dashboard page</div>} />
          </Routes>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('redirects unauthenticated users to login with from param', async () => {
    const { authApi } = await import('@/lib/api');
    vi.mocked(authApi.me).mockRejectedValue(new Error('unauth'));

    renderWithAuth('/secret');

    await waitFor(() => expect(screen.getByText('Login page')).toBeInTheDocument());
  });

  it('allows authenticated users through', async () => {
    const { authApi } = await import('@/lib/api');
    sessionStorage.setItem('auth_token', 'tok');
    vi.mocked(authApi.me).mockResolvedValue({
      data: {
        id: 1,
        gamerTag: 'Jose',
        role: 'competitor',
        startgg_user_id: '99',
      },
    });

    renderWithAuth('/secret');

    await waitFor(() => expect(screen.getByText('Secret content')).toBeInTheDocument());
  });

  it('blocks non-admins from requireAdmin routes', async () => {
    const { authApi } = await import('@/lib/api');
    sessionStorage.setItem('auth_token', 'tok');
    vi.mocked(authApi.me).mockResolvedValue({
      data: {
        id: 1,
        gamerTag: 'Jose',
        role: 'competitor',
        startgg_user_id: '99',
      },
    });

    renderWithAuth('/secret', true);

    await waitFor(() => expect(screen.getByText('Dashboard page')).toBeInTheDocument());
  });

  it('allows admins on requireAdmin routes', async () => {
    const { authApi } = await import('@/lib/api');
    sessionStorage.setItem('auth_token', 'tok');
    vi.mocked(authApi.me).mockResolvedValue({
      data: {
        id: 1,
        gamerTag: 'Jose',
        role: 'admin',
        startgg_user_id: '99',
      },
    });

    renderWithAuth('/secret', true);

    await waitFor(() => expect(screen.getByText('Secret content')).toBeInTheDocument());
  });
});
