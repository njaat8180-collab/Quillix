// Quillix Animation Variants - Interaction
// Buttons, inputs, cards, spinners, progress

import { Variants } from 'motion/react';
import { ANIMATION_CONFIG } from './config.js';

// Loading spinner
export const spinnerVariants: Variants = {
  initial: { rotate: 0 },
  animate: { 
    rotate: 360,
    transition: { duration: 1, repeat: Infinity, ease: 'linear' }
  },
};

// Progress bar
export const progressVariants: Variants = {
  hidden: { scaleX: 0 },
  visible: (progress: number) => ({ 
    scaleX: progress,
    transition: { type: 'spring', stiffness: 300, damping: 20 }
  }),
};

// Button press/tap
export const buttonTapVariants: Variants = {
  idle: { scale: 1 },
  hover: { scale: 1.02 },
  tap: { scale: 0.98 },
};

// Input focus
export const inputFocusVariants: Variants = {
  idle: { scale: 1, borderColor: 'var(--border)' },
  focus: { 
    scale: 1.005, 
    borderColor: 'var(--accent)',
    boxShadow: '0 0 0 3px var(--accent-soft)',
    transition: { type: 'spring', stiffness: 400, damping: 20 }
  },
};

// Card hover
export const cardHoverVariants: Variants = {
  idle: { y: 0, boxShadow: 'none' },
  hover: { 
    y: -2, 
    boxShadow: '0 6px 18px rgba(0, 0, 0, 0.08)',
    transition: { type: 'spring', stiffness: 300, damping: 20 }
  },
};