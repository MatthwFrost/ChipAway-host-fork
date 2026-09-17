import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { DevNotesScreen } from './DevNotesScreen';

const loadNotes = vi.fn();
const saveNotes = vi.fn();
vi.mock('../engine/devNotes', () => ({
  loadNotes: (...a) => loadNotes(...a),
  saveNotes: (...a) => saveNotes(...a),
  CONFLICT: 'Someone else saved changes since you opened this. Reload to see them — your text is kept below.',
}));

const DOC = {
  body: '# Things to change\n\n- [ ] Fix the rail\n- [x] Ship accounts\n',
  updatedAt: '2026-09-17T10:00:00.123456+00:00',
  updatedEmail: 'tom0706@outlook.com',
  error: null,
};

function click(el) {
  act(() => { el.click(); });
}

async function open(props = {}) {
  render(<DevNotesScreen active {...props} />);
  await waitFor(() => expect(screen.queryByText(/loading/i)).not.toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  loadNotes.mockResolvedValue({ ...DOC });
  saveNotes.mockResolvedValue({ ok: true, conflict: false, updatedAt: 'T2', updatedEmail: 'me@x.com', error: null });
});

describe('loading', () => {
  test('does not touch the network until the screen is actually opened', () => {
    render(<DevNotesScreen active={false} />);
    expect(loadNotes).not.toHaveBeenCalled();
  });

  test('loads once on first activation and not again on every re-render', async () => {
    const { rerender } = render(<DevNotesScreen active />);
    await waitFor(() => expect(loadNotes).toHaveBeenCalledTimes(1));
    rerender(<DevNotesScreen active />);
    rerender(<DevNotesScreen active={false} />);
    rerender(<DevNotesScreen active />);
    expect(loadNotes).toHaveBeenCalledTimes(1);
  });

  test('renders the markdown as markup, not as raw text', async () => {
    await open();
    expect(screen.getByRole('heading', { name: 'Things to change' })).toBeInTheDocument();
    expect(screen.queryByText(/^# Things/)).not.toBeInTheDocument();
  });

  test('shows who saved last', async () => {
    await open();
    expect(screen.getByText(/tom0706@outlook\.com/)).toBeInTheDocument();
  });

  test('shows the error when the load fails, with a way to try again', async () => {
    loadNotes.mockResolvedValue({ body: null, updatedAt: null, updatedEmail: null, error: 'This page is for admins only.' });
    await open();
    expect(screen.getByRole('alert')).toHaveTextContent('This page is for admins only.');
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
  });
});

describe('editing', () => {
  test('Edit puts the raw markdown in a textarea, not the rendered version', async () => {
    await open();
    click(screen.getByRole('button', { name: /^edit$/i }));
    expect(screen.getByRole('textbox')).toHaveValue(DOC.body);
  });

  test('saving sends the loaded timestamp back as the concurrency token', async () => {
    await open();
    click(screen.getByRole('button', { name: /^edit$/i }));
    const box = screen.getByRole('textbox');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(box, '# New body');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(saveNotes).toHaveBeenCalledWith('# New body', DOC.updatedAt));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'New body' })).toBeInTheDocument());
  });

  test('Cancel throws the draft away and goes back to the saved doc', async () => {
    await open();
    click(screen.getByRole('button', { name: /^edit$/i }));
    click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Things to change' })).toBeInTheDocument();
  });
});

describe('two admins at once', () => {
  test('a conflict warns, keeps your text, and does not leave edit mode', async () => {
    saveNotes.mockResolvedValue({ ok: false, conflict: true, updatedAt: null, updatedEmail: null, error: 'Someone else saved changes since you opened this.' });
    await open();
    click(screen.getByRole('button', { name: /^edit$/i }));
    click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/someone else saved/i));
    expect(screen.getByRole('textbox')).toHaveValue(DOC.body);
  });

  test('"keep mine" re-reads the doc and saves against the fresh timestamp', async () => {
    saveNotes.mockResolvedValueOnce({ ok: false, conflict: true, updatedAt: null, updatedEmail: null, error: 'conflict' });
    await open();
    click(screen.getByRole('button', { name: /^edit$/i }));
    click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    loadNotes.mockResolvedValue({ ...DOC, updatedAt: 'FRESH' });
    saveNotes.mockResolvedValue({ ok: true, conflict: false, updatedAt: 'T3', updatedEmail: 'me@x.com', error: null });
    click(screen.getByRole('button', { name: /keep mine/i }));
    await waitFor(() => expect(saveNotes).toHaveBeenLastCalledWith(DOC.body, 'FRESH'));
  });

  test('"load theirs" drops your draft and shows the saved doc', async () => {
    saveNotes.mockResolvedValue({ ok: false, conflict: true, updatedAt: null, updatedEmail: null, error: 'conflict' });
    await open();
    click(screen.getByRole('button', { name: /^edit$/i }));
    click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    loadNotes.mockResolvedValue({ ...DOC, body: '# Their version' });
    click(screen.getByRole('button', { name: /load theirs/i }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Their version' })).toBeInTheDocument());
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('sanitising', () => {
  test('strips a script tag out of the rendered doc', async () => {
    loadNotes.mockResolvedValue({ ...DOC, body: 'Hello <script>window.__pwned = 1;</script> world' });
    const { container } = render(<DevNotesScreen active />);
    await waitFor(() => expect(container.querySelector('.dev-notes-doc')).toBeInTheDocument());
    expect(container.querySelector('script')).toBeNull();
  });

  test('strips an inline event handler', async () => {
    loadNotes.mockResolvedValue({ ...DOC, body: '<img src="x" onerror="window.__pwned = 1">' });
    const { container } = render(<DevNotesScreen active />);
    await waitFor(() => expect(container.querySelector('.dev-notes-doc')).toBeInTheDocument());
    const img = container.querySelector('img');
    expect(img && img.getAttribute('onerror')).toBeFalsy();
  });
});
