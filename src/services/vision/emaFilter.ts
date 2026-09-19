import { type Point3D } from '../piano/keyEngine.ts';

/**
 * Exponential Moving Average (EMA) filter for 3D coordinates.
 * Formula: S_t = alpha * X_t + (1 - alpha) * S_{t-1}
 *
 * Alpha controls responsiveness vs smoothing:
 * - Alpha closer to 1: fast response, less smoothing
 * - Alpha closer to 0: heavy smoothing, more latency
 * Default alpha 0.45 strikes an optimal balance for fingertip tracking at 30-60 fps.
 */
export class EmaFilter3D {
  private history = new Map<string, Point3D>();
  private defaultAlpha: number;

  constructor(defaultAlpha = 0.45) {
    this.defaultAlpha = Math.max(0.01, Math.min(1.0, defaultAlpha));
  }

  /**
   * Filter a single 3D point for a given identifier.
   */
  filter(id: string, current: Point3D, alpha: number = this.defaultAlpha): Point3D {
    const safeAlpha = Math.max(0.01, Math.min(1.0, alpha));
    const previous = this.history.get(id);

    if (!previous) {
      const initial = { ...current };
      this.history.set(id, initial);
      return initial;
    }

    const smoothed: Point3D = {
      x: safeAlpha * current.x + (1 - safeAlpha) * previous.x,
      y: safeAlpha * current.y + (1 - safeAlpha) * previous.y,
      z: safeAlpha * current.z + (1 - safeAlpha) * previous.z,
    };

    this.history.set(id, smoothed);
    return smoothed;
  }

  /**
   * Get the last smoothed point for an identifier.
   */
  get(id: string): Point3D | null {
    return this.history.get(id) || null;
  }

  /**
   * Reset the filter state for a specific identifier.
   */
  reset(id: string): void {
    this.history.delete(id);
  }

  /**
   * Remove any tracked IDs not present in the active set.
   * Prevents stale entries when hands leave the camera frame.
   */
  prune(activeIds: Set<string>): void {
    for (const id of this.history.keys()) {
      if (!activeIds.has(id)) {
        this.history.delete(id);
      }
    }
  }

  /**
   * Clear all filter states.
   */
  clear(): void {
    this.history.clear();
  }
}

export const defaultEmaFilter = new EmaFilter3D(0.45);
