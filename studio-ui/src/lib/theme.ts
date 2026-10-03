export type Theme = 'system' | 'light' | 'dark';

const KEY = 'lines-db-studio:theme';
const order: Theme[] = ['system', 'light', 'dark'];

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Not remembered, so as the system has it
  }
  return 'system';
}

export const nextTheme = (theme: Theme): Theme => order[(order.indexOf(theme) + 1) % order.length];

/** Mark the page with the theme, which the styles read; unmarked, they follow the system */
export function applyTheme(theme: Theme): void {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Not kept for the next visit, which then follows the system
  }
}
