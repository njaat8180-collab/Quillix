// NUVRO AI Motion Props Helpers
// Pre-configured motion props for common patterns

import { HTMLMotionProps } from 'motion/react';
import { 
  fadeVariants, 
  slideUpVariants, 
  scaleVariants, 
  modalVariants, 
  sidePanelVariants, 
  staggerContainerVariants,
  listItemVariants,
  messageVariants,
} from './index.js';

// ============================================================
// Motion Props Helpers
// ============================================================

/**
 * Standard motion props for simple fade-in elements
 */
export const motionFadeIn: HTMLMotionProps<'div'> = {
  initial: 'hidden',
  animate: 'visible',
  exit: 'exit',
  variants: fadeVariants,
};

/**
 * Standard motion props for slide-up elements
 */
export const motionSlideUp: HTMLMotionProps<'div'> = {
  initial: 'hidden',
  animate: 'visible',
  exit: 'exit',
  variants: slideUpVariants,
};

/**
 * Standard motion props for scale elements
 */
export const motionScale: HTMLMotionProps<'div'> = {
  initial: 'hidden',
  animate: 'visible',
  exit: 'exit',
  variants: scaleVariants,
};

/**
 * Standard motion props for modal elements
 */
export const motionModal: HTMLMotionProps<'div'> = {
  initial: 'hidden',
  animate: 'visible',
  exit: 'exit',
  variants: modalVariants,
};

/**
 * Standard motion props for side panels
 */
export const motionSidePanel: HTMLMotionProps<'div'> = {
  initial: 'hidden',
  animate: 'visible',
  exit: 'exit',
  variants: sidePanelVariants,
};

/**
 * Standard motion props for list containers
 */
export const motionStaggerContainer: HTMLMotionProps<'div'> = {
  initial: 'hidden',
  animate: 'visible',
  exit: 'exit',
  variants: staggerContainerVariants,
};

/**
 * Standard motion props for list items
 */
export const motionListItem: HTMLMotionProps<'li'> = {
  variants: listItemVariants,
};

/**
 * Standard motion props for chat messages
 */
export const motionMessage: HTMLMotionProps<'div'> = {
  initial: 'hidden',
  animate: 'visible',
  exit: 'exit',
  variants: messageVariants,
};

/**
 * Motion props for page transitions
 */
export const motionPage: HTMLMotionProps<'div'> = {
  initial: 'initial',
  animate: 'animate',
  exit: 'exit',
  variants: {
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
      transition: { duration: 0.25 }
    },
  },
};

export default {
  motionFadeIn,
  motionSlideUp,
  motionScale,
  motionModal,
  motionSidePanel,
  motionStaggerContainer,
  motionListItem,
  motionMessage,
  motionPage,
};