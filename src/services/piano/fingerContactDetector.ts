import { type Point3D } from './keyEngine.ts';

type FingerName = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';

export type FingerContactPhase = 'UNARMED' | 'ARMED' | 'DESCENDING' | 'PRESSED';

export interface FingerContactSample {
  fingerName: FingerName;
  position: Point3D;
  mcpPosition?: Point3D;
  dipPosition?: Point3D;
  pressDepthThreshold: number;
  releaseDepthThreshold: number;
  canPress: boolean;
}

export interface FingerContactResult {
  phase: FingerContactPhase;
  isLifted: boolean;
  isPastContactDepth: boolean;
  isArmed: boolean;
  shouldPress: boolean;
  shouldRelease: boolean;
  relativeZ: number;
  depthRatio: number;
  velocity: number;
}

interface PreviousSample {
  y: number;
  z: number;
  wasPastContactDepth: boolean;
}

const ARM_FRAMES_REQUIRED = 2;
const DESCENT_FRAMES_REQUIRED = 2;
const MIN_Z_DESCENT = 0.0005;
const MIN_Y_DESCENT = 0.001;
const MIN_DOWNWARD_TRAVEL = 0.008;
const MIN_FINGER_DOWN_ANGLE = 0.006;

/**
 * Converts noisy fingertip landmarks into deliberate contact events.
 *
 * A projected fingertip is never enough to play a note. Each finger must first
 * be seen lifted, then descend across the calibrated contact plane with both a
 * depth change and a downward screen-space motion. This makes a lifted tip that
 * happens to pass over a key harmless.
 */
export class FingerContactDetector {
  private phase: FingerContactPhase = 'UNARMED';
  private liftedFrames = 0;
  private descentFrames = 0;
  private armY: number | null = null;
  private previous: PreviousSample | null = null;

  process(sample: FingerContactSample): FingerContactResult {
    const relativeZ = sample.mcpPosition ? sample.position.z - sample.mcpPosition.z : 0;
    const isThumb = sample.fingerName === 'thumb';
    const knucklePressLimit = isThumb ? -0.040 : -0.024;
    const knuckleLiftLimit = isThumb ? -0.018 : -0.010;
    const isKnuckleLifted = sample.mcpPosition ? relativeZ > knuckleLiftLimit : false;
    const isKnucklePressed = sample.mcpPosition ? relativeZ <= knucklePressLimit : false;
    const isLifted = sample.position.z >= sample.releaseDepthThreshold || isKnuckleLifted;
    const isPastContactDepth =
      (sample.position.z <= sample.pressDepthThreshold || isKnucklePressed) && !isLifted;
    const totalDepthRange = sample.releaseDepthThreshold - sample.pressDepthThreshold;
    const depthRatio = Math.max(
      0,
      Math.min(1, (sample.releaseDepthThreshold - sample.position.z) / Math.max(0.001, totalDepthRange))
    );
    const zDelta = this.previous ? this.previous.z - sample.position.z : 0;
    const yDelta = this.previous ? sample.position.y - this.previous.y : 0;
    const velocity = Math.max(0.3, Math.min(1, 0.4 + zDelta * 55));
    const isDescending = zDelta >= MIN_Z_DESCENT && yDelta >= MIN_Y_DESCENT;
    const pointsTowardKeyboard =
      isThumb || !sample.dipPosition || sample.position.y - sample.dipPosition.y >= MIN_FINGER_DOWN_ANGLE;

    let shouldPress = false;
    let shouldRelease = false;

    if (this.phase === 'PRESSED') {
      if (isLifted) {
        this.phase = 'UNARMED';
        this.liftedFrames = 1;
        this.descentFrames = 0;
        this.armY = sample.position.y;
        shouldRelease = true;
      }
    } else if (isLifted) {
      this.liftedFrames++;
      this.descentFrames = 0;
      this.armY = this.armY === null ? sample.position.y : Math.min(this.armY, sample.position.y);
      if (this.liftedFrames >= ARM_FRAMES_REQUIRED) {
        this.phase = 'ARMED';
      }
    } else if (this.phase === 'ARMED' || this.phase === 'DESCENDING') {
      const hasMovedBelowArmY =
        this.armY !== null && sample.position.y - this.armY >= MIN_DOWNWARD_TRAVEL;
      const crossedContactPlane = !this.previous?.wasPastContactDepth && isPastContactDepth;

      if (isDescending && pointsTowardKeyboard) {
        this.descentFrames++;
        this.phase = 'DESCENDING';
      } else {
        this.descentFrames = 0;
        this.phase = 'ARMED';
      }

      if (
        crossedContactPlane &&
        isPastContactDepth &&
        sample.canPress &&
        hasMovedBelowArmY &&
        pointsTowardKeyboard &&
        this.descentFrames >= DESCENT_FRAMES_REQUIRED
      ) {
        this.phase = 'PRESSED';
        this.liftedFrames = 0;
        this.descentFrames = 0;
        shouldPress = true;
      }
    } else {
      this.liftedFrames = 0;
      this.descentFrames = 0;
      this.armY = null;
    }

    this.previous = {
      y: sample.position.y,
      z: sample.position.z,
      wasPastContactDepth: isPastContactDepth,
    };

    return {
      phase: this.phase,
      isLifted,
      isPastContactDepth,
      isArmed: this.phase === 'ARMED' || this.phase === 'DESCENDING',
      shouldPress,
      shouldRelease,
      relativeZ,
      depthRatio,
      velocity,
    };
  }

  reset(): void {
    this.phase = 'UNARMED';
    this.liftedFrames = 0;
    this.descentFrames = 0;
    this.armY = null;
    this.previous = null;
  }
}
