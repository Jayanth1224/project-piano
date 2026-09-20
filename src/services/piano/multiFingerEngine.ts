import { type PianoKey, getKeyAtCoordinate } from './pianoModel.ts';
import { type Point3D, type KeyState } from './keyEngine.ts';
import { EmaFilter3D } from '../vision/emaFilter.ts';
import { type PianoCalibration } from '../calibration/calibrationService.ts';

export type HandSide = 'Left' | 'Right';
export type FingerName = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';

export interface FingertipInput {
  id: string; // e.g. "Left_index", "Right_thumb"
  handSide: HandSide;
  fingerName: FingerName;
  rawPosition: Point3D;
  mcpPosition?: Point3D; // Knuckle position for relative arch/lift detection
}

export interface FingerState {
  id: string;
  handSide: HandSide;
  fingerName: FingerName;
  state: KeyState;
  currentKey: PianoKey | null;
  pressedKey: PianoKey | null;
  rawPosition: Point3D;
  smoothedPosition: Point3D;
  mcpPosition?: Point3D;
  relativeZ: number;
  isLifted: boolean;
  depthRatio: number;
  velocity: number;
}

export interface NoteTrigger {
  note: string;
  velocity: number;
}

export interface MultiFingerFrameResult {
  fingers: Map<string, FingerState>;
  notesToTrigger: NoteTrigger[];
  notesToRelease: string[];
  activeKeys: PianoKey[];
  pressedKeys: PianoKey[];
}

export interface KeyboardArea {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export const DEFAULT_KEYBOARD_AREA: KeyboardArea = {
  xMin: 0.05,
  xMax: 0.95,
  yMin: 0.55,
  yMax: 0.90,
};

interface InternalFingerTracker {
  id: string;
  handSide: HandSide;
  fingerName: FingerName;
  state: KeyState;
  currentKey: PianoKey | null;
  pressedKey: PianoKey | null;
  previousZ: number | null;
  previousTime: number;
}

export class MultiFingerEngine {
  private trackers = new Map<string, InternalFingerTracker>();
  private emaFilter = new EmaFilter3D(0.45);
  private pressDepthThreshold = -0.045;
  private releaseDepthThreshold = -0.020;
  private keyboardArea: KeyboardArea;

  constructor(
    keyboardArea: KeyboardArea = DEFAULT_KEYBOARD_AREA,
    pressThreshold = -0.045,
    releaseThreshold = -0.020
  ) {
    this.keyboardArea = { ...keyboardArea };
    this.pressDepthThreshold = pressThreshold;
    this.releaseDepthThreshold = releaseThreshold;
  }

  setThresholds(press: number, release: number): void {
    this.pressDepthThreshold = press;
    this.releaseDepthThreshold = release;
  }

  setKeyboardArea(area: Partial<KeyboardArea>): void {
    this.keyboardArea = { ...this.keyboardArea, ...area };
  }

  applyCalibration(calibration: PianoCalibration): void {
    this.keyboardArea = {
      xMin: calibration.xMin,
      xMax: calibration.xMax,
      yMin: calibration.yMin,
      yMax: calibration.yMax,
    };
    this.pressDepthThreshold = calibration.depthReference + calibration.pressOffset;
    this.releaseDepthThreshold = calibration.depthReference + calibration.releaseOffset;
  }

  getThresholds(): { press: number; release: number } {
    return { press: this.pressDepthThreshold, release: this.releaseDepthThreshold };
  }

  getKeyboardArea(): KeyboardArea {
    return { ...this.keyboardArea };
  }

