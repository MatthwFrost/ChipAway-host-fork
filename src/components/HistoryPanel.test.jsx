import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HistoryPanel } from './HistoryPanel';
import { clearHands, saveHand } from '../engine/handStore';
import { createHandRecorder } from '../engine/handRecorder';

/* A real recorded hand rather than a hand-typed fixture, so the panel is
   tested against the shape the engine actually produces. */
function recordHand(handNo) {
  const rec = createHandRecorder();
  const players = [
    { id: 0, name: 'You', profile: null, stack: 1000, isHero: true, hole: [{ rank: 14, suit: 's' }, { rank: 13, suit: 'd' }], folded: false, rLo: 0, rBluff: 0 },
    { id: 1, name: 'Seat1', profile: 'nit', stack: 1000, isHero: false, hole: [{ rank: 7, suit: 'c' }, { rank: 7, suit: 'h' }], folded: false, rLo: 0, rBluff: 0 },
  ];
  rec.begin({ handNo, players, dealerIdx: 0, heroIndex: 0, sb: 10, bb: 20, startStack: 1000, gameId: 'g_1' });
  rec.blind(0, 10);
  rec.blind(1, 20);
  rec.action({ seat: 0, street: 0, action: 'call', put: 10, to: 20, potBefore: 30, toCall: 10 });
  rec.action({ seat: 1, street: 0, action: 'check', put: 0, to: 20, potBefore: 40, toCall: 0 });
  rec.street(1, [{ rank: 2, suit: 'h' }, { rank: 9, suit: 'c' }, { rank: 12, suit: 'd' }], players);
  rec.action({ seat: 0, street: 1, action: 'bet', put: 30, to: 30, potBefore: 40, toCall: 0 });
  rec.action({ seat: 1, street: 1, action: 'fold', put: 0, to: 0, potBefore: 70, toCall: 30 });
  rec.collect();
  rec.award(0, 70);
  return rec.finish({
    net: 30, potFinal: 70, showdown: false, heroFolded: false, winners: [0],
    decisions: [{ street: 1, streetName: 'Flop', taken: 'bet 30', evTaken: 12, cost: 8, best: { label: 'bet 60', ev: 20 } }],
  });
}

function fakeApi(over) {
  return Object.assign({
    canReplay: () => true,
    isReplaying: () => false,
    enter: () => true,
    stepCount: () => 9,
    visibleSteps: () => [0, 1, 2, 3, 4, 5, 6, 7, 8],
    show: vi.fn(),
    exit: vi.fn(),
  }, over || {});
}

function renderPanel(api, active = true) {
  return render(<HistoryPanel active={active} getApi={() => api} />);
}

describe('HistoryPanel', () => {
  beforeEach(() => { clearHands(); });

  test('says so when there is nothing to replay', () => {
    renderPanel(fakeApi());
    expect(screen.getByText(/No hands yet/)).toBeInTheDocument();
  });

  test('lists a recorded hand with its cards and net', () => {
    saveHand(recordHand(4));
    renderPanel(fakeApi());
    expect(screen.getByText('#4')).toBeInTheDocument();
    expect(screen.getByText('A♠')).toBeInTheDocument();
    expect(screen.getByText('+30')).toBeInTheDocument();
  });

  test('selecting a hand enters replay and draws the first step', () => {
    saveHand(recordHand(1));
    const api = fakeApi();
    renderPanel(api);
    fireEvent.click(screen.getByText('#1'));
    expect(screen.getByText(/Replaying hand #1/)).toBeInTheDocument();
    expect(api.show).toHaveBeenCalledWith(0);
  });

  test('stepping forward advances the drawn step and the caption', () => {
    saveHand(recordHand(1));
    const api = fakeApi();
    renderPanel(api);
    fireEvent.click(screen.getByText('#1'));
    expect(screen.getByText('Cards are dealt')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Next step'));
    expect(api.show).toHaveBeenLastCalledWith(1);
    expect(screen.getByText('You posts 10')).toBeInTheDocument();
  });

  test('cannot step back from the first step', () => {
    saveHand(recordHand(1));
    renderPanel(fakeApi());
    fireEvent.click(screen.getByText('#1'));
    expect(screen.getByLabelText('Previous step')).toBeDisabled();
  });

  test('refuses to replay while a hand is live, and says why', () => {
    saveHand(recordHand(1));
    const api = fakeApi({ canReplay: () => false, enter: vi.fn() });
    renderPanel(api);
    fireEvent.click(screen.getByText('#1'));
    expect(screen.getByText(/Finish the hand you are playing first/)).toBeInTheDocument();
    expect(api.enter).not.toHaveBeenCalled();
    expect(screen.queryByText(/Replaying hand/)).toBeNull();
  });

  test('Done hands the felt back to the live table', () => {
    saveHand(recordHand(1));
    const api = fakeApi();
    renderPanel(api);
    fireEvent.click(screen.getByText('#1'));
    fireEvent.click(screen.getByText('Done'));
    expect(api.exit).toHaveBeenCalled();
    expect(screen.queryByText(/Replaying hand/)).toBeNull();
  });

  test('arrow keys step through the hand', () => {
    saveHand(recordHand(1));
    const api = fakeApi();
    renderPanel(api);
    fireEvent.click(screen.getByText('#1'));
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(api.show).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(api.show).toHaveBeenLastCalledWith(0);
  });

  test('shows what each decision cost', () => {
    saveHand(recordHand(1));
    renderPanel(fakeApi());
    fireEvent.click(screen.getByText('#1'));
    expect(screen.getByText('Flop — you bet 30')).toBeInTheDocument();
  });

  test('leaving the screen clears the selection', () => {
    saveHand(recordHand(1));
    const api = fakeApi();
    const { rerender } = renderPanel(api);
    fireEvent.click(screen.getByText('#1'));
    expect(screen.getByText(/Replaying hand/)).toBeInTheDocument();
    rerender(<HistoryPanel active={false} getApi={() => api} />);
    expect(screen.queryByText(/Replaying hand/)).toBeNull();
  });
});
