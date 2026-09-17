import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HomeScreen } from './HomeScreen';

function statsWith(fields) {
  return { hands: 0, vpip: 0, pfr: 0, f3bOpp: 0, f3b: 0, aggro: 0, calls: 0, wtsd: 0,
    guessTotal: 0, guessRight: 0, rgTotal: 0, rgRight: 0, ...fields };
}

function game(fields) {
  return {
    id: 'g_' + Math.random(),
    createdAt: Date.UTC(2026, 8, 14),
    endedAt: Date.UTC(2026, 8, 14),
    status: 'ended',
    setup: { pace: '1.15', showdownGuess: false, rangeGuess: false, seats: [] },
    net: 0,
    state: { stats: statsWith({}), handLog: [], evRecords: [], matchResults: [], handNo: 0 },
    ...fields,
  };
}

const noop = () => {};

function renderHome(props) {
  return render(
    <HomeScreen
      games={[]}
      liveGame={null}
      onNewGame={noop}
      onResume={noop}
      onEndGame={noop}
      onClearHistory={noop}
      {...props}
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('with nothing played', () => {
  it('offers a new game and explains the empty state', () => {
    renderHome();
    expect(screen.getByRole('button', { name: /new game/i })).toBeInTheDocument();
    expect(screen.getByText(/nothing played yet/i)).toBeInTheDocument();
  });

  // A row of zeroes is noise, not information.
  it('hides the lifetime strip and the clear control', () => {
    renderHome();
    expect(screen.queryByText('All time')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear all history/i })).not.toBeInTheDocument();
  });
});

describe('with a live game', () => {
  const live = game({ status: 'live', endedAt: null, net: 1240, state: { stats: statsWith({ hands: 43 }), evRecords: [] } });

  it('shows the resume card with its hand count and net', () => {
    renderHome({ games: [live], liveGame: live });
    expect(screen.getByText('Still playing')).toBeInTheDocument();
    expect(screen.getByText(/43 hands/)).toBeInTheDocument();
    // Twice over: on the card, and in the lifetime Net cell, since a live game
    // counts towards the all-time figures as much as a finished one.
    expect(screen.getAllByText('+1240')).toHaveLength(2);
  });

  it('calls back on resume and on end', () => {
    const onResume = vi.fn();
    const onEndGame = vi.fn();
    renderHome({ games: [live], liveGame: live, onResume, onEndGame });
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    expect(onResume).toHaveBeenCalledOnce();
    expect(onEndGame).toHaveBeenCalledOnce();
  });

  // A migrated game's net starts from the upgrade, not from its first hand, and
  // the card has to say so rather than implying the figure is complete.
  it('flags a migrated game', () => {
    const migrated = game({ status: 'live', endedAt: null, migrated: true, state: { stats: statsWith({ hands: 22 }), evRecords: [] } });
    renderHome({ games: [migrated], liveGame: migrated });
    expect(screen.getByText(/net counted from upgrade/i)).toBeInTheDocument();
  });
});

describe('with finished games', () => {
  const games = [
    game({ net: 2015, state: { stats: statsWith({ hands: 88 }), evRecords: [] } }),
    game({ net: -310, state: { stats: statsWith({ hands: 12 }), evRecords: [] } }),
  ];

  it('lists them with their results', () => {
    renderHome({ games });
    expect(screen.getByText('Past games')).toBeInTheDocument();
    expect(screen.getByText('+2015')).toBeInTheDocument();
    expect(screen.getByText('−310')).toBeInTheDocument();
  });

  it('adds up the lifetime strip', () => {
    renderHome({ games });
    expect(screen.getByText('All time')).toBeInTheDocument();
    // 88 + 12 hands, 2015 - 310 chips.
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('+1705')).toBeInTheDocument();
  });

  it('leaves a live game out of the past list', () => {
    const live = game({ status: 'live', endedAt: null, net: 5, state: { stats: statsWith({ hands: 1 }), evRecords: [] } });
    renderHome({ games: games.concat([live]), liveGame: live });
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('the coach line', () => {
  it('stays away when there is nothing worth saying', () => {
    renderHome({ games: [game({ state: { stats: statsWith({ hands: 4 }), evRecords: [] } })] });
    expect(screen.queryByText(/worth fixing/i)).not.toBeInTheDocument();
  });

  it('appears once the lifetime totals show a leak', () => {
    // Calling far more than betting, over enough hands for findLeak to speak.
    const leaky = game({ state: { stats: statsWith({ hands: 40, vpip: 12, pfr: 8, aggro: 1, calls: 20 }), evRecords: [] } });
    renderHome({ games: [leaky] });
    expect(screen.getByText(/worth fixing/i)).toBeInTheDocument();
  });
});
