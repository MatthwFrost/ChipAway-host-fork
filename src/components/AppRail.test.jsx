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
