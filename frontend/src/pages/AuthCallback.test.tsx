import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AuthCallback from './AuthCallback';

function renderCallback(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/oauth/callback" element={<AuthCallback />} />
        <Route path="/dashboard" element={<div>Dashboard OK</div>} />
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/events/42" element={<div>Event 42</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AuthCallback', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('stores token and redirects to dashboard on success', async () => {
    const { getByText } = renderCallback('/oauth/callback?token=tok-abc');

    await waitFor(() => expect(getByText('Dashboard OK')).toBeInTheDocument());
    expect(sessionStorage.getItem('auth_token')).toBe('tok-abc');
  });

  it('honors auth_return_to after success', async () => {
    sessionStorage.setItem('auth_return_to', '/events/42');
    const { getByText } = renderCallback('/oauth/callback?token=tok-abc');

    await waitFor(() => expect(getByText('Event 42')).toBeInTheDocument());
    expect(sessionStorage.getItem('auth_return_to')).toBe(null);
  });

  it('redirects to login with auth_failed on OAuth error', async () => {
    const { getByText } = renderCallback('/oauth/callback?error=access_denied');

    await waitFor(() => expect(getByText('Login page')).toBeInTheDocument());
    expect(sessionStorage.getItem('auth_token')).toBe(null);
  });

  it('redirects to login with no_token when token is missing', async () => {
    const { getByText } = renderCallback('/oauth/callback');

    await waitFor(() => expect(getByText('Login page')).toBeInTheDocument());
  });
});
