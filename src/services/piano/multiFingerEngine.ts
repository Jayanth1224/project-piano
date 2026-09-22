import { type PianoKey, getKeyAtCoordinate } from './pianoModel.ts';
import { type Point3D, type KeyState } from './keyEngine.ts';
import { FingerContactDetector } from './fingerContactDetector.ts';
import { type PianoCalibration } from '../calibration/calibrationService.ts';

export type HandSide = 'Left' | 'Right';
export type FingerName = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';

export interface FingertipInput {
  id: string;
  handSide: HandSide;
  fingerName: FingerName;
  rawPosition: Point3D;
  displayPosition?: Point3D;
  mcpPosition?: Point3D;
  dipPosition?: Point3D;
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
  contactDetector: FingerContactDetector;
}

/**
 * Maps a deliberate per-finger contact event onto the calibrated piano keys.
 * Key selection belongs here; contact recognition lives in FingerContactDetector.
 */
export class MultiFingerEngine {
  private trackers = new Map<string, InternalFingerTracker>();
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

  processFrame(
    fingertipInputs: FingertipInput[],
    keys: PianoKey[],
    _timestamp: number = performance.now()
  ): MultiFingerFrameResult {
    const activeFingerIds = new Set(fingertipInputs.map((finger) => finger.id));
    const notesToTriggerMap = new Map<string, number>();
    const notesToReleaseSet = new Set<string>();
    const fingerStates = new Map<string, FingerState>();

    for (const [id, tracker] of this.trackers.entries()) {
      if (!activeFingerIds.has(id)) {
        if (tracker.pressedKey) notesToReleaseSet.add(tracker.pressedKey.id);
        this.trackers.delete(id);
      }
    }

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
          contactDetector: new FingerContactDetector(),
        };
        this.trackers.set(input.id, tracker);
      }

      const displayPosition = input.displayPosition ?? input.rawPosition;
      const inBounds =
        displayPosition.x >= this.keyboardArea.xMin &&
        displayPosition.x <= this.keyboardArea.xMax &&
        displayPosition.y >= this.keyboardArea.yMin &&
        displayPosition.y <= this.keyboardArea.yMax;
      const hitKey = inBounds
        ? getKeyAtCoordinate(
            (displayPosition.x - this.keyboardArea.xMin) / (this.keyboardArea.xMax - this.keyboardArea.xMin),
            (displayPosition.y - this.keyboardArea.yMin) / (this.keyboardArea.yMax - this.keyboardArea.yMin),
            keys
          )
        : null;
      tracker.currentKey = hitKey;

      const contact = tracker.contactDetector.process({
        fingerName: input.fingerName,
        position: input.rawPosition,
        mcpPosition: input.mcpPosition,
        dipPosition: input.dipPosition,
        pressDepthThreshold: this.pressDepthThreshold,
        releaseDepthThreshold: this.releaseDepthThreshold,
        canPress: hitKey !== null,
      });

      if (tracker.pressedKey) {
        if (contact.shouldRelease || !inBounds) {
          notesToReleaseSet.add(tracker.pressedKey.id);
          tracker.pressedKey = null;
          tracker.state = 'RELEASING';
          if (!inBounds) tracker.contactDetector.reset();
        } else if (hitKey && tracker.pressedKey.id !== hitKey.id && contact.isPastContactDepth) {
          if (!tracker.pressedKey.isBlack && hitKey.isBlack) {
            tracker.state = 'PRESSED';
          } else if (tracker.pressedKey.isBlack === hitKey.isBlack) {
            notesToReleaseSet.add(tracker.pressedKey.id);
            tracker.pressedKey = hitKey;
            notesToTriggerMap.set(hitKey.id, Math.max(notesToTriggerMap.get(hitKey.id) || 0, contact.velocity));
            tracker.state = 'PRESSED';
          }
        } else {
          tracker.state = 'PRESSED';
        }
      } else if (hitKey && contact.shouldPress) {
        tracker.pressedKey = hitKey;
        notesToTriggerMap.set(hitKey.id, Math.max(notesToTriggerMap.get(hitKey.id) || 0, contact.velocity));
        tracker.state = 'PRESSED';
      } else if (!inBounds) {
        tracker.state = 'IDLE';
      } else if (contact.isLifted || !contact.isArmed) {
        tracker.state = 'RELEASING';
      } else {
        tracker.state = 'APPROACHING';
      }

      fingerStates.set(input.id, {
        id: input.id,
        handSide: input.handSide,
        fingerName: input.fingerName,
        state: tracker.state,
        currentKey: hitKey,
        pressedKey: tracker.pressedKey,
        rawPosition: input.rawPosition,
        smoothedPosition: displayPosition,
        mcpPosition: input.mcpPosition,
        relativeZ: contact.relativeZ,
        isLifted: contact.isLifted,
        depthRatio: contact.depthRatio,
        velocity: contact.velocity,
      });
    }

    for (const tracker of this.trackers.values()) {
      if (tracker.pressedKey) notesToReleaseSet.delete(tracker.pressedKey.id);
    }

    const activeKeys = new Set<PianoKey>();
    const pressedKeys = new Set<PianoKey>();
    for (const state of fingerStates.values()) {
      if (state.currentKey) activeKeys.add(state.currentKey);
      if (state.pressedKey) pressedKeys.add(state.pressedKey);
    }

    return {
      fingers: fingerStates,
      notesToTrigger: Array.from(notesToTriggerMap, ([note, velocity]) => ({ note, velocity })),
      notesToRelease: Array.from(notesToReleaseSet),
      activeKeys: Array.from(activeKeys),
      pressedKeys: Array.from(pressedKeys),
    };
  }

  reset(): string[] {
    const releasedNotes: string[] = [];
    for (const tracker of this.trackers.values()) {
      if (tracker.pressedKey) releasedNotes.push(tracker.pressedKey.id);
    }
    this.trackers.clear();
    return releasedNotes;
  }
}
