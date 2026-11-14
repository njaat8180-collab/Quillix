import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { QuillixTheme } from './shared/types.js';
import { api } from './services/apiBridge.js';

interface ThemeContextValue {
  theme: QuillixTheme;
  setTheme: (theme: QuillixTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'dark', setTheme: () => {} });

const FALLBACK_KEY = 'quillix_theme';

function readLocalTheme(): QuillixTheme {
  try {
    const value = localStorage.getItem(FALLBACK_KEY);
    if (value === 'light' || value === 'dark' || value === 'gray' || value === 'gradient') return value;
  } catch {
    // localStorage unavailable — fall through
  }
  return 'dark';
}

function applyThemeClass(theme: QuillixTheme): void {
  const root = document.documentElement;
  root.classList.remove('theme-light', 'theme-dark', 'theme-gray', 'theme-gradient');
  root.classList.add(`theme-${theme}`);
  root.dataset.theme = theme;
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<QuillixTheme>(() => readLocalTheme());

  // Apply immediately on mount and whenever the theme changes.
  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  // Sync with the persisted server settings once available (source of truth).
  useEffect(() => {
    let cancelled = false;
    api
      .getSettings()
      .then((res) => {
        if (!cancelled && res.success && res.settings?.theme) {
          setThemeState(res.settings.theme);
        }
      })
      .catch(() => {
        // Server not reachable yet — local fallback already applied.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setTheme = useCallback((next: QuillixTheme) => {
    setThemeState(next);
    applyThemeClass(next);
    try {
      localStorage.setItem(FALLBACK_KEY, next);
    } catch {
      // ignore
    }
    // Persist server-side so the theme survives restarts on any device.
    api.updateSettings({ theme: next }).catch(() => {
      // Offline / Electron without settings handler — localStorage already saved it.
    });
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
