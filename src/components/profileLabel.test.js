import { describe, expect, test } from 'vitest';
import { avatarInitial, profileLabel } from './profileLabel';

describe('profileLabel', () => {
  test('prefers the display name once it has loaded', () => {
    expect(profileLabel({ email: 'a@b.com' }, 'Matty')).toBe('Matty');
  });

  test('falls back to the email while the name is still loading', () => {
    // The email is on the user object from the first render; display_name
    // needs a round trip, so this is what fills the gap.
    expect(profileLabel({ email: 'a@b.com' }, null)).toBe('a@b.com');
  });

  test('treats a whitespace-only name as no name at all', () => {
    expect(profileLabel({ email: 'a@b.com' }, '   ')).toBe('a@b.com');
  });

  test('trims a name that has room around it', () => {
    expect(profileLabel({ email: 'a@b.com' }, '  Matty  ')).toBe('Matty');
  });

  test('calls a signed-out player Guest, whatever else is passed', () => {
    expect(profileLabel(null, 'Matty')).toBe('Guest');
    expect(profileLabel(null, null)).toBe('Guest');
  });

  test('falls through to Guest for a user with no email', () => {
    expect(profileLabel({}, null)).toBe('Guest');
  });
});

describe('avatarInitial', () => {
  test('is the first letter, upper-cased', () => {
    expect(avatarInitial('matty')).toBe('M');
    expect(avatarInitial('a@b.com')).toBe('A');
  });

  test('skips leading whitespace rather than rendering a blank square', () => {
    expect(avatarInitial('  matty')).toBe('M');
  });

  test('never renders empty — an empty avatar looks broken', () => {
    expect(avatarInitial('')).toBe('G');
    expect(avatarInitial('   ')).toBe('G');
    expect(avatarInitial(null)).toBe('G');
  });
});
