import { useEffect } from 'react';
import { HAND_NAMES } from '../engine/evaluator';

// Names come from the evaluator so this reference cannot drift from what the
// engine actually calls a hand. The extras are indexed to match HAND_NAMES,
// which runs weakest to strongest -- the book reads the other way round.
const DETAIL = [
  { blurb: 'Nothing matches. Your highest card plays.', cards: 'A♠ J♥ 8♦ 5♣ 2♠' },
  { blurb: 'Two cards of the same rank.', cards: 'K♠ K♥ 9♦ 6♣ 3♠' },
  { blurb: 'Two different pairs.', cards: 'Q♠ Q♥ 7♦ 7♣ 4♠' },
  { blurb: 'Three of the same rank. Also called trips, or a set when two of them are your own cards.', cards: 'J♠ J♥ J♦ 8♣ 3♠' },
  { blurb: 'Five in a row, suits do not matter. The ace can start it or end it.', cards: '9♠ 8♥ 7♦ 6♣ 5♠' },
  { blurb: 'Five of the same suit, in any order.', cards: 'A♥ J♥ 8♥ 5♥ 2♥' },
  { blurb: 'Three of a kind and a pair at once.', cards: 'T♠ T♥ T♦ 4♣ 4♠' },
  { blurb: 'All four of a rank.', cards: '7♠ 7♥ 7♦ 7♣ K♠' },
  { blurb: 'Five in a row, all one suit. Ace-high is the royal flush.', cards: 'Q♦ J♦ T♦ 9♦ 8♦' },
];

const HANDS = HAND_NAMES.map((name, i) => ({ name, ...DETAIL[i] })).reverse();

export function HandsModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div className={`modal-overlay${open ? ' open' : ''}`} id="handsOverlay">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label="Poker hands">
        <div className="modal-head">
          <div className="box-label">Hands — strongest first</div>
          <button type="button" className="modal-close" aria-label="Close the hand book" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <ol className="hand-book">
            {HANDS.map(({ name, blurb, cards }) => (
              <li className="hand-book-row" key={name}>
                <div className="hand-book-name">{name}</div>
                <div className="hand-book-cards">
                  {cards.split(' ').map((card) => (
                    <span key={card} className={/[♥♦]/.test(card) ? 'hb-red' : undefined}>{card}</span>
                  ))}
                </div>
                <div className="hand-book-blurb">{blurb}</div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
