// NUVRO AI Animation Variants - Core
// Essential Framer Motion variants

import { Variants, Transition } from 'motion/react';
import { ANIMATION_CONFIG } from './config.js';

// ============================================================
// Helper: Check for reduced motion preference
// ============================================================

export function useReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Returns appropriate transition based on reduced motion preference
 */
export function getTransition(
  normalTransition: Transition,
  reducedTransition: Transition = ANIMATION_CONFIG.reducedMotion.transition,
  prefersReducedMotion: boolean = false
): Transition {
  return prefersReducedMotion ? reducedTransition : normalTransition;
}

/**
 * Creates stagger delay for index-based animations
 */
export function createStaggerDelay(index: number, baseDelay: number = ANIMATION_CONFIG.stagger.normal): number {
  return index * baseDelay;
}

/**
 * Creates a spring transition with custom params
 */
export function createSpringTransition(
  stiffness: number = 300,
  damping: number = 20,
  mass: number = 1
): Transition {
  return { type: 'spring', stiffness, damping, mass };
}

// ============================================================
// Core Animation Variants
// ============================================================

// Fade variants
export const fadeVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { 
    opacity: 1,
    transition: { duration: ANIMATION_CONFIG.duration.normal / 1000, ease: ANIMATION_CONFIG.easing.decelerate }
  },
  exit: { 
    opacity: 0,
    transition: { duration: ANIMATION_CONFIG.duration.fast / 1000, ease: ANIMATION_CONFIG.easing.accelerate }
  },
};

// Slide variants
export const slideUpVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { duration: ANIMATION_CONFIG.duration.normal / 1000, ease: ANIMATION_CONFIG.easing.decelerate }
  },
  exit: { 
    opacity: 0, 
    y: -10,
    transition: { duration: ANIMATION_CONFIG.duration.fast / 1000, ease: ANIMATION_CONFIG.easing.accelerate }
  },
};

export const slideDownVariants: Variants = {
  hidden: { opacity: 0, y: -20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { duration: ANIMATION_CONFIG.duration.normal / 1000, ease: ANIMATION_CONFIG.easing.decelerate }
  },
  exit: { 
    opacity: 0, 
    y: 10,
    transition: { duration: ANIMATION_CONFIG.duration.fast / 1000, ease: ANIMATION_CONFIG.easing.accelerate }
  },
};

export const slideLeftVariants: Variants = {
  hidden: { opacity: 0, x: 20 },
  visible: { 
    opacity: 1, 
    x: 0,
    transition: { duration: ANIMATION_CONFIG.duration.normal / 1000, ease: ANIMATION_CONFIG.easing.decelerate }
  },
  exit: { 
    opacity: 0, 
    x: -10,
    transition: { duration: ANIMATION_CONFIG.duration.fast / 1000, ease: ANIMATION_CONFIG.easing.accelerate }
  },
};

export const slideRightVariants: Variants = {
  hidden: { opacity: 0, x: -20 },
  visible: { 
    opacity: 1, 
    x: 0,
    transition: { duration: ANIMATION_CONFIG.duration.normal / 1000, ease: ANIMATION_CONFIG.easing.decelerate }
  },
  exit: { 
    opacity: 0, 
    x: 10,
    transition: { duration: ANIMATION_CONFIG.duration.fast / 1000, ease: ANIMATION_CONFIG.easing.accelerate }
  },
};

// Scale variants
export const scaleVariants: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { 
    opacity: 1, 
    scale: 1,
    transition: { duration: ANIMATION_CONFIG.duration.normal / 1000, ease: ANIMATION_CONFIG.easing.decelerate }
  },
  exit: { 
    opacity: 0, 
    scale: 0.95,
    transition: { duration: ANIMATION_CONFIG.duration.fast / 1000, ease: ANIMATION_CONFIG.easing.accelerate }
  },
};

export const scaleSpringVariants: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { 
    opacity: 1, 
    scale: 1,
    transition: ANIMATION_CONFIG.easing.spring.smooth
  },
  exit: { 
    opacity: 0, 
    scale: 0.9,
    transition: { duration: ANIMATION_CONFIG.duration.fast / 1000, ease: ANIMATION_CONFIG.easing.accelerate }
  },
};

// Container Variants (for staggering children)
export const staggerContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: ANIMATION_CONFIG.stagger.normal,
      delayChildren: 0.1,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      staggerChildren: ANIMATION_CONFIG.stagger.fast,
      staggerDirection: -1,
    },
  },
};

export const staggerContainerFastVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: ANIMATION_CONFIG.stagger.fast,
      delayChildren: 0.05,
    },
  },
};

export const staggerContainerSlowVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: ANIMATION_CONFIG.stagger.slow,
      delayChildren: 0.15,
    },
  },
};