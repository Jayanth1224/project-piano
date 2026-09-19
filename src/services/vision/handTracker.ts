import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { type Point3D } from '../piano/keyEngine.ts';
import { type HandSide, type FingerName } from '../piano/multiFingerEngine.ts';
import { EmaFilter3D } from './emaFilter.ts';

export const FINGERTIP_LANDMARKS: { name: FingerName; index: number }[] = [
  { name: 'thumb', index: 4 },
  { name: 'index', index: 8 },
  { name: 'middle', index: 12 },
  { name: 'ring', index: 16 },
  { name: 'pinky', index: 20 },
];

export interface TrackedFingertip {
  id: string; // e.g. "Left_index", "Right_thumb"
  handSide: HandSide;
  fingerName: FingerName;
  landmarkIndex: number;
  rawPosition: Point3D;
  smoothedPosition: Point3D;
}

export interface TrackedHand {
  handSide: HandSide;
  confidence: number;
  landmarks: Point3D[];
  fingertips: Map<FingerName, TrackedFingertip>;
  fingertipList: TrackedFingertip[];
}

export interface HandTrackingResult {
  isHandDetected: boolean;
  handsCount: number;
  hands: TrackedHand[];
  allFingertips: TrackedFingertip[];
  // Backwards compatibility for Slice 1 callers:
  indexFingertip: Point3D | null;
  allLandmarks: Point3D[][];
  handedness: string[];
  rawResult: unknown;
}

export class HandTrackerService {
  private handLandmarker: HandLandmarker | null = null;
  private isInitializing = false;
  private isReady = false;
  private emaFilter = new EmaFilter3D(0.45);

  async init(
    wasmBaseUrl = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm',
    modelAssetPath = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
  ): Promise<boolean> {
    if (this.isReady) return true;
    if (this.isInitializing) return false;

    this.isInitializing = true;

    try {
      const vision = await FilesetResolver.forVisionTasks(wasmBaseUrl);
      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      this.isReady = true;
      this.isInitializing = false;
      return true;
    } catch (err) {
      console.warn('GPU delegate failed or unsupported, falling back to CPU delegate:', err);
      try {
        const vision = await FilesetResolver.forVisionTasks(wasmBaseUrl);
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath,
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        this.isReady = true;
        this.isInitializing = false;
        return true;
      } catch (fallbackErr) {
        console.error('Failed to initialize HandTrackerService:', fallbackErr);
        this.isInitializing = false;
        return false;
      }
    }
  }

  isLoaded(): boolean {
    return this.isReady && this.handLandmarker !== null;
  }

  /**
   * Run inference on the current video frame.
   * Extracts up to 2 hands and all 10 fingertips with EMA smoothing.
   */
  detect(video: HTMLVideoElement, timestamp: number): HandTrackingResult {
    if (!this.handLandmarker || !this.isReady || video.readyState < 2) {
      return {
        isHandDetected: false,
        handsCount: 0,
        hands: [],
        allFingertips: [],
        indexFingertip: null,
        allLandmarks: [],
        handedness: [],
        rawResult: null,
      };
    }

    try {
      const results = this.handLandmarker.detectForVideo(video, timestamp);

      if (!results || !results.landmarks || results.landmarks.length === 0) {
        this.emaFilter.clear();
        return {
          isHandDetected: false,
          handsCount: 0,
          hands: [],
          allFingertips: [],
          indexFingertip: null,
          allLandmarks: [],
          handedness: [],
          rawResult: results,
        };
      }

      const allLandmarks: Point3D[][] = results.landmarks.map((hand) =>
        hand.map((lm) => ({
          x: lm.x,
          y: lm.y,
          z: lm.z,
        }))
      );

      const handednessStrings = (results.handedness || []).map((h) =>
        h.length > 0 ? h[0].displayName || h[0].categoryName : 'Right'
      );

      const activeFingertipIds = new Set<string>();
      const trackedHands: TrackedHand[] = [];
      const allFingertips: TrackedFingertip[] = [];

      results.landmarks.forEach((handPoints, handIdx) => {
        const rawHandedness = handednessStrings[handIdx] || (handIdx === 0 ? 'Right' : 'Left');
        // Standard selfie/mirrored webcam: MediaPipe's "Left" is the person's left hand
        const handSide: HandSide = rawHandedness.toLowerCase().includes('left') ? 'Left' : 'Right';
        const confidence = results.handedness?.[handIdx]?.[0]?.score ?? 0.8;

        const landmarks: Point3D[] = handPoints.map((p) => ({ x: p.x, y: p.y, z: p.z }));
        const fingertipsMap = new Map<FingerName, TrackedFingertip>();
        const fingertipList: TrackedFingertip[] = [];

        for (const ft of FINGERTIP_LANDMARKS) {
          const rawPoint = landmarks[ft.index];
          if (!rawPoint) continue;

          const id = `${handSide}_${ft.name}`;
          activeFingertipIds.add(id);

          const smoothed = this.emaFilter.filter(id, rawPoint);

          const fingertip: TrackedFingertip = {
            id,
            handSide,
            fingerName: ft.name,
            landmarkIndex: ft.index,
            rawPosition: rawPoint,
            smoothedPosition: smoothed,
          };

          fingertipsMap.set(ft.name, fingertip);
          fingertipList.push(fingertip);
          allFingertips.push(fingertip);
        }

        trackedHands.push({
          handSide,
          confidence,
          landmarks,
          fingertips: fingertipsMap,
          fingertipList,
        });
      });

      this.emaFilter.prune(activeFingertipIds);

      // Primary interaction point for backward compatibility: first hand's index fingertip
      const primaryHand = trackedHands[0];
      const primaryIndex = primaryHand?.fingertips.get('index')?.smoothedPosition || null;

      return {
        isHandDetected: true,
        handsCount: trackedHands.length,
        hands: trackedHands,
        allFingertips,
        indexFingertip: primaryIndex,
        allLandmarks,
        handedness: handednessStrings,
        rawResult: results,
      };
    } catch (err) {
      console.error('Error during hand tracking inference:', err);
      return {
        isHandDetected: false,
        handsCount: 0,
        hands: [],
        allFingertips: [],
        indexFingertip: null,
        allLandmarks: [],
        handedness: [],
        rawResult: null,
      };
    }
  }

  dispose(): void {
    if (this.handLandmarker) {
      this.handLandmarker.close();
      this.handLandmarker = null;
    }
    this.emaFilter.clear();
    this.isReady = false;
  }
}

export const handTracker = new HandTrackerService();
