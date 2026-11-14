import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary.jsx';

function Boom() { throw new Error('boom'); }

describe('ErrorBoundary', () => {
  it('renderiza children cuando no hay error', () => {
    render(<ErrorBoundary><span>ok</span></ErrorBoundary>);
    expect(screen.getByText('ok')).toBeInTheDocument();
  });

  it('muestra fallback cuando un hijo lanza', () => {
    // Evita ruido en consola durante el test
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText('Algo salió mal')).toBeInTheDocument();
    expect(screen.getByText('Recargar página')).toBeInTheDocument();
    spy.mockRestore();
  });
});