import axios from 'axios';
import type { User, EventSummary, SetSummary, SetDetail, ReportSummary, ReportDetail, GameRecord, SetSpectateResponse } from '@/types';

const rawBaseUrl = import.meta.env.VITE_API_BASE_URL;
const configuredBaseUrl =
  !rawBaseUrl || rawBaseUrl === 'undefined' || rawBaseUrl === 'null' ? '' : rawBaseUrl;
const isLocalLaravel =
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configuredBaseUrl);
// En `npm run dev` las llamadas van al propio Vite (mismo origen) y el proxy
// las reenvía a Laravel. Así se evitan OPTIONS CORS + Xdebug en cada request.
const normalizedBaseUrl = import.meta.env.DEV && isLocalLaravel ? '' : configuredBaseUrl;

const api = axios.create({
  baseURL: normalizedBaseUrl ? `${normalizedBaseUrl}/api` : '/api',
  withCredentials: true, // CRÍTICO para enviar cookies en requests CORS
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});

// Interceptor para agregar token Bearer usando sessionStorage
api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Sesión inválida/expirada: limpiar token y forzar re-login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url = String(error?.config?.url || '');
    const isAuthMe = url.includes('/me');
    if (status === 401 && !isAuthMe) {
      sessionStorage.removeItem('auth_token');
      const base = import.meta.env.BASE_URL || '/';
      const loginPath = `${base}login`.replace(/\/{2,}/g, '/');
      if (!window.location.pathname.endsWith('/login')) {
        const returnTo = `${window.location.pathname}${window.location.search}`;
        window.location.href = `${loginPath}?error=session_expired&from=${encodeURIComponent(returnTo)}`;
      }
    }
    return Promise.reject(error);
  },
);

// Auth
export const authApi = {
  me: () => api.get<{ id: number; name: string; role: 'competitor' | 'admin'; startgg_user_id: string }>('/me').then(res => ({
    data: {
      id: res.data.id,
      gamerTag: res.data.name,
      role: res.data.role,
      startgg_user_id: res.data.startgg_user_id,
    } as User
  })),
  login: () => {
    const loginOrigin = import.meta.env.DEV && isLocalLaravel ? '' : configuredBaseUrl;
    window.location.href = loginOrigin ? `${loginOrigin}/auth/login` : '/auth/login';
  },
};

// Competitor
export const competitorApi = {
  getMyEvents: () => api.get<EventSummary[]>('/me/events').then(res => res.data),
  getEvent: (eventId: string | number) => api.get<EventSummary>(`/events/${eventId}`).then(res => res.data),
  getEventAdminCheck: (eventId: string | number, tournamentSlug?: string) =>
    api.get<{ isAdmin: boolean; slug?: string; reason?: string }>(`/events/${eventId}/admin-check`, {
      params: tournamentSlug ? { tournamentSlug } : undefined,
    }).then(res => res.data),
  getEventSets: (eventId: string | number, params?: { mine?: 1; status?: string }) =>
    api.get<SetSummary[]>(`/events/${eventId}/sets`, { params }).then(res => res.data),
  getSetDetail: (setId: string | number) => api.get<SetDetail>(`/sets/${setId}`).then(res => res.data),
  startSet: (setId: string | number, bestOf?: 3 | 5, eventId?: string | number) =>
    api.post(`/sets/${setId}/start`, {
      ...(bestOf ? { bestOf } : {}),
      ...(eventId != null && eventId !== '' ? { eventId } : {}),
    }).then(res => res.data),
  submitReport: (setId: string | number, data: { games: GameRecord[]; notes?: string }) =>
    api.post(`/sets/${setId}/submit`, data).then(res => res.data),
  // Ayudantes de tiempo real para RPS y bans
  getSetState: (setId: string | number) => api.get(`/sets/${setId}/state`).then(res => res.data),
  postRpsChoice: (setId: string | number, choice: string) => api.post(`/sets/${setId}/rps`, { choice }).then(res => res.data),
  postBan: (setId: string | number, stage: string, allStages?: string[]) => api.post(`/sets/${setId}/bans`, { stage, allStages }).then(res => res.data),
  getSetDraft: (setId: string | number) => api.get(`/sets/${setId}/draft`).then(res => res.data),
  postSetDraft: (setId: string | number, data: unknown) => api.post(`/sets/${setId}/draft`, { data }).then(res => res.data),
  getSetSpectate: (setId: string | number) =>
    api.get<SetSpectateResponse>(`/sets/${setId}/spectate`).then(res => res.data),
};

// Admin
export const adminApi = {
  getReports: (params?: { status?: string; eventId?: string | number }) =>
    api.get<ReportSummary[]>('/admin/reports', { params }).then(res => res.data),
  getReportDetail: (reportId: string | number) =>
    api.get<ReportDetail>(`/admin/reports/${reportId}`).then(res => res.data),
  updateReport: (reportId: string | number, data: { games: GameRecord[]; notes?: string }) =>
    api.put<ReportDetail>(`/admin/reports/${reportId}`, data).then(res => res.data),
  approveReport: (reportId: string | number) =>
    api.post(`/admin/reports/${reportId}/approve`).then(res => res.data),
  rejectReport: (reportId: string | number, reason: string) =>
    api.post(`/admin/reports/${reportId}/reject`, { reason }).then(res => res.data),
  getSetLiveState: (setId: string | number) =>
    api.get<{ setDetail: SetDetail, state: any, draft: any, lastUpdate: string | null }>(`/admin/sets/${setId}/live`).then(res => res.data),
  resetSet: (setId: string | number, eventId?: string | number) =>
    api.post<{ message: string; startggReset?: boolean; startggError?: string | null }>(
      `/admin/sets/${setId}/reset`,
      eventId != null && eventId !== '' ? { eventId } : undefined,
    ).then(res => res.data),
  setBestOf: (setId: string | number, bestOf: 3 | 5) =>
    api.post<{ message: string; bestOf: number }>(`/admin/sets/${setId}/best-of`, { bestOf }).then(res => res.data),
};

export default api;
