import { useEffect } from 'react';

// #drift and #leak are written by the engine's renderDrift/renderLeak by id, so
// both live here permanently and the overlay is shown by class. The engine also
// sets data-tips on the wrapper, which is what swaps the empty state in and out.
export function TipsModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div className={`modal-overlay${open ? ' open' : ''}`} id="tipsOverlay">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-panel is-small" role="dialog" aria-modal="true" aria-label="Tips">
        <div className="modal-head">
          <div className="box-label">Tips</div>
          <button type="button" className="modal-close" aria-label="Close tips" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" id="tipsBox" data-tips="off">
          <div className="drift" id="drift" />
          <div className="leak" id="leak" />
          <p className="mini-note" id="tipsEmpty">
            Nothing to flag yet. Play a few more hands and anything that is costing you chips will show up here.
          </p>
        </div>
      </div>
    </div>
  );
}
