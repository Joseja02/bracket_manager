import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScopeErrorModal } from './ScopeErrorModal';

describe('ScopeErrorModal', () => {
  it('renders message and reauth CTA', () => {
    const onClose = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
    });

    render(
      <ScopeErrorModal
        open
        onClose={onClose}
        message="Missing tournament.reporter scope"
      />,
    );

    expect(screen.getByText('Permisos Insuficientes')).toBeInTheDocument();
    expect(screen.getByText(/Missing tournament.reporter scope/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Re-autenticar con start.gg/i }));
    expect(window.location.href).toMatch(/\/auth\/login$/);

    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    });
  });

  it('calls onClose when cancel is clicked', () => {
    const onClose = vi.fn();
    render(<ScopeErrorModal open onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /Cancelar/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
