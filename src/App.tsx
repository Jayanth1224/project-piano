import React, { useEffect, useRef, useState, useCallback } from 'react';
import { handTracker, type HandTrackingResult } from './services/vision/handTracker.ts';
import { pianoAudio } from './services/audio/pianoAudio.ts';
import {
  MultiFingerEngine,
  type FingertipInput,
  type FingerState,
} from './services/piano/multiFingerEngine.ts';
import { PIANO_88_KEYS } from './services/piano/pianoModel.ts';
import { PianoKeyboard } from './components/PianoKeyboard.tsx';
import {
  calibrationService,
  type PianoCalibration,
} from './services/calibration/calibrationService.ts';
import { CalibrationModal } from './components/CalibrationModal.tsx';

const HAND_CONNECTIONS: [number, number][] = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle
  [0, 9], [9, 10], [10, 11], [11, 12],
  // Ring
  [0, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [0, 17], [17, 18], [18, 19], [19, 20],
  // Knuckles / Palm
  [5, 9], [9, 13], [13, 17],
];

export const App: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Persistent room calibration
  const [calibration, setCalibration] = useState<PianoCalibration>(() =>
    calibrationService.loadCalibration()
  );
  const [isCalibrating, setIsCalibrating] = useState<boolean>(false);

  const multiFingerEngineRef = useRef<MultiFingerEngine>(
    new MultiFingerEngine()
  );
  const requestRef = useRef<number | null>(null);

  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [modelLoading, setModelLoading] = useState<boolean>(false);
  const [modelReady, setModelReady] = useState<boolean>(false);
  const [audioReady, setAudioReady] = useState<boolean>(false);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [fps, setFps] = useState<number>(0);

  // Two-hand telemetry
  const [leftHandDetected, setLeftHandDetected] = useState<boolean>(false);
  const [rightHandDetected, setRightHandDetected] = useState<boolean>(false);
  const [activeFingersCount, setActiveFingersCount] = useState<number>(0);
  const [trackedFingersList, setTrackedFingersList] = useState<FingerState[]>([]);
  const [activeSoundingNotes, setActiveSoundingNotes] = useState<string[]>([]);
  const [lastTriggeredNote, setLastTriggeredNote] = useState<string>('C4');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Apply calibration to multiFingerEngine whenever calibration changes
  useEffect(() => {
    multiFingerEngineRef.current.applyCalibration(calibration);
  }, [calibration]);

  // Note down handler (called by camera, touch, mouse, or QWERTY keyboard)
  const handleNoteDown = useCallback(async (noteId: string, velocity = 0.85) => {
    if (!pianoAudio.isReady()) {
      const status = await pianoAudio.initAudio();
      setAudioReady(status.isReady);
    }
    pianoAudio.triggerNote(noteId, velocity);
    setLastTriggeredNote(noteId);
    setActiveSoundingNotes((prev) => (prev.includes(noteId) ? prev : [...prev, noteId]));
  }, []);

  // Note up handler
  const handleNoteUp = useCallback((noteId: string) => {
    pianoAudio.releaseNote(noteId);
    setActiveSoundingNotes((prev) => prev.filter((n) => n !== noteId));
  }, []);

  // Preset chord audition helper (tests true polyphony)
  const playPresetChord = async (notes: string[]) => {
    if (!pianoAudio.isReady()) {
      const status = await pianoAudio.initAudio();
      setAudioReady(status.isReady);
    }
    pianoAudio.triggerChord(notes, 0.85);
    setActiveSoundingNotes((prev) => Array.from(new Set([...prev, ...notes])));

    setTimeout(() => {
      pianoAudio.releaseChord(notes);
      setActiveSoundingNotes((prev) => prev.filter((n) => !notes.includes(n)));
    }, 1200);
  };

  // Start Camera & Audio
  const startSession = async () => {
    setErrorMessage(null);
    setModelLoading(true);

    try {
      // 1. Initialize Audio Engine
      const audioStatus = await pianoAudio.initAudio();
      setAudioReady(audioStatus.isReady);

      // 2. Initialize MediaPipe Hand Tracker
      const trackerReady = await handTracker.init();
      setModelReady(trackerReady);
      setModelLoading(false);

      if (!trackerReady) {
        setErrorMessage('Failed to load MediaPipe hand tracking model.');
        return;
      }

      // 3. Request Camera Access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
        setIsRunning(true);
      }
    } catch (err) {
      console.error('Error starting session:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Setup error: ${msg}. Check camera permissions.`);
      setModelLoading(false);
    }
  };

  const stopSession = useCallback(() => {
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = null;
    }

    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }

    pianoAudio.stopAll();
    multiFingerEngineRef.current.reset();
    setActiveSoundingNotes([]);
    setIsRunning(false);
    setCameraActive(false);
    setLeftHandDetected(false);
    setRightHandDetected(false);
    setActiveFingersCount(0);
    setTrackedFingersList([]);
  }, []);

  // Main real-time render and tracking loop
  useEffect(() => {
    if (!isRunning || !cameraActive) return;

    let frameCount = 0;
    let lastFpsTime = performance.now();

    const loop = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video && canvas && video.readyState >= 2) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }

          const width = canvas.width;
          const height = canvas.height;
          ctx.clearRect(0, 0, width, height);

          // 1. Run Two-Hand Detection Inference
          const timestamp = performance.now();
          const trackingResult: HandTrackingResult = handTracker.detect(video, timestamp);

          let hasLeft = false;
          let hasRight = false;
          for (const h of trackingResult.hands) {
            if (h.handSide === 'Left') hasLeft = true;
            if (h.handSide === 'Right') hasRight = true;
          }
          setLeftHandDetected(hasLeft);
          setRightHandDetected(hasRight);

          // 2. Prepare Mirrored Fingertip & Knuckle Coordinates for MultiFingerEngine
          const fingertipInputs: FingertipInput[] = trackingResult.allFingertips.map((ft) => ({
            id: ft.id,
            handSide: ft.handSide,
            fingerName: ft.fingerName,
            rawPosition: {
              x: 1 - ft.smoothedPosition.x, // Mirror horizontally for selfie view
              y: ft.smoothedPosition.y,
              z: ft.smoothedPosition.z,
            },
            mcpPosition: {
              x: 1 - ft.smoothedMcpPosition.x,
              y: ft.smoothedMcpPosition.y,
              z: ft.smoothedMcpPosition.z,
            },
          }));

          // 3. Process All 10 Fingers in MultiFingerEngine with Calibrated Thresholds
          const frameResult = multiFingerEngineRef.current.processFrame(
            fingertipInputs,
            PIANO_88_KEYS,
            timestamp
          );

          // 4. Batch Audio Note Triggers and Releases
          for (const { note, velocity } of frameResult.notesToTrigger) {
            handleNoteDown(note, velocity);
          }
          for (const note of frameResult.notesToRelease) {
            handleNoteUp(note);
          }

          // Update UI state for active fingers
          const fingerStateList = Array.from(frameResult.fingers.values());
          setTrackedFingersList(fingerStateList);
          const pressedCount = fingerStateList.filter((f) => f.state === 'PRESSED').length;
          setActiveFingersCount(pressedCount);

          ctx.save();

          // 5. Draw Calibrated 88-Key Keyboard Overlay on Canvas
          const kbX = calibration.xMin * width;
          const kbY = calibration.yMin * height;
          const kbW = (calibration.xMax - calibration.xMin) * width;
          const kbH = (calibration.yMax - calibration.yMin) * height;

          // Keyboard Backplate
          ctx.fillStyle = 'rgba(10, 12, 18, 0.88)';
          ctx.strokeStyle = calibration.isCalibrated ? 'rgba(56, 189, 248, 0.6)' : 'rgba(255, 255, 255, 0.2)';
          ctx.lineWidth = calibration.isCalibrated ? 2.5 : 2;
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(kbX - 4, kbY - 4, kbW + 8, kbH + 8, [8, 8, 12, 12]);
          } else {
            ctx.rect(kbX - 4, kbY - 4, kbW + 8, kbH + 8);
          }
          ctx.fill();
          ctx.stroke();

          // Render White Keys
          for (const key of PIANO_88_KEYS) {
            if (key.isBlack) continue;

            const kx = kbX + key.xStart * kbW;
            const kw = (key.xEnd - key.xStart) * kbW;
            const ky = kbY + key.yStart * kbH;
            const kh = (key.yEnd - key.yStart) * kbH;
            const isPressed = activeSoundingNotes.includes(key.id);

            ctx.fillStyle = isPressed
              ? '#38bdf8'
              : key.id === 'C4'
              ? 'rgba(224, 242, 254, 0.95)'
              : 'rgba(248, 250, 252, 0.88)';

            ctx.fillRect(kx, ky, kw - 1, kh);

            if (key.id === 'C4') {
              ctx.fillStyle = '#0284c7';
              ctx.beginPath();
              ctx.arc(kx + kw / 2, ky + kh - 10, 3, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          // Render Black Keys (Top layer)
          for (const key of PIANO_88_KEYS) {
            if (!key.isBlack) continue;

            const kx = kbX + key.xStart * kbW;
            const kw = (key.xEnd - key.xStart) * kbW;
            const ky = kbY + key.yStart * kbH;
            const kh = (key.yEnd - key.yStart) * kbH;
            const isPressed = activeSoundingNotes.includes(key.id);

            ctx.fillStyle = isPressed ? '#0284c7' : '#18181b';
            ctx.fillRect(kx, ky, kw, kh);

            ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.lineWidth = 1;
            ctx.strokeRect(kx, ky, kw, kh);
          }

          // Visual Calibration Guide Overlay (if calibration is active)
          if (isCalibrating) {
            ctx.strokeStyle = '#38bdf8';
            ctx.setLineDash([8, 6]);
            ctx.lineWidth = 3;
            ctx.strokeRect(kbX - 8, kbY - 8, kbW + 16, kbH + 16);
            ctx.setLineDash([]);

            ctx.font = '700 13px Inter, sans-serif';
            ctx.fillStyle = '#38bdf8';
            ctx.fillText('📐 Desk Anchor Boundary', kbX, kbY - 14);
          }

          // 6. Draw Hand Skeletons for Both Hands
          for (const hand of trackingResult.hands) {
            const isLeft = hand.handSide === 'Left';
            const boneColor = isLeft ? 'rgba(6, 182, 212, 0.65)' : 'rgba(245, 158, 11, 0.65)';
            const jointColor = isLeft ? '#22d3ee' : '#fbbf24';

            ctx.strokeStyle = boneColor;
            ctx.lineWidth = 2.5;

            // Draw bone links
            for (const [idx1, idx2] of HAND_CONNECTIONS) {
              const p1 = hand.landmarks[idx1];
              const p2 = hand.landmarks[idx2];
              if (!p1 || !p2) continue;

              const x1 = (1 - p1.x) * width;
              const y1 = p1.y * height;
              const x2 = (1 - p2.x) * width;
              const y2 = p2.y * height;

              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y2);
              ctx.stroke();
            }

            // Draw joint nodes
            for (let i = 0; i < hand.landmarks.length; i++) {
              if ([4, 8, 12, 16, 20].includes(i)) continue;
              const p = hand.landmarks[i];
              const jx = (1 - p.x) * width;
              const jy = p.y * height;

              ctx.beginPath();
              ctx.arc(jx, jy, 3.5, 0, Math.PI * 2);
              ctx.fillStyle = jointColor;
              ctx.fill();
            }
          }

          // 7. Draw All Tracked Fingertips with Dynamic Depth Rings & Contact State
          for (const finger of fingerStateList) {
            const fx = finger.smoothedPosition.x * width;
            const fy = finger.smoothedPosition.y * height;
            const isPressed = finger.state === 'PRESSED';
            const isApproaching = finger.state === 'APPROACHING';
            const isLeft = finger.handSide === 'Left';

            // Depth ring: size shrinks as finger approaches the press threshold
            const ringRadius = Math.max(10, 30 * (1 - finger.depthRatio * 0.6));

            ctx.beginPath();
            ctx.arc(fx, fy, ringRadius, 0, Math.PI * 2);
            ctx.strokeStyle = isPressed
              ? '#10b981'
              : isApproaching
              ? '#f59e0b'
              : isLeft
              ? 'rgba(6, 182, 212, 0.6)'
              : 'rgba(245, 158, 11, 0.6)';
            ctx.lineWidth = isPressed ? 3 : 2;
            ctx.stroke();

            // Center contact dot
            ctx.beginPath();
            ctx.arc(fx, fy, isPressed ? 7 : 5, 0, Math.PI * 2);
            ctx.fillStyle = isPressed
              ? '#10b981'
              : isLeft
              ? '#06b6d4'
              : '#f59e0b';
            if (isPressed) {
              ctx.shadowColor = '#10b981';
              ctx.shadowBlur = 10;
            }
            ctx.fill();
            ctx.shadowBlur = 0;

            // Finger arch bridge line from knuckle (MCP) to fingertip
            if (finger.mcpPosition) {
              const mx = finger.mcpPosition.x * width;
              const my = finger.mcpPosition.y * height;
              ctx.beginPath();
              ctx.moveTo(mx, my);
              ctx.lineTo(fx, fy);
              ctx.strokeStyle = isPressed ? 'rgba(16, 185, 129, 0.6)' : 'rgba(255, 255, 255, 0.18)';
              ctx.lineWidth = 1.5;
              ctx.setLineDash([3, 3]);
              ctx.stroke();
              ctx.setLineDash([]);
            }

            // Finger label + note info + live state badge
            const fingerPrefix = isLeft ? 'L' : 'R';
            const shortName = finger.fingerName.slice(0, 3).toUpperCase();
            const noteText = finger.currentKey ? ` ${finger.currentKey.id}` : '';
            const statusText = isPressed ? ' [DOWN ⬇]' : finger.isLifted ? ' [LIFT ⬆]' : ' [HOVER]';
            const tag = `${fingerPrefix}-${shortName}${noteText}${statusText}`;

            ctx.font = '700 11px JetBrains Mono, monospace';
            ctx.fillStyle = isPressed ? '#10b981' : finger.isLifted ? '#94a3b8' : '#f59e0b';
            ctx.fillText(tag, fx + 12, fy - 6);
          }

          ctx.restore();

          // Calculate FPS
          frameCount++;
          const now = performance.now();
          if (now - lastFpsTime >= 1000) {
            setFps(Math.round((frameCount * 1000) / (now - lastFpsTime)));
            frameCount = 0;
            lastFpsTime = now;
          }
        }
      }

      requestRef.current = requestAnimationFrame(loop);
    };

    requestRef.current = requestAnimationFrame(loop);

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [isRunning, cameraActive, activeSoundingNotes, handleNoteDown, handleNoteUp, calibration, isCalibrating]);

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">🎹</span>
          <div>
            <h1 className="brand-title">Virtual Piano</h1>
          </div>
          <span className="badge">Slice 4: Space Calibration</span>
        </div>

        <div className="status-indicators">
          <button
            className="btn-secondary"
            onClick={() => setIsCalibrating(true)}
            style={{
              padding: '0.4rem 0.8rem',
              fontSize: '0.8rem',
              border: calibration.isCalibrated ? '1px solid #38bdf8' : '1px solid var(--border-subtle)',
              color: calibration.isCalibrated ? '#38bdf8' : 'inherit',
            }}
          >
            {calibration.isCalibrated ? '📍 Desk Anchored' : '📐 Calibrate Desk'}
          </button>
          <div className="indicator">
            <span className={`dot ${cameraActive ? 'active' : ''}`} />
            <span>Camera</span>
          </div>
          <div className="indicator">
            <span className={`dot ${modelReady ? 'active' : ''}`} />
            <span>2-Hand Tracker</span>
          </div>
          <div className="indicator">
            <span className={`dot ${audioReady ? 'active' : ''}`} />
            <span>Tone.js 32-Poly</span>
          </div>
        </div>
      </header>

      {errorMessage && (
        <div
          style={{
            background: 'rgba(244, 63, 94, 0.15)',
            border: '1px solid rgba(244, 63, 94, 0.4)',
            color: '#fecdd3',
            padding: '0.8rem 1.2rem',
            borderRadius: '12px',
            fontSize: '0.9rem',
          }}
        >
          {errorMessage}
        </div>
      )}

      {/* Main Grid: Viewport + Telemetry */}
      <main className="stage-grid">
        {/* Left: Viewport */}
        <div className="viewport-card">
          <video ref={videoRef} className="camera-video" playsInline muted />
          <canvas ref={canvasRef} className="canvas-overlay" />

          {!isRunning && (
            <div className="overlay-start">
              <h2>Calibrated Virtual Piano</h2>
              <p>
                Rest your hands naturally on your desk, calibrate the surface in one tap, and play with full 10-finger polyphony.
              </p>
              <button
                className="btn-primary"
                onClick={startSession}
                disabled={modelLoading}
              >
                {modelLoading ? 'Initializing MediaPipe...' : 'Enable Camera & Sound'}
              </button>
            </div>
          )}
        </div>

        {/* Right: Sidebar Telemetry & Calibration Status */}
        <aside className="sidebar-panel">
          <div className="panel-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Room Anchor Status</h3>
              <button
                className="btn-secondary"
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                onClick={() => setIsCalibrating(true)}
              >
                Adjust 📐
              </button>
            </div>

            <div className="telemetry-grid">
              <div className="metric-box">
                <div className="metric-label">Anchor State</div>
                <div
                  className="metric-value"
                  style={{
                    color: calibration.isCalibrated ? '#38bdf8' : 'var(--text-muted)',
                    fontSize: '0.95rem',
                  }}
                >
                  {calibration.isCalibrated ? 'Anchored 📍' : 'Default (Air)'}
                </div>
              </div>
              <div className="metric-box">
                <div className="metric-label">Resting Surface z</div>
                <div className="metric-value" style={{ fontSize: '0.95rem' }}>
                  {calibration.depthReference.toFixed(3)}
                </div>
              </div>
            </div>

            {/* Quick Tabletop Alignment Nudge Bar */}
            <div style={{ marginTop: '0.6rem', padding: '0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>🎹 Keyboard Position</span>
                <span style={{ fontSize: '0.7rem', color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>
                  y: {Math.round(calibration.yMin * 100)}%–{Math.round(calibration.yMax * 100)}%
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                <button
                  className="btn-secondary"
                  style={{
                    fontSize: '0.72rem',
                    padding: '0.35rem 0.4rem',
                    justifyContent: 'center',
                    background: calibration.yMin >= 0.70 ? 'rgba(56, 189, 248, 0.15)' : undefined,
                    borderColor: calibration.yMin >= 0.70 ? '#38bdf8' : undefined,
                  }}
                  onClick={() => {
                    const next = { ...calibration, yMin: 0.72, yMax: 0.98, isCalibrated: true };
                    setCalibration(next);
                    calibrationService.saveCalibration(next);
                  }}
                  title="Snap keyboard to table surface at the bottom"
                >
                  🏢 Desk Surface
                </button>
                <button
                  className="btn-secondary"
                  style={{ fontSize: '0.72rem', padding: '0.35rem 0.4rem', justifyContent: 'center' }}
                  onClick={() => {
                    const next = { ...calibration, yMin: 0.58, yMax: 0.88, isCalibrated: true };
                    setCalibration(next);
                    calibrationService.saveCalibration(next);
                  }}
                  title="Move keyboard to mid-air floating position"
                >
                  ✨ Mid-Air
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.3rem', marginTop: '0.4rem' }}>
                <button
                  className="btn-secondary"
                  style={{ fontSize: '0.7rem', padding: '0.3rem 0.1rem', justifyContent: 'center' }}
                  onClick={() => {
                    const next = {
                      ...calibration,
                      yMin: Math.max(0.20, Number((calibration.yMin - 0.03).toFixed(2))),
                      yMax: Math.max(0.35, Number((calibration.yMax - 0.03).toFixed(2))),
                      isCalibrated: true,
                    };
                    setCalibration(next);
                    calibrationService.saveCalibration(next);
                  }}
                  title="Nudge keyboard upward"
                >
                  ⬆ Up
                </button>
                <button
                  className="btn-secondary"
                  style={{ fontSize: '0.7rem', padding: '0.3rem 0.1rem', justifyContent: 'center' }}
                  onClick={() => {
                    const next = {
                      ...calibration,
                      yMin: Math.min(0.80, Number((calibration.yMin + 0.03).toFixed(2))),
                      yMax: Math.min(0.99, Number((calibration.yMax + 0.03).toFixed(2))),
                      isCalibrated: true,
                    };
                    setCalibration(next);
                    calibrationService.saveCalibration(next);
                  }}
                  title="Nudge keyboard downward"
                >
                  ⬇ Down
                </button>
                <button
                  className="btn-secondary"
                  style={{ fontSize: '0.7rem', padding: '0.3rem 0.1rem', justifyContent: 'center' }}
                  onClick={() => {
                    const next = {
                      ...calibration,
                      yMin: Math.max(0.20, Number((calibration.yMin - 0.03).toFixed(2))),
                      isCalibrated: true,
                    };
                    setCalibration(next);
                    calibrationService.saveCalibration(next);
                  }}
                  title="Make keyboard taller"
                >
                  ↕ Tall
                </button>
                <button
                  className="btn-secondary"
                  style={{ fontSize: '0.7rem', padding: '0.3rem 0.1rem', justifyContent: 'center' }}
                  onClick={() => {
                    const next = {
                      ...calibration,
                      yMin: Math.min(calibration.yMax - 0.15, Number((calibration.yMin + 0.03).toFixed(2))),
                      isCalibrated: true,
                    };
                    setCalibration(next);
                    calibrationService.saveCalibration(next);
                  }}
                  title="Make keyboard shorter"
                >
                  ↕ Short
                </button>
              </div>
            </div>

            <div className="telemetry-grid">
              <div className="metric-box">
                <div className="metric-label">Left Hand</div>
                <div
                  className="metric-value"
                  style={{
                    color: leftHandDetected ? '#22d3ee' : 'var(--text-muted)',
                    fontSize: '1rem',
                  }}
                >
                  {leftHandDetected ? 'Active ●' : 'Off'}
                </div>
              </div>
              <div className="metric-box">
                <div className="metric-label">Right Hand</div>
                <div
                  className="metric-value"
                  style={{
                    color: rightHandDetected ? '#fbbf24' : 'var(--text-muted)',
                    fontSize: '1rem',
                  }}
                >
                  {rightHandDetected ? 'Active ●' : 'Off'}
                </div>
              </div>
            </div>

            <div className="telemetry-grid">
              <div className="metric-box">
                <div className="metric-label">Active Fingers</div>
                <div className="metric-value">
                  {activeFingersCount} <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>/ 10</span>
                </div>
              </div>
              <div className="metric-box">
                <div className="metric-label">Engine FPS</div>
                <div className="metric-value">{fps}</div>
              </div>
            </div>

            <div>
              <div className="metric-label" style={{ marginBottom: '0.4rem' }}>
                Sounding Notes ({activeSoundingNotes.length})
              </div>
              <div className="active-chord-box">
                {activeSoundingNotes.length > 0 ? (
                  activeSoundingNotes.map((note) => (
                    <span key={note} className="note-chip">
                      {note}
                    </span>
                  ))
                ) : (
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    No keys active (Last: {lastTriggeredNote})
                  </span>
                )}
              </div>
            </div>

            {/* Tracked Fingers Status */}
            <div>
              <div className="metric-label" style={{ marginBottom: '0.4rem' }}>
                Tracked Fingers ({trackedFingersList.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {trackedFingersList.map((f) => {
                  const isLeft = f.handSide === 'Left';
                  const isPressed = f.state === 'PRESSED';
                  return (
                    <span
                      key={f.id}
                      style={{
                        fontSize: '0.7rem',
                        fontFamily: 'var(--font-mono)',
                        padding: '0.2rem 0.45rem',
                        borderRadius: '6px',
                        background: isPressed
                          ? 'rgba(16, 185, 129, 0.25)'
                          : isLeft
                          ? 'rgba(6, 182, 212, 0.15)'
                          : 'rgba(245, 158, 11, 0.15)',
                        color: isPressed ? '#34d399' : isLeft ? '#67e8f9' : '#fcd34d',
                        border: isPressed
                          ? '1px solid #10b981'
                          : isLeft
                          ? '1px solid rgba(6, 182, 212, 0.3)'
                          : '1px solid rgba(245, 158, 11, 0.3)',
                      }}
                    >
                      {isLeft ? 'L' : 'R'}:{f.fingerName.slice(0, 3)}
                      {f.pressedKey ? `(${f.pressedKey.id})` : ''}
                    </span>
                  );
                })}
              </div>
            </div>

            {isRunning && (
              <button
                className="btn-secondary"
                onClick={stopSession}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                Stop Camera Session
              </button>
            )}
          </div>

          {/* Polyphony Quick Audition Card */}
          <div className="panel-card">
            <h3>Polyphony Quick Audition</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Test multi-voice chords without audio clipping:
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <button
                className="btn-secondary"
                onClick={() => playPresetChord(['C4', 'E4', 'G4'])}
              >
                C Major
              </button>
              <button
                className="btn-secondary"
                onClick={() => playPresetChord(['G3', 'B3', 'D4', 'F4'])}
              >
                G7
              </button>
              <button
                className="btn-secondary"
                onClick={() => playPresetChord(['A3', 'C4', 'E4'])}
              >
                A Minor
              </button>
              <button
                className="btn-secondary"
                onClick={() => playPresetChord(['F3', 'A3', 'C4', 'E4'])}
              >
                Fmaj7
              </button>
            </div>
          </div>
        </aside>
      </main>

      {/* Interactive Piano Keyboard Deck */}
      <section className="piano-section">
        <PianoKeyboard
          activeNotes={activeSoundingNotes}
          onNoteDown={handleNoteDown}
          onNoteUp={handleNoteUp}
        />
      </section>

      {/* Space Calibration Modal */}
      {isCalibrating && (
        <CalibrationModal
          currentCalibration={calibration}
          detectedFingertips={trackedFingersList.map((f) => ({ z: f.rawPosition.z }))}
          onSave={(newCal) => {
            calibrationService.saveCalibration(newCal);
            setCalibration(newCal);
            setIsCalibrating(false);
          }}
          onReset={() => {
            const resetCal = calibrationService.resetCalibration();
            setCalibration(resetCal);
          }}
          onClose={() => setIsCalibrating(false)}
        />
      )}
    </div>
  );
};
