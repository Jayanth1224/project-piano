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

// Default Single Key (Middle C / C4) located in the lower-middle portion of the video
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
  private previousZ: number | null = null;
  private previousTime: number = performance.now();

  constructor(keyZone: KeyZone = DEFAULT_MIDDLE_C_KEY) {
    this.keyZone = { ...keyZone };
  }

  updateKeyZone(zone: Partial<KeyZone>): void {
    this.keyZone = { ...this.keyZone, ...zone };
  }

  getKeyZone(): KeyZone {
    return { ...this.keyZone };
  }

  getCurrentState(): KeyState {
    return this.currentState;
  }

  /**
   * Evaluate a fingertip position against the virtual key zone.
   * Returns state transitions and audio trigger recommendations.
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

    // Calculate approximate strike velocity from depth delta
    let estimatedVelocity = 0.8;
    if (this.previousZ !== null && dt > 0) {
      const dz = this.previousZ - z; // positive if pushing forward
      if (dz > 0) {
        // Map delta to velocity range 0.3 .. 1.0
        estimatedVelocity = Math.max(0.3, Math.min(1.0, 0.4 + (dz / dt) * 50));
      }
    }
    this.previousZ = z;

    // Depth ratio: 0 = far away, 1 = at or past press threshold
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
      // Inside (x, y) bounds: apply depth hysteresis
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
    this.previousZ = null;
  }
}
