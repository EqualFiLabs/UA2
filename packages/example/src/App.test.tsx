import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App.js';

describe('App', () => {
  it('renders version information', () => {
    render(<App />);
    expect(screen.getByText(/Core SDK version/i)).toBeInTheDocument();
  });
});
