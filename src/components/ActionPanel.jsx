import { useState } from 'react';
import { HandsModal } from './HandsModal';
import { TipsModal } from './TipsModal';

// The betting controls themselves now live in the dock pinned to the bottom of
// the panel (see SidePanel). What stays here is the record of the hand: the
// running list of moves the engine appends to (#log), and the result card it
// flips to afterwards. The coaching notes are a click away behind the bulb.
export function ActionPanel({ onOpenSettings }) {
  const [handsOpen, setHandsOpen] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);

  // data-view is the engine's: "moves" while a hand runs, "result" once it is
  // over, and back to "moves" when Review is pressed. Both faces stay mounted,
  // so the engine can keep writing to #log and #handResult by id either way.
  return (
    <div className="panel-block" id="actionBox" data-view="moves" aria-labelledby="actionLabel">
      <div className="panel-head">
        <div className="box-label" id="actionLabel">Game moves</div>
        {/* Grouped in one box so a single auto margin pushes the pair to the
            right edge. An auto margin on each would split the free space
            between them and drive the two glyphs apart. */}
        <div className="panel-head-actions">
          {/* The engine adds .has-tips when drift or leak has something to say,
              which is the only thing that lifts this out of its dimmed state. */}
          <button
            type="button"
            className="panel-head-btn"
            id="btnTips"
            aria-label="Open tips"
            aria-haspopup="dialog"
            onClick={() => setTipsOpen(true)}
          >
            💡
          </button>
          <button
            type="button"
            className="panel-head-btn"
            id="btnHandBook"
            aria-label="Open the hand book"
            aria-haspopup="dialog"
            onClick={() => setHandsOpen(true)}
          >
            📖
          </button>
          <button
            type="button"
            className="panel-head-btn"
            id="btnSettings"
            aria-label="Open settings"
            aria-haspopup="dialog"
            onClick={onOpenSettings}
          >
            {/* U+FE0F forces the emoji cog. Bare U+2699 falls back to a text
                glyph that draws small inside its em box, so it came out half
                the size of the book however far the font-size was pushed. */}
            ⚙️
          </button>
        </div>
      </div>
      {/* The status line ("Your move in SB — 50 to call.") is off stage: the
          amount to call is already on the dock and the street is on the table.
          The element stays because the engine writes to #status every action. */}
      <div className="status status-hidden" id="status" aria-hidden="true" />
      {/* Move number, who acted, what they did. #log is the tbody the engine
          appends rows to; the scroll lives on the wrapper, since a tbody is not
          a scroll container. The placeholder carries a class so it is exempt
          from the live-move highlight — the engine clears it on the first move. */}
      <div className="log-scroll">
        <table className="log">
          <tbody id="log">
            <tr className="log-empty"><td colSpan={3}>No hands played yet.</td></tr>
          </tbody>
        </table>
      </div>
      {/* The other face: what the finished hand made or cost, and who took the
          pot. The engine fills it in as the hand concludes. */}
      <div className="hand-result" id="handResult" />
      <HandsModal open={handsOpen} onClose={() => setHandsOpen(false)} />
      <TipsModal open={tipsOpen} onClose={() => setTipsOpen(false)} />
    </div>
  );
}