  /**
   * Process all currently detected fingertips in the frame against the 88-key model.
   * Emits batch notes to trigger and notes to release.
   */
  processFrame(
    fingertipInputs: FingertipInput[],
    keys: PianoKey[],
    timestamp: number = performance.now()
  ): MultiFingerFrameResult {
    const activeFingerIds = new Set(fingertipInputs.map((f) => f.id));
    this.emaFilter.prune(activeFingerIds);

    const notesToTriggerMap = new Map<string, number>(); // note -> max velocity
    const notesToReleaseSet = new Set<string>();
    const fingerStates = new Map<string, FingerState>();

    // 1. Check for fingers that vanished this frame: release their held notes
    for (const [id, tracker] of this.trackers.entries()) {
      if (!activeFingerIds.has(id)) {
        if (tracker.pressedKey) {
          notesToReleaseSet.add(tracker.pressedKey.id);
        }
        this.trackers.delete(id);
      }
    }

    // 2. Process all currently present fingertips
    for (const input of fingertipInputs) {
      let tracker = this.trackers.get(input.id);
      if (!tracker) {
        tracker = {
          id: input.id,
          handSide: input.handSide,
          fingerName: input.fingerName,
          state: 'IDLE',
          currentKey: null,
          pressedKey: null,
          previousZ: null,
          previousTime: timestamp,
        };
        this.trackers.set(input.id, tracker);
      }

      const smoothed = this.emaFilter.filter(input.id, input.rawPosition);
      const dt = Math.max(1, timestamp - tracker.previousTime);
      tracker.previousTime = timestamp;

      // Estimate velocity from z downward delta
      let velocity = 0.8;
      if (tracker.previousZ !== null && dt > 0) {
        const dz = tracker.previousZ - smoothed.z;
        if (dz > 0) {
          velocity = Math.max(0.3, Math.min(1.0, 0.4 + (dz / dt) * 50));
        }
      }
      tracker.previousZ = smoothed.z;

      // Depth ratio [0..1]
      const totalDepthRange = this.releaseDepthThreshold - this.pressDepthThreshold;
      const depthFromRelease = this.releaseDepthThreshold - smoothed.z;
      const depthRatio = Math.max(
        0,
        Math.min(1, depthFromRelease / Math.max(0.001, totalDepthRange))
      );

      // Check bounds in screen-space keyboard area
      const inBounds =
        smoothed.x >= this.keyboardArea.xMin &&
        smoothed.x <= this.keyboardArea.xMax &&
        smoothed.y >= this.keyboardArea.yMin &&
        smoothed.y <= this.keyboardArea.yMax;

      if (!inBounds) {
        if (tracker.pressedKey) {
          notesToReleaseSet.add(tracker.pressedKey.id);
          tracker.pressedKey = null;
        }
        tracker.currentKey = null;
        tracker.state = 'IDLE';

        fingerStates.set(input.id, {
          id: input.id,
          handSide: input.handSide,
          fingerName: input.fingerName,
          state: 'IDLE',
          currentKey: null,
          pressedKey: null,
          rawPosition: input.rawPosition,
          smoothedPosition: smoothed,
          mcpPosition: input.mcpPosition,
          relativeZ: 0,
          isLifted: true,
          depthRatio: 0,
          velocity,
        });
        continue;
      }

      // Map to normalized piano coordinates [0..1]
      const pianoX =
        (smoothed.x - this.keyboardArea.xMin) /
        (this.keyboardArea.xMax - this.keyboardArea.xMin);
      const pianoY =
        (smoothed.y - this.keyboardArea.yMin) /
        (this.keyboardArea.yMax - this.keyboardArea.yMin);

      const hitKey = getKeyAtCoordinate(pianoX, pianoY, keys);
      tracker.currentKey = hitKey;

      if (!hitKey) {
        if (tracker.pressedKey) {
          notesToReleaseSet.add(tracker.pressedKey.id);
          tracker.pressedKey = null;
        }
        tracker.state = 'IDLE';

        fingerStates.set(input.id, {
          id: input.id,
          handSide: input.handSide,
          fingerName: input.fingerName,
          state: 'IDLE',
          currentKey: null,
          pressedKey: null,
          rawPosition: input.rawPosition,
          smoothedPosition: smoothed,
          mcpPosition: input.mcpPosition,
          relativeZ: 0,
          isLifted: true,
          depthRatio,
          velocity,
        });
        continue;
      }

      // Knuckle-relative depth calculation
      const relativeZ = input.mcpPosition ? smoothed.z - input.mcpPosition.z : 0;
      // If fingertip is lifted above/near knuckle height, consider it lifted
      const isKnuckleLifted = input.mcpPosition ? relativeZ > -0.010 : false;
      // If fingertip extends down into desk below knuckle, consider it pressing
      const isKnucklePressed = input.mcpPosition ? relativeZ <= -0.025 : false;

      // Depth hysteresis checks: combines calibrated surface plane and knuckle arch
      const isPastPressDepth = smoothed.z <= this.pressDepthThreshold || isKnucklePressed;
      const isAboveReleaseDepth = smoothed.z >= this.releaseDepthThreshold || isKnuckleLifted;

      if (tracker.pressedKey) {
        // Finger was holding a key down
        if (isAboveReleaseDepth) {
          // Finger lifted up past release threshold or curled up
          notesToReleaseSet.add(tracker.pressedKey.id);
          tracker.pressedKey = null;
          tracker.state = 'RELEASING';
        } else if (tracker.pressedKey.id !== hitKey.id && isPastPressDepth) {
          // Finger slid across to an adjacent key while staying pressed down
          notesToReleaseSet.add(tracker.pressedKey.id);
          tracker.pressedKey = hitKey;
          notesToTriggerMap.set(hitKey.id, Math.max(notesToTriggerMap.get(hitKey.id) || 0, velocity));
          tracker.state = 'PRESSED';
        } else {
          // Still holding down the same key
          tracker.state = 'PRESSED';
        }
      } else {
        // Finger was not holding a key
        if (isPastPressDepth) {
          // Strike key
          tracker.pressedKey = hitKey;
          notesToTriggerMap.set(hitKey.id, Math.max(notesToTriggerMap.get(hitKey.id) || 0, velocity));
          tracker.state = 'PRESSED';
        } else {
          tracker.state = 'APPROACHING';
        }
      }

      fingerStates.set(input.id, {
        id: input.id,
        handSide: input.handSide,
        fingerName: input.fingerName,
        state: tracker.state,
        currentKey: hitKey,
        pressedKey: tracker.pressedKey,
        rawPosition: input.rawPosition,
        smoothedPosition: smoothed,
        mcpPosition: input.mcpPosition,
        relativeZ,
        isLifted: isAboveReleaseDepth,
        depthRatio,
        velocity,
      });
    }

    // 3. Multi-finger key sharing:
    // If finger A releases key C4, but finger B is still pressing key C4,
    // do NOT release C4!
    for (const tracker of this.trackers.values()) {
      if (tracker.pressedKey) {
        notesToReleaseSet.delete(tracker.pressedKey.id);
      }
    }

    // Convert notesToTriggerMap to array
    const notesToTrigger: NoteTrigger[] = [];
    for (const [note, velocity] of notesToTriggerMap.entries()) {
      notesToTrigger.push({ note, velocity });
    }

    const notesToRelease = Array.from(notesToReleaseSet);

    // Collect active and pressed keys
    const activeKeysSet = new Set<PianoKey>();
    const pressedKeysSet = new Set<PianoKey>();

    for (const state of fingerStates.values()) {
      if (state.currentKey) activeKeysSet.add(state.currentKey);
      if (state.pressedKey) pressedKeysSet.add(state.pressedKey);
    }

    return {
      fingers: fingerStates,
      notesToTrigger,
      notesToRelease,
      activeKeys: Array.from(activeKeysSet),
      pressedKeys: Array.from(pressedKeysSet),
    };
  }

  /**
   * Reset all finger state machines and release all keys.
   */
  reset(): string[] {
    const releasedNotes: string[] = [];
    for (const tracker of this.trackers.values()) {
      if (tracker.pressedKey) {
        releasedNotes.push(tracker.pressedKey.id);
      }
    }
    this.trackers.clear();
    this.emaFilter.clear();
    return releasedNotes;
  }
}
