import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App.js';

describe('App', () => {
  it('renders the UA² status card', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: /UA² SDK Demo/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /UA² Status/i })).toBeInTheDocument();
    expect(screen.getByText(/Connection state: idle/i)).toBeInTheDocument();
  });
});
