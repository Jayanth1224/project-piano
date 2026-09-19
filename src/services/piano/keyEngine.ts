import { type PianoKey, getKeyAtCoordinate } from './pianoModel.ts';

export type KeyState = 'IDLE' | 'APPROACHING' | 'PRESSED' | 'RELEASING';

export interface Point3D {
  x: number; // Normalized 0..1 (horizontal)
  y: number; // Normalized 0..1 (vertical)
  z: number; // Normalized depth (negative is closer to camera / pressed)
}

export interface KeyZone {
  id: string;
  note: string;
  midiNote: number;
  xMin: number; // 0..1
  xMax: number; // 0..1
  yMin: number; // 0..1
  yMax: number; // 0..1
  pressDepthThreshold: number;   // z must be <= this to trigger press
  releaseDepthThreshold: number; // z must be >= this to release (hysteresis)
}

export interface KeyEvaluation {
  state: KeyState;
  isPressed: boolean;
  shouldTriggerNoteOn: boolean;
  shouldTriggerNoteOff: boolean;
  insideBounds: boolean;
  depthRatio: number; // 0..1 indicating how close to pressed
  estimatedVelocity: number;
}

export interface MultiKeyEvaluation {
  activeKey: PianoKey | null;
  pressedKey: PianoKey | null;
  noteToTrigger: string | null;
  noteToRelease: string | null;
  state: KeyState;
  isPressed: boolean;
  estimatedVelocity: number;
  depthRatio: number;
}

// Default Single Key (Middle C / C4)
export const DEFAULT_MIDDLE_C_KEY: KeyZone = {
  id: 'C4',
  note: 'C4',
  midiNote: 60,
  xMin: 0.38,
  xMax: 0.62,
  yMin: 0.55,
  yMax: 0.88,
  pressDepthThreshold: -0.045,
  releaseDepthThreshold: -0.020,
};

export class KeyEngine {
  private keyZone: KeyZone;
  private currentState: KeyState = 'IDLE';
  private currentActiveKey: PianoKey | null = null;
  private currentPressedKey: PianoKey | null = null;
  private previousZ: number | null = null;
  private previousTime: number = performance.now();

  private pressDepthThreshold = -0.045;
  private releaseDepthThreshold = -0.020;

  constructor(keyZone: KeyZone = DEFAULT_MIDDLE_C_KEY) {
    this.keyZone = { ...keyZone };
    this.pressDepthThreshold = keyZone.pressDepthThreshold;
    this.releaseDepthThreshold = keyZone.releaseDepthThreshold;
  }

  updateKeyZone(zone: Partial<KeyZone>): void {
    this.keyZone = { ...this.keyZone, ...zone };
    if (zone.pressDepthThreshold !== undefined) {
      this.pressDepthThreshold = zone.pressDepthThreshold;
    }
    if (zone.releaseDepthThreshold !== undefined) {
      this.releaseDepthThreshold = zone.releaseDepthThreshold;
    }
  }

  getKeyZone(): KeyZone {
    return { ...this.keyZone };
  }

  getCurrentState(): KeyState {
    return this.currentState;
  }

  getPressedKey(): PianoKey | null {
    return this.currentPressedKey;
  }

  getActiveKey(): PianoKey | null {
    return this.currentActiveKey;
  }

