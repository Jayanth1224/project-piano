import React, { useState } from 'react';
import {
  type PianoCalibration,
  DEFAULT_CALIBRATION,
} from '../services/calibration/calibrationService.ts';

interface CalibrationModalProps {
  currentCalibration: PianoCalibration;
  detectedFingertips: { z: number }[];
  onSave: (cal: PianoCalibration) => void;
  onReset: () => void;
  onClose: () => void;
}

export const CalibrationModal: React.FC<CalibrationModalProps> = ({
  currentCalibration,
  detectedFingertips,
  onSave,
  onReset,
  onClose,
}) => {
  const [cal, setCal] = useState<PianoCalibration>({ ...currentCalibration });
  const [capturedMessage, setCapturedMessage] = useState<string | null>(null);

  // Calculate live average depth from currently visible fingertips
  const liveDepth =
    detectedFingertips.length > 0
      ? detectedFingertips.reduce((acc, f) => acc + f.z, 0) / detectedFingertips.length
      : null;

  const handleCaptureDeskSurface = () => {
    if (detectedFingertips.length === 0) {
      setCapturedMessage('No hands visible! Hold hands over camera resting on desk.');
      return;
    }

    const sorted = detectedFingertips.map((f) => f.z).sort((a, b) => a - b);
    const trimmed = sorted.length >= 4 ? sorted.slice(1, sorted.length - 1) : sorted;
    const avgZ = trimmed.reduce((acc, val) => acc + val, 0) / trimmed.length;

    setCal((prev) => ({
      ...prev,
      depthReference: Number(avgZ.toFixed(3)),
    }));
    setCapturedMessage(`Captured surface at z = ${avgZ.toFixed(3)} (${detectedFingertips.length} fingers)`);
  };

  const applyPreset = (type: 'desk' | 'air' | 'lap') => {
    if (type === 'desk') {
      setCal((prev) => ({
        ...prev,
        yMin: 0.58,
        yMax: 0.88,
        pressOffset: -0.018,
        releaseOffset: -0.005,
      }));
      setCapturedMessage('Applied Desk Preset (Firm release, requires touching surface)');
    } else if (type === 'air') {
      setCal((prev) => ({
        ...prev,
        yMin: 0.50,
        yMax: 0.82,
        depthReference: -0.025,
        pressOffset: -0.025,
        releaseOffset: -0.010,
      }));
      setCapturedMessage('Applied Air Piano Preset (Gentler in-air depth)');
    } else if (type === 'lap') {
      setCal((prev) => ({
        ...prev,
        yMin: 0.65,
        yMax: 0.94,
        pressOffset: -0.022,
        releaseOffset: -0.007,
      }));
      setCapturedMessage('Applied Lap Piano Preset (Lower screen boundary)');
    }
  };

  const handleSave = () => {
    onSave(cal);
  };

  const handleReset = () => {
    setCal({ ...DEFAULT_CALIBRATION });
    onReset();
    setCapturedMessage('Reset to factory defaults.');
  };

  const pressLine = cal.depthReference + cal.pressOffset;
  const releaseLine = cal.depthReference + cal.releaseOffset;

  return (
    <div className="modal-backdrop">
      <div className="calibration-card">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '1.4rem' }}>📐</span>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>
                Space Calibration & Room Anchor
              </h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
                Anchor the 88-key piano to your physical desk surface so keys release naturally.
              </p>
            </div>
          </div>
          <button className="btn-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Live Depth Radar & Surface Calibrator */}
        <div className="calib-section">
          <div className="section-title">
            <span>Step 1: Calibrate Resting Desk Surface</span>
            <span className="badge" style={{ textTransform: 'none' }}>
              Solves Sticky Keys
            </span>
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Rest your hands naturally flat on your desk/table right now. Click the button below to
            record that resting height as the baseline.
          </p>

          <div className="depth-meter-box">
            <div className="depth-meter-readout" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <div>
                <span className="metric-label">Live Depth</span>
                <div style={{ fontSize: '1rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                  {liveDepth !== null ? liveDepth.toFixed(3) : '—'}
                </div>
              </div>
              <div>
                <span className="metric-label">Desk Surface</span>
                <div style={{ fontSize: '1rem', fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#38bdf8' }}>
                  {cal.depthReference.toFixed(3)}
                </div>
              </div>
              <div>
                <span className="metric-label">Press Line</span>
                <div style={{ fontSize: '1rem', fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#10b981' }}>
                  {pressLine.toFixed(3)}
                </div>
              </div>
              <div>
                <span className="metric-label">Release Line</span>
                <div style={{ fontSize: '1rem', fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#f59e0b' }}>
                  {releaseLine.toFixed(3)}
                </div>
              </div>
            </div>

            <button
              className="btn-primary"
              style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }}
              onClick={handleCaptureDeskSurface}
            >
              🎯 Rest Hands on Desk & Capture Surface ({detectedFingertips.length} Fingers Visible)
            </button>

            {capturedMessage && (
              <div
                style={{
                  marginTop: '0.5rem',
                  fontSize: '0.8rem',
                  color: '#38bdf8',
                  background: 'rgba(56, 189, 248, 0.1)',
                  padding: '0.4rem 0.8rem',
                  borderRadius: '8px',
                }}
              >
                ✓ {capturedMessage}
              </div>
            )}
          </div>
        </div>

        {/* Touch Sensitivity */}
        <div className="calib-section">
          <div className="section-title">Step 2: Press Sensitivity</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <label className="metric-label">Press Depth Offset</label>
                <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                  {cal.pressOffset.toFixed(3)}
                </span>
              </div>
              <input
                type="range"
                min="-0.040"
                max="-0.010"
                step="0.002"
                value={cal.pressOffset}
                onChange={(e) =>
                  setCal((prev) => ({ ...prev, pressOffset: parseFloat(e.target.value) }))
                }
                style={{ width: '100%' }}
              />
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                Light touch ← → Firm press
              </span>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <label className="metric-label">Release Lift Offset</label>
                <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                  {cal.releaseOffset.toFixed(3)}
                </span>
              </div>
              <input
                type="range"
                min="-0.015"
                max="-0.002"
                step="0.001"
                value={cal.releaseOffset}
                onChange={(e) =>
                  setCal((prev) => ({ ...prev, releaseOffset: parseFloat(e.target.value) }))
                }
                style={{ width: '100%' }}
              />
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                Quick release ← → Generous hold
              </span>
            </div>
          </div>
        </div>

        {/* Keyboard Position & Width on Camera */}
        <div className="calib-section">
          <div className="section-title">Step 3: Keyboard Position on Screen</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label className="metric-label">Vertical Position (Top / Bottom)</label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="range"
                  min="0.30"
                  max="0.75"
                  step="0.02"
                  value={cal.yMin}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setCal((prev) => ({ ...prev, yMin: val, yMax: Math.max(val + 0.15, prev.yMax) }));
                  }}
                  style={{ width: '100%' }}
                />
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                Raise or lower keyboard to match table
              </span>
            </div>

            <div>
              <label className="metric-label">Horizontal Span (Width)</label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="range"
                  min="0.01"
                  max="0.25"
                  step="0.01"
                  value={cal.xMin}
                  onChange={(e) => {
                    const margin = parseFloat(e.target.value);
                    setCal((prev) => ({ ...prev, xMin: margin, xMax: 1 - margin }));
                  }}
                  style={{ width: '100%' }}
                />
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                Narrow or widen keyboard
              </span>
            </div>
          </div>
        </div>

        {/* Quick Presets */}
        <div className="calib-section">
          <div className="section-title">Quick Presets</div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn-secondary" onClick={() => applyPreset('desk')}>
              🏢 Desk / Table
            </button>
            <button className="btn-secondary" onClick={() => applyPreset('air')}>
              ✨ Air Piano (No Surface)
            </button>
            <button className="btn-secondary" onClick={() => applyPreset('lap')}>
              🛋️ Lap Mode
            </button>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="modal-footer">
          <button className="btn-secondary" onClick={handleReset}>
            Reset Defaults
          </button>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" onClick={handleSave}>
              💾 Save & Anchor Piano
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
