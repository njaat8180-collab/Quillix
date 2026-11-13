import { StrictMode } from 'react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import App from './App.tsx';
import { ThemeProvider } from './theme.tsx';
import { AnimationLevelProvider, useAnimationLevel } from './animations/preferences.js';
import { QuillixErrorBoundary } from './components/CrashBoundary.tsx';
// Cascade contract: Tailwind/tokens and base styles first, Atlas product skin
// second, then production component overrides for the final shared UI layer.
import './index.css';
import './atlas.css';
import './production-ui.css';
import { loader } from '@monaco-editor/react';

loader.config({ paths: { vs: '/monaco/vs' } });

/** Applies the animation preference to all Motion components. CSS animations
 * and transitions are governed separately by the root data-animation-level. */
const MotionShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { level } = useAnimationLevel();
  return (
    <MotionConfig reducedMotion={level === 'full' ? 'user' : 'always'} skipAnimations={level === 'off'} transition={level === 'minimal' ? { duration: 0.12, ease: 'easeOut' } : undefined}>
      {children}
    </MotionConfig>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QuillixErrorBoundary>
      <ThemeProvider>
        <AnimationLevelProvider>
          <MotionShell>
            <App />
          </MotionShell>
        </AnimationLevelProvider>
      </ThemeProvider>
    </QuillixErrorBoundary>
  </StrictMode>,
);
