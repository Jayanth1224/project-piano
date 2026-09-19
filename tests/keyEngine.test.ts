import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyEngine, DEFAULT_MIDDLE_C_KEY } from '../src/services/piano/keyEngine.ts';

test('KeyEngine - IDLE when fingertip is outside key boundary', () => {
  const engine = new KeyEngine(DEFAULT_MIDDLE_C_KEY);

  // Far to the left
  const result1 = engine.evaluateFingertip({ x: 0.1, y: 0.7, z: 0.0 });
  assert.equal(result1.state, 'IDLE');
  assert.equal(result1.isPressed, false);
  assert.equal(result1.shouldTriggerNoteOn, false);

  // Null fingertip
  const result2 = engine.evaluateFingertip(null);
  assert.equal(result2.state, 'IDLE');
  assert.equal(result2.isPressed, false);
});

test('KeyEngine - APPROACHING when inside boundary but above press depth', () => {
  const engine = new KeyEngine(DEFAULT_MIDDLE_C_KEY);

  // Inside x [0.38, 0.62] and y [0.55, 0.88], but z is 0.0 (above press threshold -0.045)
  const result = engine.evaluateFingertip({ x: 0.50, y: 0.70, z: 0.0 });
  assert.equal(result.state, 'APPROACHING');
  assert.equal(result.insideBounds, true);
  assert.equal(result.isPressed, false);
  assert.equal(result.shouldTriggerNoteOn, false);
});

test('KeyEngine - PRESSED and triggers NoteOn when depth crosses threshold', () => {
  const engine = new KeyEngine(DEFAULT_MIDDLE_C_KEY);

  // Approach
  engine.evaluateFingertip({ x: 0.50, y: 0.70, z: -0.02 });

  // Press down across -0.045
  const pressResult = engine.evaluateFingertip({ x: 0.50, y: 0.70, z: -0.05 });
  assert.equal(pressResult.state, 'PRESSED');
  assert.equal(pressResult.isPressed, true);
  assert.equal(pressResult.shouldTriggerNoteOn, true);
  assert.equal(pressResult.shouldTriggerNoteOff, false);
});

test('KeyEngine - Hysteresis prevents flickering between press and release thresholds', () => {
  const engine = new KeyEngine(DEFAULT_MIDDLE_C_KEY);

  // Press down
  engine.evaluateFingertip({ x: 0.50, y: 0.70, z: -0.05 });

  // Slightly lift to -0.035 (between press -0.045 and release -0.020)
  const hoverResult = engine.evaluateFingertip({ x: 0.50, y: 0.70, z: -0.035 });
  assert.equal(hoverResult.state, 'PRESSED', 'Key should remain PRESSED due to hysteresis');
  assert.equal(hoverResult.isPressed, true);
  assert.equal(hoverResult.shouldTriggerNoteOn, false, 'Should not re-trigger NoteOn');
  assert.equal(hoverResult.shouldTriggerNoteOff, false, 'Should not trigger NoteOff prematurely');
});

test('KeyEngine - RELEASING triggers NoteOff when lifting past release threshold', () => {
  const engine = new KeyEngine(DEFAULT_MIDDLE_C_KEY);

  // Press down
  engine.evaluateFingertip({ x: 0.50, y: 0.70, z: -0.05 });

  // Lift up past release threshold -0.020
  const releaseResult = engine.evaluateFingertip({ x: 0.50, y: 0.70, z: -0.01 });
  assert.equal(releaseResult.state, 'RELEASING');
  assert.equal(releaseResult.isPressed, false);
  assert.equal(releaseResult.shouldTriggerNoteOff, true);
  assert.equal(releaseResult.shouldTriggerNoteOn, false);
});

test('KeyEngine - Triggers NoteOff if finger exits bounds while pressed', () => {
  const engine = new KeyEngine(DEFAULT_MIDDLE_C_KEY);

  // Press down
  engine.evaluateFingertip({ x: 0.50, y: 0.70, z: -0.05 });

  // Move finger out horizontally
  const exitResult = engine.evaluateFingertip({ x: 0.10, y: 0.70, z: -0.05 });
  assert.equal(exitResult.state, 'IDLE');
  assert.equal(exitResult.isPressed, false);
  assert.equal(exitResult.shouldTriggerNoteOff, true);
});
