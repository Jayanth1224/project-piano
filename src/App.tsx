import React, { useEffect, useRef, useState, useCallback } from 'react';
import { handTracker, HandTrackingResult } from './services/vision/handTracker';
import { pianoAudio } from './services/audio/pianoAudio';
import { KeyEngine, KeyState, Point3D, DEFAULT_MIDDLE_C_KEY } from './services/piano/keyEngine';
import { PIANO_88_KEYS } from './services/piano/pianoModel.ts';
import { PianoKeyboard } from './components/PianoKeyboard';

const KEYBOARD_CAMERA_BOUNDS = {
  xMin: 0.04,
  xMax: 0.96,
  yMin: 0.58,
  yMax: 0.88,
};

export const App: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const keyEngineRef = useRef<KeyEngine>(new KeyEngine(DEFAULT_MIDDLE_C_KEY));
  const requestRef = useRef<number | null>(null);

  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [modelLoading, setModelLoading] = useState<boolean>(false);
  const [modelReady, setModelReady] = useState<boolean>(false);
  const [audioReady, setAudioReady] = useState<boolean>(false);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [fps, setFps] = useState<number>(0);
  const [keyState, setKeyState] = useState<KeyState>('IDLE');
  const [currentFingertip, setCurrentFingertip] = useState<Point3D | null>(null);
  const [handDetected, setHandDetected] = useState<boolean>(false);
  const [activeSoundingNotes, setActiveSoundingNotes] = useState<string[]>([]);
  const [lastTriggeredNote, setLastTriggeredNote] = useState<string>('C4');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
    keyEngineRef.current.reset();
    setActiveSoundingNotes([]);
    setIsRunning(false);
    setCameraActive(false);
    setKeyState('IDLE');
    setHandDetected(false);
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

          // 1. Run Hand Detection Inference
          const timestamp = performance.now();
          const trackingResult: HandTrackingResult = handTracker.detect(video, timestamp);
          setHandDetected(trackingResult.isHandDetected);

          let processedFingertip: Point3D | null = null;
          if (trackingResult.indexFingertip) {
            processedFingertip = {
              x: 1 - trackingResult.indexFingertip.x,
              y: trackingResult.indexFingertip.y,
              z: trackingResult.indexFingertip.z,
            };
          }
          setCurrentFingertip(processedFingertip);

          // 2. Evaluate 88-Key Model
          const evaluation = keyEngineRef.current.evaluateFingertipAgainst88Keys(
            processedFingertip,
            PIANO_88_KEYS,
            KEYBOARD_CAMERA_BOUNDS
          );
          setKeyState(evaluation.state);

          if (evaluation.noteToTrigger) {
            handleNoteDown(evaluation.noteToTrigger, evaluation.estimatedVelocity);
          }
          if (evaluation.noteToRelease) {
            handleNoteUp(evaluation.noteToRelease);
          }

          // 3. Render 88-Key Overlay on Canvas
          ctx.save();
          const kbX = KEYBOARD_CAMERA_BOUNDS.xMin * width;
          const kbY = KEYBOARD_CAMERA_BOUNDS.yMin * height;
          const kbW = (KEYBOARD_CAMERA_BOUNDS.xMax - KEYBOARD_CAMERA_BOUNDS.xMin) * width;
          const kbH = (KEYBOARD_CAMERA_BOUNDS.yMax - KEYBOARD_CAMERA_BOUNDS.yMin) * height;

          // Keyboard Backplate
          ctx.fillStyle = 'rgba(10, 12, 18, 0.85)';
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.lineWidth = 2;
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
              ? 'rgba(224, 242, 254, 0.92)'
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

          // 4. Draw Fingertip & Depth Ring
          if (processedFingertip) {
            const fx = processedFingertip.x * width;
            const fy = processedFingertip.y * height;
            const isPressed = evaluation.isPressed;

            const ringRadius = Math.max(12, 34 * (1 - evaluation.depthRatio * 0.6));
            ctx.beginPath();
            ctx.arc(fx, fy, ringRadius, 0, Math.PI * 2);
            ctx.strokeStyle = isPressed
              ? '#10b981'
              : evaluation.state === 'APPROACHING'
              ? '#f59e0b'
              : '#38bdf8';
            ctx.lineWidth = 2.5;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(fx, fy, 6, 0, Math.PI * 2);
            ctx.fillStyle = isPressed ? '#10b981' : '#ffffff';
            ctx.shadowColor = '#38bdf8';
            ctx.shadowBlur = 8;
            ctx.fill();
            ctx.shadowBlur = 0;

            if (evaluation.activeKey) {
              ctx.font = '700 12px JetBrains Mono, monospace';
              ctx.fillStyle = isPressed ? '#10b981' : '#f8fafc';
              ctx.fillText(evaluation.activeKey.id, fx + 14, fy - 6);
            }
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
  }, [isRunning, cameraActive, activeSoundingNotes, handleNoteDown, handleNoteUp]);

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">🎹</span>
          <div>
            <h1 className="brand-title">Virtual Piano</h1>
          </div>
          <span className="badge">Slice 2: 88 Keys</span>
        </div>

        <div className="status-indicators">
          <div className="indicator">
            <span className={`dot ${cameraActive ? 'active' : ''}`} />
            <span>Camera</span>
          </div>
          <div className="indicator">
            <span className={`dot ${modelReady ? 'active' : ''}`} />
            <span>Hand Tracker</span>
          </div>
          <div className="indicator">
            <span className={`dot ${audioReady ? 'active' : ''}`} />
            <span>Tone.js Polyphony</span>
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
              <h2>88-Key Virtual Piano</h2>
              <p>
                Experience real-time camera hand tracking across 88 keys, or play directly with your mouse, touch, or QWERTY keyboard.
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

        {/* Right: Sidebar Telemetry & Chord Tester */}
        <aside className="sidebar-panel">
          <div className="panel-card">
            <h3>Polyphonic Telemetry</h3>
            <div className="telemetry-grid">
              <div className="metric-box">
                <div className="metric-label">Engine FPS</div>
                <div className="metric-value">{fps}</div>
              </div>
              <div className="metric-box">
                <div className="metric-label">Active Voices</div>
                <div className="metric-value">{activeSoundingNotes.length}</div>
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

            <div className="telemetry-grid">
              <div className="metric-box">
                <div className="metric-label">Key State</div>
                <div className={`state-badge state-${keyState}`} style={{ marginTop: '0.2rem' }}>
                  {keyState}
                </div>
              </div>
              <div className="metric-box">
                <div className="metric-label">Depth (z)</div>
                <div className="metric-value" style={{ fontSize: '0.95rem' }}>
                  {currentFingertip ? currentFingertip.z.toFixed(3) : '—'}
                </div>
              </div>
            </div>

            <div className="telemetry-grid">
              <div className="metric-box">
                <div className="metric-label">Hand Detected</div>
                <div className="metric-value" style={{ fontSize: '0.95rem' }}>
                  {handDetected ? 'Yes' : 'No'}
                </div>
              </div>
              <div className="metric-box">
                <div className="metric-label">Current Note</div>
                <div className="metric-value" style={{ fontSize: '0.95rem' }}>
                  {lastTriggeredNote}
                </div>
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
            <h3>Chord Audition (Polyphony)</h3>
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
    </div>
  );
};
