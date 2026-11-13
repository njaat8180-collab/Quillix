import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { QuillixAnimationLevel } from '../shared/types.js';
import { api } from '../services/apiBridge.js';

interface AnimationLevelContextValue {
  level: QuillixAnimationLevel;
  setLevel: (level: QuillixAnimationLevel) => void;
}

const AnimationLevelContext = createContext<AnimationLevelContextValue>({
  level: 'full',
  setLevel: () => {},
});

const FALLBACK_KEY = 'quillix_animation_level';

const LEVELS: QuillixAnimationLevel[] = ['full', 'minimal', 'off'];

export function readLocalAnimationLevel(): QuillixAnimationLevel {
  try {
    const value = localStorage.getItem(FALLBACK_KEY);
    if (value && (LEVELS as string[]).includes(value)) return value as QuillixAnimationLevel;
  } catch {
    // localStorage unavailable — fall through
  }
  return 'full';
}

export function applyAnimationLevel(level: QuillixAnimationLevel): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.animationLevel = level;
}

export const AnimationLevelProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [level, setLevelState] = useState<QuillixAnimationLevel>(() => {
    const initialLevel = readLocalAnimationLevel();
    applyAnimationLevel(initialLevel);
    return initialLevel;
  });

  // Sync with the persisted server settings once available (source of truth).
  useEffect(() => {
    let cancelled = false;
    api
      .getSettings()
      .then((res) => {
        if (!cancelled && res.success && res.settings?.animationLevel) {
          applyAnimationLevel(res.settings.animationLevel);
          setLevelState(res.settings.animationLevel);
        }
      })
      .catch(() => {
        // Server not reachable yet — local fallback already applied.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setLevel = useCallback((next: QuillixAnimationLevel) => {
    if (!(LEVELS as string[]).includes(next)) return;
    setLevelState(next);
    applyAnimationLevel(next);
    try {
      localStorage.setItem(FALLBACK_KEY, next);
    } catch {
      // ignore
    }
    // Persist server-side so the choice survives restarts.
    api.updateSettings({ animationLevel: next }).catch(() => {
      // Offline / Electron without settings handler — localStorage already saved it.
    });
  }, []);

  return <AnimationLevelContext.Provider value={{ level, setLevel }}>{children}</AnimationLevelContext.Provider>;
};

export function useAnimationLevel(): AnimationLevelContextValue {
  return useContext(AnimationLevelContext);
}

/** True when any animation should run (level !== 'off'). */
export function useAnimationEnabled(): boolean {
  return useAnimationLevel().level !== 'off';
}

export default AnimationLevelProvider;
