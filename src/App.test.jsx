import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { App } from './App';

vi.mock('./engine/initializePokerTrainer', () => ({ initializePokerTrainer: vi.fn() }));

import { initializePokerTrainer } from './engine/initializePokerTrainer';

test('renders the componentised trainer shell and starts the poker engine', () => {
  render(<App />);

  expect(screen.getByRole('main')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Deal hand' })).toBeEnabled();
  expect(screen.getByRole('region', { name: 'Poker table' })).toBeInTheDocument();
  expect(initializePokerTrainer).toHaveBeenCalledOnce();
});
