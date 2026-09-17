import { useEffect } from 'react';
import { Header } from './Header';
import { ReadsPanel } from './ReadsPanel';
import { TableSetup } from './TableSetup';
import { SessionPanels } from './SessionPanels';

// Controlled from App, because the button that opens it lives in the Game moves
// heading — a different branch of the tree entirely.
export function SettingsModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div className={`modal-overlay${open ? ' open' : ''}`} id="settingsOverlay">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="modal-head">
          <div className="box-label">Settings</div>
          <button type="button" className="modal-close" aria-label="Close settings" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <Header />
          <p className="footnote">
            Opponents open by position from a percentile chart, then their range narrows by how much they bet and splits into value and bluff portions when they bet big. Your own cards block combos out of their range. Decisions are mixed, not fixed thresholds — the same spot won&apos;t always play the same way.
          </p>
          <TableSetup />
          <ReadsPanel />
          <SessionPanels />
        </div>
      </div>
    </div>
  );
}
