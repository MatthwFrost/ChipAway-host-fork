import { useEffect } from 'react';

// The engine writes the finished hand into #evReview by id, so this overlay is
// always mounted and merely shown or hidden by class. Conditional rendering
// would leave renderHandReview() writing into a node that no longer exists.
export function ReviewModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div className={`modal-overlay${open ? ' open' : ''}`} id="reviewOverlay">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label="Hand review">
        <div className="modal-head">
          <div className="box-label">Hand review</div>
          <button type="button" className="modal-close" aria-label="Close hand review" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div id="evReview" />
        </div>
      </div>
    </div>
  );
}