  /**
   * Evaluate a fingertip position against the full 88-key piano keyboard.
   * Transforms camera coordinates into piano-space coordinates and evaluates hit testing.
   */
  evaluateFingertipAgainst88Keys(
    fingertip: Point3D | null,
    keys: PianoKey[],
    keyboardArea = { xMin: 0.05, xMax: 0.95, yMin: 0.55, yMax: 0.90 }
  ): MultiKeyEvaluation {
    const now = performance.now();
    const dt = Math.max(1, now - this.previousTime);
    this.previousTime = now;

    if (!fingertip) {
      const wasPressed = this.currentPressedKey !== null;
      const noteToRelease = this.currentPressedKey ? this.currentPressedKey.id : null;
      this.currentState = 'IDLE';
      this.currentActiveKey = null;
      this.currentPressedKey = null;
      this.previousZ = null;

      return {
        activeKey: null,
        pressedKey: null,
        noteToTrigger: null,
        noteToRelease: wasPressed ? noteToRelease : null,
        state: 'IDLE',
        isPressed: false,
        estimatedVelocity: 0.8,
        depthRatio: 0,
      };
    }

    const { x, y, z } = fingertip;

    // Check if finger is within the overall keyboard region on screen
    const inKeyboard =
      x >= keyboardArea.xMin &&
      x <= keyboardArea.xMax &&
      y >= keyboardArea.yMin &&
      y <= keyboardArea.yMax;

    // Calculate approximate strike velocity
    let estimatedVelocity = 0.8;
    if (this.previousZ !== null && dt > 0) {
      const dz = this.previousZ - z;
      if (dz > 0) {
        estimatedVelocity = Math.max(0.3, Math.min(1.0, 0.4 + (dz / dt) * 50));
      }
    }
    this.previousZ = z;

    // Depth ratio
    const totalDepthRange = this.releaseDepthThreshold - this.pressDepthThreshold;
    const depthFromRelease = this.releaseDepthThreshold - z;
    const depthRatio = Math.max(0, Math.min(1, depthFromRelease / Math.max(0.001, totalDepthRange)));

    let noteToTrigger: string | null = null;
    let noteToRelease: string | null = null;

    if (!inKeyboard) {
      if (this.currentPressedKey) {
        noteToRelease = this.currentPressedKey.id;
        this.currentPressedKey = null;
      }
      this.currentActiveKey = null;
      this.currentState = 'IDLE';

      return {
        activeKey: null,
        pressedKey: null,
        noteToTrigger: null,
        noteToRelease,
        state: 'IDLE',
        isPressed: false,
        estimatedVelocity,
        depthRatio: 0,
      };
    }

    // Map screen coordinate to normalized piano coordinate [0..1]
    const pianoX = (x - keyboardArea.xMin) / (keyboardArea.xMax - keyboardArea.xMin);
    const pianoY = (y - keyboardArea.yMin) / (keyboardArea.yMax - keyboardArea.yMin);

    const hitKey = getKeyAtCoordinate(pianoX, pianoY, keys);
    this.currentActiveKey = hitKey;

    if (!hitKey) {
      if (this.currentPressedKey) {
        noteToRelease = this.currentPressedKey.id;
        this.currentPressedKey = null;
      }
      this.currentState = 'IDLE';

      return {
        activeKey: null,
        pressedKey: null,
        noteToTrigger: null,
        noteToRelease,
        state: 'IDLE',
        isPressed: false,
        estimatedVelocity,
        depthRatio,
      };
    }

    // Apply depth hysteresis
    const isPastPressDepth = z <= this.pressDepthThreshold;
    const isAboveReleaseDepth = z >= this.releaseDepthThreshold;

    if (this.currentPressedKey) {
      // Key was already pressed
      if (isAboveReleaseDepth) {
        // Finger lifted
        noteToRelease = this.currentPressedKey.id;
        this.currentPressedKey = null;
        this.currentState = 'RELEASING';
      } else if (this.currentPressedKey.id !== hitKey.id && isPastPressDepth) {
        // Finger slid onto a different key while pressed
        noteToRelease = this.currentPressedKey.id;
        this.currentPressedKey = hitKey;
        noteToTrigger = hitKey.id;
        this.currentState = 'PRESSED';
      } else {
        this.currentState = 'PRESSED';
      }
    } else {
      // Key was not pressed
      if (isPastPressDepth) {
        this.currentPressedKey = hitKey;
        noteToTrigger = hitKey.id;
        this.currentState = 'PRESSED';
      } else {
        this.currentState = 'APPROACHING';
      }
    }

    return {
      activeKey: hitKey,
      pressedKey: this.currentPressedKey,
      noteToTrigger,
      noteToRelease,
      state: this.currentState,
      isPressed: this.currentPressedKey !== null,
      estimatedVelocity,
      depthRatio,
    };
  }

  /**
   * Legacy single-key evaluation for backward compatibility with Slice 1 tests.
   */
  evaluateFingertip(fingertip: Point3D | null): KeyEvaluation {
    const now = performance.now();
    const dt = Math.max(1, now - this.previousTime);
    this.previousTime = now;

    if (!fingertip) {
      const wasPressed = this.currentState === 'PRESSED';
      this.currentState = 'IDLE';
      this.previousZ = null;
      return {
        state: 'IDLE',
        isPressed: false,
        shouldTriggerNoteOn: false,
        shouldTriggerNoteOff: wasPressed,
        insideBounds: false,
        depthRatio: 0,
        estimatedVelocity: 0.8,
      };
    }

    const { x, y, z } = fingertip;
    const insideBounds =
      x >= this.keyZone.xMin &&
      x <= this.keyZone.xMax &&
      y >= this.keyZone.yMin &&
      y <= this.keyZone.yMax;

    let estimatedVelocity = 0.8;
    if (this.previousZ !== null && dt > 0) {
      const dz = this.previousZ - z;
      if (dz > 0) {
        estimatedVelocity = Math.max(0.3, Math.min(1.0, 0.4 + (dz / dt) * 50));
      }
    }
    this.previousZ = z;

    const totalDepthRange = this.keyZone.releaseDepthThreshold - this.keyZone.pressDepthThreshold;
    const depthFromRelease = this.keyZone.releaseDepthThreshold - z;
    const depthRatio = Math.max(0, Math.min(1, depthFromRelease / Math.max(0.001, totalDepthRange)));

    let nextState: KeyState = this.currentState;
    let shouldTriggerNoteOn = false;
    let shouldTriggerNoteOff = false;

    if (!insideBounds) {
      if (this.currentState === 'PRESSED') {
        shouldTriggerNoteOff = true;
      }
      nextState = 'IDLE';
    } else {
      switch (this.currentState) {
        case 'IDLE':
        case 'RELEASING':
          if (z <= this.keyZone.pressDepthThreshold) {
            nextState = 'PRESSED';
            shouldTriggerNoteOn = true;
          } else {
            nextState = 'APPROACHING';
          }
          break;

        case 'APPROACHING':
          if (z <= this.keyZone.pressDepthThreshold) {
            nextState = 'PRESSED';
            shouldTriggerNoteOn = true;
          }
          break;

        case 'PRESSED':
          if (z >= this.keyZone.releaseDepthThreshold) {
            nextState = 'RELEASING';
            shouldTriggerNoteOff = true;
          }
          break;
      }
    }

    this.currentState = nextState;

    return {
      state: nextState,
      isPressed: nextState === 'PRESSED',
      shouldTriggerNoteOn,
      shouldTriggerNoteOff,
      insideBounds,
      depthRatio,
      estimatedVelocity,
    };
  }

  reset(): void {
    this.currentState = 'IDLE';
    this.currentActiveKey = null;
    this.currentPressedKey = null;
    this.previousZ = null;
  }
}
