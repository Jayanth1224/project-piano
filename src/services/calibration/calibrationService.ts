export interface PianoCalibration {
  xMin: number; // 0..1 (horizontal left edge)
  xMax: number; // 0..1 (horizontal right edge)
  yMin: number; // 0..1 (top edge)
  yMax: number; // 0..1 (bottom edge)
  depthReference: number; // Resting surface z coordinate (e.g. -0.035)
  pressOffset: number;    // Delta beyond surface to trigger press (e.g. -0.020)
  releaseOffset: number;  // Delta to release (e.g. -0.006)
  isCalibrated: boolean;
  updatedAt: number;
}

export const DEFAULT_CALIBRATION: PianoCalibration = {
  xMin: 0.04,
  xMax: 0.96,
  yMin: 0.58,
  yMax: 0.88,
  depthReference: -0.025,
  pressOffset: -0.020, // press at z <= -0.045
  releaseOffset: -0.005, // release at z >= -0.030
  isCalibrated: false,
  updatedAt: 0,
};

export const CALIBRATION_STORAGE_KEY = 'virtual_piano_calibration_v1';

export class CalibrationService {
  private storageKey: string;

  constructor(storageKey = CALIBRATION_STORAGE_KEY) {
    this.storageKey = storageKey;
  }

  /**
   * Load saved calibration from browser storage.
   * Falls back to default values if not found or corrupted.
   */
  loadCalibration(): PianoCalibration {
    if (typeof localStorage === 'undefined') {
      return { ...DEFAULT_CALIBRATION };
    }

    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return { ...DEFAULT_CALIBRATION };

      const parsed = JSON.parse(raw);
      if (
        typeof parsed.xMin === 'number' &&
        typeof parsed.xMax === 'number' &&
        typeof parsed.yMin === 'number' &&
        typeof parsed.yMax === 'number' &&
        typeof parsed.depthReference === 'number'
      ) {
        return {
          xMin: Math.max(0.01, Math.min(0.45, parsed.xMin)),
          xMax: Math.max(0.55, Math.min(0.99, parsed.xMax)),
          yMin: Math.max(0.20, Math.min(0.80, parsed.yMin)),
          yMax: Math.max(0.35, Math.min(0.99, parsed.yMax)),
          depthReference: parsed.depthReference,
          pressOffset: typeof parsed.pressOffset === 'number' ? parsed.pressOffset : -0.020,
          releaseOffset: typeof parsed.releaseOffset === 'number' ? parsed.releaseOffset : -0.006,
          isCalibrated: Boolean(parsed.isCalibrated),
          updatedAt: parsed.updatedAt || Date.now(),
        };
      }
      return { ...DEFAULT_CALIBRATION };
    } catch {
      return { ...DEFAULT_CALIBRATION };
    }
  }

  /**
   * Persist calibration to browser storage.
   */
  saveCalibration(calibration: PianoCalibration): boolean {
    if (typeof localStorage === 'undefined') return false;

    try {
      const payload: PianoCalibration = {
        ...calibration,
        isCalibrated: true,
        updatedAt: Date.now(),
      };
      localStorage.setItem(this.storageKey, JSON.stringify(payload));
      return true;
    } catch (err) {
      console.warn('Failed to save calibration to storage:', err);
      return false;
    }
  }

  /**
   * Clear saved calibration and reset to defaults.
   */
  resetCalibration(): PianoCalibration {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(this.storageKey);
      } catch (err) {
        console.warn('Failed to remove calibration from storage:', err);
      }
    }
    return { ...DEFAULT_CALIBRATION };
  }

  /**
   * Compute average resting depth from currently detected fingertips.
   * Discards extreme outliers to ensure stable surface baseline.
   */
  computeAverageFingertipDepth(fingertips: { z: number }[]): number {
    if (!fingertips || fingertips.length === 0) {
      return DEFAULT_CALIBRATION.depthReference;
    }

    if (fingertips.length === 1) {
      return fingertips[0].z;
    }

    // Sort z depths to extract median / trimmed mean
    const sorted = fingertips.map((f) => f.z).sort((a, b) => a - b);

    // If 4 or more fingers detected, trim the highest and lowest 1
    const trimmed =
      sorted.length >= 4 ? sorted.slice(1, sorted.length - 1) : sorted;

    const sum = trimmed.reduce((acc, val) => acc + val, 0);
    return sum / trimmed.length;
  }
}

export const calibrationService = new CalibrationService();
