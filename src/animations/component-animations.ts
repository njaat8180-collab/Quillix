// NUVRO AI Component Animation Presets
// Ready-to-use animation configurations for specific components

import { Variants } from 'motion/react';
import {
  staggerContainerVariants,
  staggerContainerFastVariants,
  scaleSpringVariants,
  cardHoverVariants,
  fadeVariants,
  slideUpVariants,
  slideRightVariants,
  popoverVariants,
  messageVariants,
  toastVariants,
  scaleVariants,
  slideLeftVariants,
  tabContentVariants,
  slideDownVariants,
  listItemVariants,
  spinnerVariants,
  springEntranceVariants,
  elasticEntranceVariants,
  ambientGlowPulseVariants,
  ambientShimmerVariants,
  scrollRevealVariants,
  accordionVariants,
  tabSwitchVariants,
  progressRingVariants,
  streamingTextVariants,
  dragVariants,
  dropZoneVariants,
  notificationSlideVariants,
  notificationStackVariants,
  skeletonPulseVariants,
  skeletonWaveVariants,
  slideAndFadeVariants,
} from './index.js';

// ============================================================
// Component-Specific Animation Presets
// ============================================================

export const componentAnimations = {
  // Dashboard - enriched with ambient effects
  dashboard: {
    container: staggerContainerVariants,
    card: { ...cardHoverVariants, ...scaleVariants },
    stat: scaleSpringVariants,
    chart: fadeVariants,
    // New ambient additions
    hero: springEntranceVariants,
    particleBackground: {
      particles: {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 0.5, delay: 0.2 } }
      },
      orbs: {
        hidden: { opacity: 0, scale: 0.5 },
        visible: { opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 100, damping: 20, delay: 0.3 } }
      },
      grid: {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 0.5, delay: 0.4 } }
      },
    },
    sectionReveal: scrollRevealVariants,
    staggerChildren: staggerContainerVariants,
    glowPulse: ambientGlowPulseVariants,
    shimmer: ambientShimmerVariants,
  },

  // Chat
  chat: {
    message: messageVariants,
    messageList: staggerContainerFastVariants,
    typingIndicator: {
      hidden: { opacity: 0, scale: 0.8 },
      visible: {
        opacity: 1,
        scale: 1,
        transition: { type: 'spring', stiffness: 400, damping: 15 }
      },
    },
    composer: slideUpVariants,
    modeSelector: popoverVariants,
    // New
    streamingText: streamingTextVariants,
    approvalCard: springEntranceVariants,
    activityFeed: staggerContainerFastVariants,
    progressPanel: slideAndFadeVariants,
    resultCard: springEntranceVariants,
    commandCard: tabSwitchVariants,
    changedFiles: accordionVariants,
  },

  // File Tree
  fileTree: {
    container: staggerContainerFastVariants,
    folder: slideRightVariants,
    file: slideRightVariants,
    expand: {
      hidden: { opacity: 0, height: 0 },
      visible: {
        opacity: 1,
        height: 'auto',
        transition: { type: 'spring', stiffness: 300, damping: 25 }
      },
    },
    // New
    dragPreview: dragVariants,
    dropZone: dropZoneVariants,
  },

  // Settings
  settings: {
    panel: slideRightVariants,
    section: fadeVariants,
    tab: tabContentVariants,
    toggle: scaleSpringVariants,
    // New
    modal: { ...springEntranceVariants, ...tabSwitchVariants },
    providerCard: cardHoverVariants,
    themeSelector: { ...cardHoverVariants, ...scaleSpringVariants },
    apiHealthRow: slideUpVariants,
  },

  // Workbench
  workbench: {
    panel: slideRightVariants,
    divider: {
      idle: { backgroundColor: 'var(--border)' },
      hover: {
        backgroundColor: 'var(--accent)',
        transition: { duration: 0.15 }
      },
      dragging: { backgroundColor: 'var(--accent)' },
    },
    tab: {
      idle: { opacity: 0.7 },
      active: {
        opacity: 1,
        transition: { duration: 0.15 }
      },
      hover: {
        opacity: 0.9,
        transition: { duration: 0.15 }
      },
    },
    // New
    fileTreePanel: scrollRevealVariants,
    editorTabs: tabSwitchVariants,
    terminalPanel: slideUpVariants,
    sidebar: slideRightVariants,
    splitView: { ...dragVariants, ...dropZoneVariants },
  },

  // Terminal
  terminal: {
    line: slideUpVariants,
    cursor: {
      hidden: { opacity: 0 },
      visible: {
        opacity: 1,
        transition: { duration: 0.5, repeat: Infinity, repeatType: 'reverse' }
      },
    },
    output: fadeVariants,
    // New
    commandEntry: { ...slideUpVariants, ...streamingTextVariants },
    prompt: fadeVariants,
    history: staggerContainerFastVariants,
  },

  // Debugger
  debugger: {
    panel: slideUpVariants,
    breakpoint: scaleSpringVariants,
    callStack: staggerContainerFastVariants,
    variable: fadeVariants,
    // New
    watchExpression: slideUpVariants,
    scope: { ...accordionVariants, ...fadeVariants },
    callFrame: slideAndFadeVariants,
  },

  // Diff Viewer
  diff: {
    container: fadeVariants,
    hunk: slideLeftVariants,
    line: {
      added: { backgroundColor: 'rgba(52, 211, 153, 0.15)' },
      removed: { backgroundColor: 'rgba(248, 113, 113, 0.15)' },
    },
    // New
    fileHeader: slideAndFadeVariants,
    lineNumber: fadeVariants,
    inlineChange: { ...scaleSpringVariants, ...ambientShimmerVariants },
  },

  // Global Search
  search: {
    results: staggerContainerFastVariants,
    result: slideUpVariants,
    match: {
      hidden: { backgroundColor: 'transparent' },
      visible: {
        backgroundColor: 'var(--accent-soft)',
        transition: { duration: 0.15 }
      },
    },
    // New
    commandPalette: tabSwitchVariants,
    resultItem: cardHoverVariants,
    filter: fadeVariants,
  },

  // Notifications
  notification: {
    container: staggerContainerVariants,
    toast: toastVariants,
    bell: {
      idle: { rotate: 0 },
      notification: {
        rotate: [0, -15, 15, -10, 10, 0],
        transition: { duration: 0.5 }
      },
    },
    // New
    slide: notificationSlideVariants,
    stack: notificationStackVariants,
    progress: progressRingVariants,
  },

  // New component categories
  // Empty states
  emptyState: {
    container: fadeVariants,
    icon: elasticEntranceVariants,
    text: slideAndFadeVariants,
    action: scaleSpringVariants,
  },

  // Loading / skeleton states
  loading: {
    skeleton: { pulse: skeletonPulseVariants, wave: skeletonWaveVariants },
    progressRing: progressRingVariants,
    shimmer: ambientShimmerVariants,
    spinner: spinnerVariants,
  },

  // Onboarding / first run
  onboarding: {
    step: tabSwitchVariants,
    highlight: ambientGlowPulseVariants,
    tooltip: popoverVariants,
    progress: progressRingVariants,
  },
} as const;

// Type exports for consumers
export type ComponentAnimations = typeof componentAnimations;

export default componentAnimations;