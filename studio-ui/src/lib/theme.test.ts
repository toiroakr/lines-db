import { describe, it, expect, beforeEach } from 'vitest';
import { applyTheme, nextTheme, readTheme } from './theme';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('follows the system until one is chosen', () => {
    expect(readTheme()).toBe('system');
  });

  it('goes from the system to light, to dark, and back to the system', () => {
    expect([nextTheme('system'), nextTheme('light'), nextTheme('dark')]).toEqual(['light', 'dark', 'system']);
  });

  it('marks the page with a theme chosen, and keeps it for the next visit', () => {
    applyTheme('dark');

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(readTheme()).toBe('dark');
  });

  it('leaves the page unmarked when following the system again', () => {
    applyTheme('dark');
    applyTheme('system');

    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(readTheme()).toBe('system');
  });
});
