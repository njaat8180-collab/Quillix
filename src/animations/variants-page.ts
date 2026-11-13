// NUVRO AI Animation Variants - Page Transitions
// Page-level animations and theme transitions

import { Variants } from 'motion/react';
import { ANIMATION_CONFIG } from './config.js';

// Page Transition Variants
export const pageVariants: Variants = {
  initial: { opacity: 0, x: 20, scale: 0.98 },
  animate: { 
    opacity: 1, 
    x: 0, 
    scale: 1,
    transition: { type: 'spring', stiffness: 200, damping: 20 }
  },
  exit: { 
    opacity: 0, 
    x: -20, 
    scale: 0.98,
    transition: { duration: ANIMATION_CONFIG.duration.normal / 1000, ease: ANIMATION_CONFIG.easing.accelerate }
  },
};

export const pageFadeVariants: Variants = {
  initial: { opacity: 0 },
  animate: { 
    opacity: 1,
    transition: { duration: ANIMATION_CONFIG.duration.slow / 1000 }
  },
  exit: { 
    opacity: 0,
    transition: { duration: ANIMATION_CONFIG.duration.normal / 1000 }
  },
};

// Theme Transition
export const themeTransitionVariants: Variants = {
  initial: { opacity: 0.5, scale: 0.98 },
  animate: { 
    opacity: 1, 
    scale: 1,
    transition: { type: 'spring', stiffness: 200, damping: 20, duration: 0.5 }
  },
};