import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminReports from './AdminReports';
import type { ReportSummary } from '@/types';

vi.mock('@/components/layouts/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/lib/api', () => ({
  adminApi: {
    getReports: vi.fn(),
  },
}));

const pendingReport: ReportSummary = {
  id: 1,
  setId: '100',
  eventId: '42',
  eventName: 'Test Event',
  round: 'Winners Quarters',
  status: 'pending',
  p1: { entrantId: '1', name: 'Player A' },
  p2: { entrantId: '2', name: 'Player B' },
  scoreP1: 2,
  scoreP2: 1,
  createdAt: '2026-01-01T00:00:00Z',
  submittedBy: 'Player A',
};

const approvedReport: ReportSummary = {
  ...pendingReport,
  id: 2,
  status: 'approved',
};

function renderReports() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <MemoryRouter initialEntries={['/admin/reports']}>
      <QueryClientProvider client={queryClient}>
        <AdminReports />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('AdminReports', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('loads pending reports by default', async () => {
    const { adminApi } = await import('@/lib/api');
    vi.mocked(adminApi.getReports).mockResolvedValue([pendingReport]);

    renderReports();

    await waitFor(() => expect(screen.getByText(/Player A vs Player B/)).toBeInTheDocument());
    expect(adminApi.getReports).toHaveBeenCalledWith({ status: 'pending' });
  });

  it('switches filter to approved and refetches', async () => {
    const { adminApi } = await import('@/lib/api');
    vi.mocked(adminApi.getReports)
      .mockResolvedValueOnce([pendingReport])
      .mockResolvedValueOnce([approvedReport]);

    renderReports();

    await waitFor(() => expect(screen.getByText(/Player A vs Player B/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Aprobados' }));

    await waitFor(() => {
      expect(adminApi.getReports).toHaveBeenCalledWith({ status: 'approved' });
    });
  });

  it('shows empty state when there are no pending reports', async () => {
    const { adminApi } = await import('@/lib/api');
    vi.mocked(adminApi.getReports).mockResolvedValue([]);

    renderReports();

    await waitFor(() => {
      expect(screen.getByText(/Los sets a validar aparecerán aquí/i)).toBeInTheDocument();
    });
  });
});
