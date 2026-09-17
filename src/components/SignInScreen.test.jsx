import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SignInScreen } from './SignInScreen';

vi.mock('../engine/auth.js', () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  continueAsGuest: vi.fn(),
}));
const auth = await import('../engine/auth.js');

beforeEach(() => { vi.clearAllMocks(); });

function fill(email, password, name) {
  if (name !== undefined) {
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
  }
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}

describe('SignInScreen', () => {
  test('signs in and reports the user upward', async () => {
    auth.signIn.mockResolvedValue({ user: { id: 'u1' }, error: null });
    const onSignedIn = vi.fn();
    render(<SignInScreen onSignedIn={onSignedIn} onGuest={() => {}} />);
    fill('a@b.com', 'password123');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith({ id: 'u1' }));
  });

  test('shows the error and stays put when sign-in fails', async () => {
    auth.signIn.mockResolvedValue({ user: null, error: 'That email and password do not match.' });
    const onSignedIn = vi.fn();
    render(<SignInScreen onSignedIn={onSignedIn} onGuest={() => {}} />);
    fill('a@b.com', 'wrong');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('That email and password do not match.');
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  test('shows a readable error rather than freezing the form when signIn rejects', async () => {
    auth.signIn.mockRejectedValue(new TypeError('Failed to fetch'));
    const onSignedIn = vi.fn();
    render(<SignInScreen onSignedIn={onSignedIn} onGuest={() => {}} />);
    fill('a@b.com', 'password123');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Something went wrong. Try again.');
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled();
  });

  test('switches to create-account mode and calls signUp', async () => {
    auth.signUp.mockResolvedValue({ user: { id: 'u2' }, error: null, needsConfirmation: false });
    render(<SignInScreen onSignedIn={() => {}} onGuest={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Create one/ }));
    fill('new@b.com', 'password123', 'Ada Lovelace');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(auth.signUp).toHaveBeenCalledWith('new@b.com', 'password123', 'Ada Lovelace'));
  });

  test('tells the player to confirm their email when required', async () => {
    auth.signUp.mockResolvedValue({ user: { id: 'u2' }, error: null, needsConfirmation: true });
    const onSignedIn = vi.fn();
    render(<SignInScreen onSignedIn={onSignedIn} onGuest={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Create one/ }));
    fill('new@b.com', 'password123', 'Ada Lovelace');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByText(/Check your email/);
    // Not signed in yet -- there is no session until the link is clicked.
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  test('the Name field only appears in create-account mode', () => {
    render(<SignInScreen onSignedIn={() => {}} onGuest={() => {}} />);
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Create one/ }));
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Sign in/ }));
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });

  test('clears the name field when switching back to sign-in mode', () => {
    render(<SignInScreen onSignedIn={() => {}} onGuest={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Create one/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada Lovelace' } });
    fireEvent.click(screen.getByRole('button', { name: /Already have an account/ }));
    fireEvent.click(screen.getByRole('button', { name: /Create one/ }));
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });

  test('the bypass marks guest mode and reports upward', () => {
    const onGuest = vi.fn();
    render(<SignInScreen onSignedIn={() => {}} onGuest={onGuest} />);
    fireEvent.click(screen.getByRole('button', { name: /Skip for now/ }));
    expect(auth.continueAsGuest).toHaveBeenCalled();
    expect(onGuest).toHaveBeenCalled();
  });

  test('disables the submit button while the request is in flight', async () => {
    let resolve;
    auth.signIn.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<SignInScreen onSignedIn={() => {}} onGuest={() => {}} />);
    fill('a@b.com', 'password123');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Signing in/ })).toBeDisabled());
    resolve({ user: { id: 'u1' }, error: null });
  });
});
