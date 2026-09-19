import MockAdapter from 'axios-mock-adapter';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

describe('api', () => {
  let mock: MockAdapter;

  beforeEach(async () => {
    vi.resetModules();
    const { default: api } = await import('@/lib/api');
    mock = new MockAdapter(api);
  });

  afterEach(() => {
    mock.restore();
  });

  it('adds bearer token from sessionStorage', async () => {
    const { authApi } = await import('@/lib/api');
    sessionStorage.setItem('auth_token', 'token-123');

    mock.onGet('/me').reply((config) => {
      expect(config.headers?.Authorization).toBe('Bearer token-123');
      return [200, { id: 1, name: 'Jose', role: 'admin', startgg_user_id: '99' }];
    });

    const response = await authApi.me();
    expect(response.data).toEqual({
      id: 1,
      gamerTag: 'Jose',
      role: 'admin',
      startgg_user_id: '99',
    });
  });

  it('redirects login to the configured backend URL', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com');
    vi.resetModules();
    const { authApi } = await import('@/lib/api');

    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { href: '', pathname: '/dashboard', search: '' },
      writable: true,
    });

    authApi.login();

    expect(window.location.href).toBe('https://api.example.com/auth/login');

    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    });
  });

  it('clears token and redirects to login on 401', async () => {
    vi.resetModules();
    const { default: api } = await import('@/lib/api');
    mock = new MockAdapter(api);
    sessionStorage.setItem('auth_token', 'expired-token');

    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { href: '', pathname: '/dashboard', search: '' },
      writable: true,
    });

    mock.onGet('/events/1').reply(401, { message: 'Unauthenticated' });

    await expect(api.get('/events/1')).rejects.toBeTruthy();
    expect(sessionStorage.getItem('auth_token')).toBe(null);
    expect(window.location.href).toContain('/login?error=session_expired');

    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    });
  });
});

