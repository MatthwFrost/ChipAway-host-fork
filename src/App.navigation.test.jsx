import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { App } from './App';
import { createGame, getLiveGame, listGames } from './engine/games';
import { SCREEN_KEY } from './engine/screen';

// The engine is a one-shot DOM driver; none of it is under test here.
vi.mock('./engine/initializePokerTrainer', () => ({ initializePokerTrainer: vi.fn() }));

let reload;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  reload = vi.fn();
  // jsdom's location.reload is not writable, so the whole object is replaced.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function play() {
  fireEvent.click(screen.getByRole('button', { name: 'Play' }));
}

describe('pressing Play', () => {
  // The whole point of the change: Play deals, it does not interview you.
  it('starts a game straight away when none is running', () => {
    render(<App />);
    play();

    const live = getLiveGame();
    expect(live).not.toBeNull();
    expect(live.status).toBe('live');
    expect(reload).toHaveBeenCalledOnce();
    // The reload has to land on the table, not back on the dashboard.
    expect(sessionStorage.getItem(SCREEN_KEY)).toBe('table');
  });

  it('uses the defaults rather than asking for a setup', () => {
    render(<App />);
    play();

    expect(screen.queryByRole('dialog', { name: /new game/i })).not.toBeInTheDocument();
    expect(getLiveGame().setup).toMatchObject({
      pace: '1.15', showdownGuess: false, rangeGuess: false,
    });
  });

  it('resumes an existing game in place, without a reload', () => {
    createGame();
    render(<App />);
    play();

    expect(reload).not.toHaveBeenCalled();
    expect(listGames()).toHaveLength(1);
    expect(document.querySelector('.shell').dataset.screen).toBe('table');
  });
});

describe('the dashboard new-game button', () => {
  it('starts a game with no questions when nothing is at stake', () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /new game/i }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(getLiveGame()).not.toBeNull();
  });

  // Starting a new game retires the live one, so hands already played are about
  // to become read-only. That is worth one question.
  it('confirms before retiring a game with hands played', () => {
    const live = createGame();
    localStorage.setItem('chipaway.games.v1', JSON.stringify({
      version: 1,
      liveId: live.id,
      games: [{ ...live, state: { ...live.state, stats: { ...live.state.stats, hands: 12 } } }],
    }));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /new game/i }));

    expect(confirmSpy).toHaveBeenCalledOnce();
    // Declined, so the game in progress survives and nothing reloads.
    expect(reload).not.toHaveBeenCalled();
    expect(getLiveGame().id).toBe(live.id);
  });
});

describe('the screen the app opens on', () => {
  it('lands on the dashboard by default', () => {
    render(<App />);
    expect(document.querySelector('.shell').dataset.screen).toBe('home');
  });

  it('honours an intent left by the reload that just happened', () => {
    sessionStorage.setItem(SCREEN_KEY, 'table');
    render(<App />);
    expect(document.querySelector('.shell').dataset.screen).toBe('table');
    // Consumed: a later visit should not be dragged back to the table.
    expect(sessionStorage.getItem(SCREEN_KEY)).toBeNull();
  });
});
