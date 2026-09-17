import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { loadNotes, saveNotes } from '../engine/devNotes';

/* ============================================================
   DEV NOTES — the shared change list, rendered.

   An internal page, not a player feature: the rail only draws its row for the
   two admin accounts, and public.dev_notes only answers to them (see
   supabase/migrations/0003_dev_notes.sql). Everything on screen is one
   markdown document with two authors.

   The screen owns "am I reading or writing, and is my copy stale"; devNotes.js
   owns the wire. Nothing here talks to supabase-js directly, the same split
   every other panel in this app keeps.
   ============================================================ */

// gfm for the one feature this doc is actually made of: - [ ] task lists.
// headerIds off because nothing links into this page and the generated ids
// would collide with the app's own.
marked.setOptions({ gfm: true, headerIds: false, mangle: false });

// marked hands back an HTML string, which has to go in through
// dangerouslySetInnerHTML -- so it is sanitised on the way. Only the two of us
// can write this doc today, but "the only author is trustworthy" is a property
// of the current RLS policy, not of this component, and the day that changes
// nobody will remember to come back here.
function toHtml(markdown) {
  return DOMPurify.sanitize(marked.parse(markdown || ''));
}

// Display only. Never fed back to saveNotes -- that takes the untouched string
// from the server, because a round trip through Date drops the microseconds
// the concurrency match depends on.
function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function Meta({ updatedAt, updatedEmail }) {
  if (!updatedEmail && !updatedAt) return null;
  return (
    <p className="dev-notes-meta">
      Last saved by {updatedEmail || 'someone'}
      {updatedAt ? ` · ${when(updatedAt)}` : ''}
    </p>
  );
}

export function DevNotesScreen({ active = false }) {
  const [status, setStatus] = useState('idle');
  const [doc, setDoc] = useState({ body: '', updatedAt: null, updatedEmail: null });
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  // Fetched on first activation rather than on mount: this screen is mounted
  // for the whole session like every other one (CSS decides which is visible),
  // and there is no reason to spend a request on a page that may never be
  // opened.
  const openedRef = useRef(false);

  const fetchDoc = useCallback(async () => {
    setBusy(true);
    const res = await loadNotes();
    setBusy(false);
    if (res.error) {
      setError(res.error);
      setStatus('error');
      return null;
    }
    setDoc({ body: res.body, updatedAt: res.updatedAt, updatedEmail: res.updatedEmail });
    setStatus('ready');
    setError(null);
    return res;
  }, []);

  useEffect(() => {
    if (!active || openedRef.current) return;
    openedRef.current = true;
    setStatus('loading');
    fetchDoc();
  }, [active, fetchDoc]);

  const html = useMemo(() => toHtml(doc.body), [doc.body]);

  const startEditing = useCallback(() => {
    setDraft(doc.body);
    setEditing(true);
    setError(null);
    setConflict(false);
  }, [doc.body]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setDraft('');
    setError(null);
    setConflict(false);
  }, []);

  // token is the updated_at this copy was loaded with. A failed save leaves
  // editing true and the draft untouched on purpose: the warning is worthless
  // if it costs you the paragraph you just wrote.
  const commit = useCallback(async (token) => {
    setBusy(true);
    setError(null);
    const res = await saveNotes(draft, token);
    setBusy(false);
    if (!res.ok) {
      setConflict(Boolean(res.conflict));
      setError(res.error);
      return;
    }
    setDoc({ body: draft, updatedAt: res.updatedAt, updatedEmail: res.updatedEmail });
    setConflict(false);
    setEditing(false);
    setDraft('');
  }, [draft]);

  const save = useCallback(() => commit(doc.updatedAt), [commit, doc.updatedAt]);

  // Deliberately overwrite: re-read to get a current token, then save the
  // draft against it. The other admin's text goes, which is why this is a
  // button you have to press and not what a plain Save does.
  const keepMine = useCallback(async () => {
    const fresh = await fetchDoc();
    if (!fresh) return;
    await commit(fresh.updatedAt);
  }, [commit, fetchDoc]);

  const loadTheirs = useCallback(async () => {
    const fresh = await fetchDoc();
    if (!fresh) return;
    setEditing(false);
    setDraft('');
    setConflict(false);
    setError(null);
  }, [fetchDoc]);

  return (
    <section className="dev-notes" aria-label="Dev notes">
      <header className="dev-notes-head">
        <div>
          <h2 className="dev-notes-title">Dev notes</h2>
          <Meta updatedAt={doc.updatedAt} updatedEmail={doc.updatedEmail} />
        </div>
        <div className="dev-notes-actions">
          {status === 'ready' && !editing && (
            <button type="button" className="btn-primary" onClick={startEditing}>Edit</button>
          )}
          {editing && (
            <>
              <button type="button" className="dev-notes-cancel" onClick={cancelEditing} disabled={busy}>Cancel</button>
              <button type="button" className="btn-primary" onClick={save} disabled={busy}>Save</button>
            </>
          )}
        </div>
      </header>

      {status === 'loading' && <p className="dev-notes-empty">Loading…</p>}

      {error && (
        <div className="dev-notes-alert" role="alert">
          <p>{error}</p>
          {conflict && (
            <div className="dev-notes-alert-actions">
              <button type="button" onClick={keepMine} disabled={busy}>Keep mine</button>
              <button type="button" onClick={loadTheirs} disabled={busy}>Load theirs</button>
            </div>
          )}
          {status === 'error' && !conflict && (
            <div className="dev-notes-alert-actions">
              <button type="button" onClick={fetchDoc} disabled={busy}>Try again</button>
            </div>
          )}
        </div>
      )}

      {status === 'ready' && !editing && (
        // Sanitised at the top of this file. The doc is markdown the two of us
        // wrote, so it renders as a document rather than as app furniture.
        <article className="dev-notes-doc" dangerouslySetInnerHTML={{ __html: html }} />
      )}

      {editing && (
        <textarea
          className="dev-notes-edit"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck="false"
          aria-label="Dev notes markdown"
        />
      )}
    </section>
  );
}
