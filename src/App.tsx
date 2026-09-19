import React, { useEffect, useRef, useState, useCallback } from 'react';
import { handTracker, HandTrackingResult } from './services/vision/handTracker';
import { pianoAudio } from './services/audio/pianoAudio';
import { KeyEngine, KeyState, Point3D, DEFAULT_MIDDLE_C_KEY } from './services/piano/keyEngine';

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
  const [manualPressed, setManualPressed] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initialize and start Camera & Audio
  const startSession = async () => {
    setErrorMessage(null);
    setModelLoading(true);

    try {
      // 1. Initialize Audio Engine (user gesture)
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
          // Sync canvas dimensions with video
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

          // In camera feeds, horizontal coordinates are mirrored
          let processedFingertip: Point3D | null = null;
          if (trackingResult.indexFingertip) {
            // Invert x because the video is mirrored with CSS scaleX(-1)
            processedFingertip = {
              x: 1 - trackingResult.indexFingertip.x,
              y: trackingResult.indexFingertip.y,
              z: trackingResult.indexFingertip.z,
            };
          }

          setCurrentFingertip(processedFingertip);

          // 2. Evaluate Key Engine State Machine
          const evaluation = keyEngineRef.current.evaluateFingertip(processedFingertip);
          setKeyState(evaluation.state);

          // 3. Audio Triggers
          if (evaluation.shouldTriggerNoteOn) {
            pianoAudio.triggerNote('C4', evaluation.estimatedVelocity);
          } else if (evaluation.shouldTriggerNoteOff && !manualPressed) {
            pianoAudio.releaseNote('C4');
          }

          // 4. Render Virtual Piano Key on Canvas
          const keyZone = keyEngineRef.current.getKeyZone();
          const kx = keyZone.xMin * width;
          const ky = keyZone.yMin * height;
          const kw = (keyZone.xMax - keyZone.xMin) * width;
          const kh = (keyZone.yMax - keyZone.yMin) * height;
          const isPressed = evaluation.isPressed || manualPressed;

          // Key Base Shadow & Body
          ctx.save();

          // Pressed offset displacement
          const offsetY = isPressed ? 8 : 0;

          // Ambient Key Glow when active
          if (isPressed) {
            ctx.shadowColor = '#06b6d4';
            ctx.shadowBlur = 35;
          } else if (evaluation.state === 'APPROACHING') {
            ctx.shadowColor = '#f59e0b';
            ctx.shadowBlur = 20;
          }

          // Key fill gradient
          const keyGrad = ctx.createLinearGradient(kx, ky + offsetY, kx, ky + kh + offsetY);
          if (isPressed) {
            keyGrad.addColorStop(0, '#06b6d4');
            keyGrad.addColorStop(1, '#0284c7');
          } else if (evaluation.state === 'APPROACHING') {
            keyGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
            keyGrad.addColorStop(1, 'rgba(254, 243, 199, 0.9)');
          } else {
            keyGrad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
            keyGrad.addColorStop(1, 'rgba(226, 232, 240, 0.85)');
          }

          ctx.fillStyle = keyGrad;
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(kx, ky + offsetY, kw, kh, [12, 12, 16, 16]);
          } else {
            ctx.rect(kx, ky + offsetY, kw, kh);
          }
          ctx.fill();

          // Key Border
          ctx.lineWidth = isPressed ? 4 : 2;
          ctx.strokeStyle = isPressed
            ? '#ffffff'
            : evaluation.state === 'APPROACHING'
            ? '#f59e0b'
            : 'rgba(255, 255, 255, 0.6)';
          ctx.stroke();

          // Key Label
          ctx.shadowBlur = 0;
          ctx.textAlign = 'center';
          ctx.fillStyle = isPressed ? '#ffffff' : '#0f172a';
          ctx.font = '700 24px Outfit, sans-serif';
          ctx.fillText('C4', kx + kw / 2, ky + kh - 45 + offsetY);

          ctx.font = '500 13px Outfit, sans-serif';
          ctx.fillStyle = isPressed ? 'rgba(255,255,255,0.85)' : '#475569';
          ctx.fillText('Middle C', kx + kw / 2, ky + kh - 22 + offsetY);

          // 5. Draw Tracked Fingertip & Depth Indicator
          if (processedFingertip) {
            const fx = processedFingertip.x * width;
            const fy = processedFingertip.y * height;

            // Fingertip outer depth ring (shrinks as finger pushes into key)
            const ringRadius = Math.max(14, 40 * (1 - evaluation.depthRatio * 0.6));
            ctx.beginPath();
            ctx.arc(fx, fy, ringRadius, 0, Math.PI * 2);
            ctx.strokeStyle = isPressed
              ? '#10b981'
              : evaluation.state === 'APPROACHING'
              ? '#f59e0b'
              : '#38bdf8';
            ctx.lineWidth = 3;
            ctx.stroke();

            // Fingertip center core dot
            ctx.beginPath();
            ctx.arc(fx, fy, 7, 0, Math.PI * 2);
            ctx.fillStyle = isPressed ? '#10b981' : '#ffffff';
            ctx.shadowColor = '#38bdf8';
            ctx.shadowBlur = 10;
            ctx.fill();
            ctx.shadowBlur = 0;

            // Coordinate tag
            ctx.font = '11px JetBrains Mono, monospace';
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'left';
            ctx.fillText(
              `z: ${processedFingertip.z.toFixed(3)}`,
              fx + 16,
              fy - 8
            );
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
  }, [isRunning, cameraActive, manualPressed]);

  // Manual fallback trigger (mouse/touch)
  const handleManualDown = () => {
    setManualPressed(true);
    pianoAudio.triggerNote('C4', 0.9);
  };

  const handleManualUp = () => {
    setManualPressed(false);
    if (keyState !== 'PRESSED') {
      pianoAudio.releaseNote('C4');
    }
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">🎹</span>
          <div>
            <h1 className="brand-title">Virtual Piano</h1>
          </div>
          <span className="badge">Slice 1: Tech Spike</span>
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
            <span>Tone.js Audio</span>
          </div>
        </div>
      </header>

      {errorMessage && (
        <div style={{
          background: 'rgba(244, 63, 94, 0.15)',
          border: '1px solid rgba(244, 63, 94, 0.4)',
          color: '#fecdd3',
          padding: '0.8rem 1.2rem',
          borderRadius: '12px',
          fontSize: '0.9rem'
        }}>
          {errorMessage}
        </div>
      )}

      {/* Main Grid */}
      <main className="stage-grid">
        {/* Left: Viewport */}
        <div className="viewport-card">
          <video
            ref={videoRef}
            className="camera-video"
            playsInline
            muted
          />
          <canvas
            ref={canvasRef}
            className="canvas-overlay"
          />

          {/* Start Screen Overlay */}
          {!isRunning && (
            <div className="overlay-start">
              <h2>Real-Time Single Key Spike</h2>
              <p>
                Experience hands-free piano playing. Click below to grant camera access and activate the Web Audio engine.
              </p>
              <button
                className="btn-primary"
                onClick={startSession}
                disabled={modelLoading}
              >
                {modelLoading ? 'Initializing MediaPipe...' : 'Start Camera & Sound'}
              </button>
            </div>
          )}
        </div>

        {/* Right: Sidebar Diagnostics */}
        <aside className="sidebar-panel">
          {/* Telemetry Card */}
          <div className="panel-card">
            <h3>Live Telemetry</h3>
            <div className="telemetry-grid">
              <div className="metric-box">
                <div className="metric-label">Engine FPS</div>
                <div className="metric-value">{fps}</div>
              </div>
              <div className="metric-box">
                <div className="metric-label">Key Note</div>
                <div className="metric-value">C4 (60)</div>
              </div>
            </div>

            <div>
              <div className="metric-label" style={{ marginBottom: '0.4rem' }}>Key State Machine</div>
              <div className={`state-badge state-${keyState}`}>
                {keyState}
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
                <div className="metric-label">Depth (z)</div>
                <div className="metric-value" style={{ fontSize: '0.95rem' }}>
                  {currentFingertip ? currentFingertip.z.toFixed(3) : '—'}
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

          {/* Manual Test Key Card */}
          <div className="panel-card">
            <h3>Fallback Direct Test</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Click and hold to test audio synthesis directly without camera:
            </p>
            <button
              className={`manual-key-btn ${manualPressed ? 'is-active' : ''}`}
              onMouseDown={handleManualDown}
              onMouseUp={handleManualUp}
              onMouseLeave={handleManualUp}
              onTouchStart={handleManualDown}
              onTouchEnd={handleManualUp}
            >
              🎹 Play Middle C (C4)
            </button>
          </div>

          {/* Quick Guide */}
          <div className="panel-card">
            <h3>How to Play</h3>
            <ol className="instructions-list">
              <li>Place your hand in front of the webcam.</li>
              <li>Point your <strong>index finger</strong> toward the virtual <strong>C4 key</strong>.</li>
              <li>Push your finger <strong>downward / toward the desk</strong> to strike the key.</li>
              <li>Lift your finger up to release the note.</li>
            </ol>
          </div>
        </aside>
      </main>
    </div>
  );
};
