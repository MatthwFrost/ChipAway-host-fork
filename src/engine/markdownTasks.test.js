import { describe, expect, test } from 'vitest';
import { countTasks, setTaskAt } from './markdownTasks';

const DOC = [
  '# Things',
  '',
  '- [ ] first',
  '- [x] second',
  '- not a task',
  '  - [ ] nested',
  '',
  '1. [ ] numbered',
].join('\n');

describe('countTasks', () => {
  test('counts every task line and nothing else', () => {
    expect(countTasks(DOC)).toBe(4);
  });

  test('is safe on an empty or absent doc', () => {
    expect(countTasks('')).toBe(0);
    expect(countTasks(null)).toBe(0);
    expect(countTasks(undefined)).toBe(0);
  });

  test('ignores task-shaped lines inside a code fence, which marked renders as text', () => {
    const withCode = ['- [ ] real', '', '```sh', '- [ ] not real', '```', '', '- [ ] also real'].join('\n');
    expect(countTasks(withCode)).toBe(2);
  });
});

describe('setTaskAt', () => {
  test('ticks the nth box', () => {
    expect(setTaskAt(DOC, 0, true)).toContain('- [x] first');
  });

  test('unticks one that was ticked', () => {
    expect(setTaskAt(DOC, 1, false)).toContain('- [ ] second');
  });

  test('touches only the line it was asked for', () => {
    const out = setTaskAt(DOC, 0, true).split('\n');
    const before = DOC.split('\n');
    out.forEach((line, i) => {
      if (i !== 2) expect(line).toBe(before[i]);
    });
  });

  test('keeps the indent and the bullet style the author used', () => {
    expect(setTaskAt(DOC, 2, true)).toContain('  - [x] nested');
    expect(setTaskAt(DOC, 3, true)).toContain('1. [x] numbered');
  });

  test('counts past a code fence the same way the renderer does', () => {
    const withCode = ['- [ ] real', '', '```sh', '- [ ] not real', '```', '', '- [ ] also real'].join('\n');
    const out = setTaskAt(withCode, 1, true);
    expect(out).toContain('- [x] also real');
    // The line inside the fence is code, and stays exactly as written.
    expect(out).toContain('- [ ] not real');
  });

  test('returns null when there is no such task, rather than guessing', () => {
    expect(setTaskAt(DOC, 9, true)).toBeNull();
    expect(setTaskAt('# no tasks here', 0, true)).toBeNull();
  });

  test('leaves the text of the item alone, including brackets in it', () => {
    const tricky = '- [ ] fix the [link](http://x) and the [ ] literal';
    expect(setTaskAt(tricky, 0, true)).toBe('- [x] fix the [link](http://x) and the [ ] literal');
  });
});
