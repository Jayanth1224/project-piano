import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { Point3D } from '../piano/keyEngine';

export interface HandTrackingResult {
  isHandDetected: boolean;
  indexFingertip: Point3D | null;
  allLandmarks: Point3D[][];
  handedness: string[];
  rawResult: unknown;
}

export class HandTrackerService {
  private handLandmarker: HandLandmarker | null = null;
  private isInitializing = false;
  private isReady = false;

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
   * MediaPipe landmark index 8 is INDEX_FINGER_TIP.
   */
  detect(video: HTMLVideoElement, timestamp: number): HandTrackingResult {
    if (!this.handLandmarker || !this.isReady || video.readyState < 2) {
      return {
        isHandDetected: false,
        indexFingertip: null,
        allLandmarks: [],
        handedness: [],
        rawResult: null,
      };
    }

    try {
      const results = this.handLandmarker.detectForVideo(video, timestamp);

      if (!results || !results.landmarks || results.landmarks.length === 0) {
        return {
          isHandDetected: false,
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

      // Primary interaction point for Slice 1: index fingertip of the first tracked hand (Landmark #8)
      const primaryHand = allLandmarks[0];
      const indexFingertip = primaryHand && primaryHand.length > 8 ? primaryHand[8] : null;

      const handedness = (results.handedness || []).map((h) =>
        h.length > 0 ? h[0].displayName || h[0].categoryName : 'Hand'
      );

      return {
        isHandDetected: true,
        indexFingertip,
        allLandmarks,
        handedness,
        rawResult: results,
      };
    } catch (err) {
      console.error('Error during hand tracking inference:', err);
      return {
        isHandDetected: false,
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
    this.isReady = false;
  }
}

export const handTracker = new HandTrackerService();
