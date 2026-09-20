import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CalibrationService,
  DEFAULT_CALIBRATION,
  type PianoCalibration,
} from '../src/services/calibration/calibrationService.ts';

// Simple mock storage for Node environment
class MockLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) || null;
  }
  setItem(key: string, val: string): void {
    this.store.set(key, val);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

test('calibrationService - returns default calibration when uncalibrated', () => {
  const service = new CalibrationService('test_key_1');
  const cal = service.loadCalibration();
  assert.equal(cal.isCalibrated, false);
  assert.equal(cal.xMin, DEFAULT_CALIBRATION.xMin);
  assert.equal(cal.xMax, DEFAULT_CALIBRATION.xMax);
  assert.equal(cal.depthReference, DEFAULT_CALIBRATION.depthReference);
});

test('calibrationService - computes average resting depth with outlier rejection', () => {
  const service = new CalibrationService('test_key_2');

  // 5 fingers: one extreme outlier (-0.20), four resting around -0.040
  const fingertips = [
    { z: -0.20 }, // outlier (hand twitch)
    { z: -0.038 },
    { z: -0.040 },
    { z: -0.042 },
    { z: 0.05 },  // outlier (finger lifted high)
  ];

  const depth = service.computeAverageFingertipDepth(fingertips);
  // Trimmed mean of [-0.042, -0.040, -0.038] should be exactly -0.040
  assert.ok(Math.abs(depth - -0.040) < 0.001, `Expected ~ -0.040, got ${depth}`);
});

test('calibrationService - saves, loads, and resets calibration', () => {
  // Install mock localStorage globally for this test
  const original = (globalThis as unknown as { localStorage: unknown }).localStorage;
  (globalThis as unknown as { localStorage: unknown }).localStorage = new MockLocalStorage();

  try {
    const service = new CalibrationService('test_piano_cal');

    const customCal: PianoCalibration = {
      xMin: 0.10,
      xMax: 0.90,
      yMin: 0.60,
      yMax: 0.92,
      depthReference: -0.055,
      pressOffset: -0.015,
      releaseOffset: -0.005,
      isCalibrated: true,
      updatedAt: 12345,
    };

    const saved = service.saveCalibration(customCal);
    assert.equal(saved, true);

    const loaded = service.loadCalibration();
    assert.equal(loaded.isCalibrated, true);
    assert.equal(loaded.xMin, 0.10);
    assert.equal(loaded.xMax, 0.90);
    assert.equal(loaded.depthReference, -0.055);

    const reset = service.resetCalibration();
    assert.equal(reset.isCalibrated, false);
    assert.equal(reset.depthReference, DEFAULT_CALIBRATION.depthReference);

    const reloaded = service.loadCalibration();
    assert.equal(reloaded.isCalibrated, false);
  } finally {
    (globalThis as unknown as { localStorage: unknown }).localStorage = original;
  }
});
