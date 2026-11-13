// NUVRO AI Animation Variants - Content
// Lists, messages, tabs, activities

import { Variants } from 'motion/react';
import { ANIMATION_CONFIG } from './config.js';

// Tab content
export const tabContentVariants: Variants = {
  hidden: { opacity: 0, x: 20 },
  visible: { 
    opacity: 1, 
    x: 0,
    transition: { duration: ANIMATION_CONFIG.duration.normal / 1000, ease: ANIMATION_CONFIG.easing.decelerate }
  },
  exit: { 
    opacity: 0, 
    x: -20,
    transition: { duration: ANIMATION_CONFIG.duration.fast / 1000, ease: ANIMATION_CONFIG.easing.accelerate }
  },
};

// List item
export const listItemVariants: Variants = {
  hidden: { opacity: 0, x: -20, height: 0 },
  visible: { 
    opacity: 1, 
    x: 0, 
    height: 'auto',
    transition: { 
      opacity: { duration: ANIMATION_CONFIG.duration.normal / 1000 },
      x: { type: 'spring', stiffness: 300, damping: 25 },
      height: { type: 'spring', stiffness: 300, damping: 25 }
    }
  },
  exit: { 
    opacity: 0, 
    x: 20, 
    height: 0,
    transition: { duration: ANIMATION_CONFIG.duration.normal / 1000, ease: ANIMATION_CONFIG.easing.accelerate }
  },
};

// Chat message
export const messageVariants: Variants = {
  hidden: { opacity: 0, y: 20, scale: 0.98 },
  visible: { 
    opacity: 1, 
    y: 0, 
    scale: 1,
    transition: { type: 'spring', stiffness: 260, damping: 20 }
  },
  exit: { 
    opacity: 0, 
    y: -10, 
    scale: 0.98,
    transition: { duration: ANIMATION_CONFIG.duration.fast / 1000, ease: ANIMATION_CONFIG.easing.accelerate }
  },
};

// Activity indicator
export const activityVariants: Variants = {
  idle: { scale: 1, opacity: 0.5 },
  active: { 
    scale: 1, 
    opacity: 1,
    transition: { type: 'spring', stiffness: 400, damping: 15 }
  },
  pulse: {
    scale: [1, 1.1, 1],
    opacity: [0.5, 1, 0.5],
    transition: { duration: 1.5, repeat: Infinity, ease: 'easeInOut' }
  },
};