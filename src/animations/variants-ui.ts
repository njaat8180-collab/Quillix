// QUILLIX Animation Variants - UI Components
// Modal, panels, popovers, toasts

import { Variants } from 'motion/react';
import { ANIMATION_CONFIG } from './config.js';

// Modal/Dialog
export const modalVariants: Variants = {
  hidden: { opacity: 0, scale: 0.9, y: 20 },
  visible: { 
    opacity: 1, 
    scale: 1, 
    y: 0,
    transition: { type: 'spring', stiffness: 300, damping: 25, duration: 0.4 }
  },
  exit: { 
    opacity: 0, 
    scale: 0.95, 
    y: 10,
    transition: { duration: ANIMATION_CONFIG.duration.fast / 1000, ease: ANIMATION_CONFIG.easing.accelerate }
  },
};

export const modalBackdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { 
    opacity: 1,
    transition: { duration: ANIMATION_CONFIG.duration.normal / 1000 }
  },
  exit: { 
    opacity: 0,
    transition: { duration: ANIMATION_CONFIG.duration.slow / 1000 }
  },
};

// Side panel / drawer
export const sidePanelVariants: Variants = {
  hidden: { opacity: 0, x: '100%' },
  visible: { 
    opacity: 1, 
    x: 0,
    transition: { type: 'spring', stiffness: 300, damping: 30 }
  },
  exit: { 
    opacity: 0, 
    x: '100%',
    transition: { duration: ANIMATION_CONFIG.duration.normal / 1000, ease: ANIMATION_CONFIG.easing.accelerate }
  },
};

export const sidePanelLeftVariants: Variants = {
  hidden: { opacity: 0, x: '-100%' },
  visible: { 
    opacity: 1, 
    x: 0,
    transition: { type: 'spring', stiffness: 300, damping: 30 }
  },
  exit: { 
    opacity: 0, 
    x: '-100%',
    transition: { duration: ANIMATION_CONFIG.duration.normal / 1000, ease: ANIMATION_CONFIG.easing.accelerate }
  },
};

// Tooltip / Popover
export const popoverVariants: Variants = {
  hidden: { opacity: 0, scale: 0.9, y: 8 },
  visible: { 
    opacity: 1, 
    scale: 1, 
    y: 0,
    transition: { type: 'spring', stiffness: 400, damping: 25 }
  },
  exit: { 
    opacity: 0, 
    scale: 0.9, 
    y: 4,
    transition: { duration: ANIMATION_CONFIG.duration.fast / 1000, ease: ANIMATION_CONFIG.easing.accelerate }
  },
};

// Toast / Notification
export const toastVariants: Variants = {
  hidden: { opacity: 0, x: 300, scale: 0.9 },
  visible: { 
    opacity: 1, 
    x: 0, 
    scale: 1,
    transition: { type: 'spring', stiffness: 400, damping: 25 }
  },
  exit: { 
    opacity: 0, 
    x: 300, 
    scale: 0.9,
    transition: { duration: ANIMATION_CONFIG.duration.normal / 1000, ease: ANIMATION_CONFIG.easing.accelerate }
  },
};

// Command palette
export const commandPaletteVariants: Variants = {
  hidden: { opacity: 0, scale: 0.95, y: -20 },
  visible: { 
    opacity: 1, 
    scale: 1, 
    y: 0,
    transition: { type: 'spring', stiffness: 300, damping: 25 }
  },
  exit: { 
    opacity: 0, 
    scale: 0.95, 
    y: -10,
    transition: { duration: ANIMATION_CONFIG.duration.fast / 1000, ease: ANIMATION_CONFIG.easing.accelerate }
  },
};