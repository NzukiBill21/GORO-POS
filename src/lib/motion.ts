/**
 * Shared motion tokens for POS (enter = ease-out, exit = ease-in; transform/opacity only).
 */
export const motionDuration = {
  fast: 0.12,
  normal: 0.18,
} as const;

/** Enter: decelerate into place. Exit: accelerate out. */
export const motionEase = {
  enter: [0, 0, 0.2, 1] as const,
  exit: [0.4, 0, 1, 1] as const,
};

export const posProductTileMotion = {
  initial: { opacity: 0, scale: 0.97 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.97 },
  transition: { duration: motionDuration.fast, ease: motionEase.enter },
};

export const posCartLineMotion = {
  initial: { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12 },
  transition: { duration: motionDuration.fast, ease: motionEase.enter },
};
