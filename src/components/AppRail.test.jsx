import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppRail } from './AppRail';

describe('AppRail profile row', () => {
  test('shows the display name when one is present', () => {
    render(<AppRail user={{ email: 'a@b.com' }} displayName="Ada Lovelace" onSignOut={() => {}} />);
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByText('a@b.com')).not.toBeInTheDocument();
  });

  test('falls back to the email when no display name has arrived yet', () => {
    render(<AppRail user={{ email: 'a@b.com' }} displayName={null} onSignOut={() => {}} />);
    expect(screen.getByText('a@b.com')).toBeInTheDocument();
  });

  test('falls back to Guest with no user at all', () => {
    render(<AppRail user={null} displayName={null} onLeaveGuest={() => {}} />);
    expect(screen.getByText('Guest')).toBeInTheDocument();
  });

  test('the avatar letter comes from whatever is being displayed', () => {
    render(<AppRail user={{ email: 'a@b.com' }} displayName="Zara" onSignOut={() => {}} />);
    expect(screen.getByText('Z')).toBeInTheDocument();
  });

  test('clicking the profile row signs out a real user', () => {
    const onSignOut = vi.fn();
    render(<AppRail user={{ email: 'a@b.com' }} displayName="Ada" onSignOut={onSignOut} />);
    screen.getByText('Ada').closest('button').click();
    expect(onSignOut).toHaveBeenCalled();
  });
});

describe('AppRail dev notes row', () => {
  test('is absent for an ordinary player', () => {
    render(<AppRail user={{ email: 'player@example.com' }} onSignOut={() => {}} />);
    expect(screen.queryByText('Dev notes')).not.toBeInTheDocument();
  });

  test('is absent for a guest', () => {
    render(<AppRail user={null} onLeaveGuest={() => {}} />);
    expect(screen.queryByText('Dev notes')).not.toBeInTheDocument();
  });

  test('is drawn for an admin and navigates to the notes screen', () => {
    const onNavigate = vi.fn();
    render(<AppRail user={{ email: 'a@b.com' }} admin onNavigate={onNavigate} onSignOut={() => {}} />);
    const row = screen.getByText('Dev notes').closest('button');
    row.click();
    expect(onNavigate).toHaveBeenCalledWith('notes');
  });

  test('marks itself as the current page on the notes screen', () => {
    render(<AppRail user={{ email: 'a@b.com' }} admin screen="notes" onSignOut={() => {}} />);
    expect(screen.getByText('Dev notes').closest('button')).toHaveAttribute('aria-current', 'page');
  });
});
