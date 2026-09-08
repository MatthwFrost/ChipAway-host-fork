import { describe, expect, test } from 'vitest';
import { analyzeHandShape, describeShape, outsToEquity } from './handShape';

const c = (s) => ({ rank: '23456789TJQKA'.indexOf(s[0]) + 2, suit: s[1] });
const hand = (...xs) => xs.map(c);

describe('made hands', () => {
  test('top pair is named and counted as made-ish, not a draw', () => {
    // A♠K♦ on K♣7♥2♠ — top pair, top kicker
    const s = analyzeHandShape(hand('As', 'Kd'), hand('Kc', '7h', '2s'));
    expect(s.madeLabel).toBe('top pair');
    expect(s.usesHoleCards).toBe(true);
    expect(s.isMade).toBe(false);      // one pair is not a showdown-proof hand
  });

  test('a pair sitting on the board is not your pair', () => {
    const s = analyzeHandShape(hand('As', 'Qd'), hand('7c', '7h', '2s'));
    expect(s.madeLabel).toContain('everyone shares');
    expect(s.usesHoleCards).toBe(false);
  });

  test('an overpair is distinguished from top pair', () => {
    const s = analyzeHandShape(hand('Qs', 'Qd'), hand('Jc', '7h', '2s'));
    expect(s.madeLabel).toBe('an overpair');
  });

  test('two pair or better needs no draw talk', () => {
    const s = analyzeHandShape(hand('Kc', '7d'), hand('Kh', '7s', '2c'));
    expect(s.isMade).toBe(true);
    expect(s.isDrawing).toBe(false);
    expect(describeShape(s)).toBeNull();
  });
});

describe('draws', () => {
  test('a flush draw with an open-ended straight draw is a big draw with nothing made', () => {
    // 9♥8♥ on 7♥6♣2♥ — flush draw plus an open-ended straight draw
    const s = analyzeHandShape(hand('9h', '8h'), hand('7h', '6c', '2h'));
    expect(s.isDrawing).toBe(true);
    expect(s.isMade).toBe(false);
    expect(s.madeLabel).toBe('no pair');
    expect(s.flushOuts).toBe(9);          // nine hearts left
    expect(s.straightOuts).toBe(6);       // 5s and Ts that are not hearts
    expect(s.outs).toBe(15);              // counted once each, no double count
    expect(describeShape(s)).toContain('9 cards make the flush');
    expect(describeShape(s)).toContain('open-ended');
  });

  test('a gutshot is a small draw, not a big one', () => {
    // 9♠8♦ on 5♥6♣2♠ — only a 7 completes it
    const s = analyzeHandShape(hand('9s', '8d'), hand('5h', '6c', '2s'));
    expect(s.straightOuts).toBe(4);
    expect(s.flushOuts).toBe(0);
  });

  test('the river leaves nothing to draw to', () => {
    const s = analyzeHandShape(hand('9h', '8h'), hand('7h', '6c', '2h', 'Kd', '3s'));
    expect(s.cardsToCome).toBe(0);
    expect(s.outs).toBe(0);
    expect(s.isDrawing).toBe(false);
    expect(s.bricked).toBe(true);          // missed everything, nothing to show down
  });

  test('outs convert exactly, not by the rule of 4 which overshoots', () => {
    // 15 outs, two cards to come: 1 - (32/47)(31/46) = 54.1%, not the 60% the rule claims
    expect(outsToEquity(15, 2, 47)).toBeCloseTo(0.5412, 3);
    // 20 outs is where the rule of 4 goes badly wrong: 67%, not 80%
    expect(outsToEquity(20, 2, 47)).toBeCloseTo(0.6754, 3);
    // one card to come is simply outs over unseen
    expect(outsToEquity(15, 1, 46)).toBeCloseTo(15 / 46, 6);
    expect(outsToEquity(0, 2, 47)).toBe(0);
  });
});
