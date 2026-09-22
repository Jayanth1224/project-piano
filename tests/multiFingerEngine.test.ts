import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiFingerEngine, type FingertipInput } from '../src/services/piano/multiFingerEngine.ts';
import { generate88Keys } from '../src/services/piano/pianoModel.ts';

const keys = generate88Keys();
const KEYBOARD_X_START = 0.05;
const KEYBOARD_WIDTH = 0.90;

function screenX(note: string): number {
  const key = keys.find((candidate) => candidate.id === note);
  assert.ok(key, `Expected ${note} to exist`);
  return KEYBOARD_X_START + ((key.xStart + key.xEnd) * 0.5) * KEYBOARD_WIDTH;
}

function finger(
  id: string,
  note: string,
  y: number,
  z: number,
  extra: Partial<FingertipInput> = {}
): FingertipInput {
  const [handSide, fingerName] = id.split('_') as [FingertipInput['handSide'], FingertipInput['fingerName']];
  const position = { x: screenX(note), y, z };
  return {
    id,
    handSide,
    fingerName,
    rawPosition: position,
    displayPosition: position,
    ...extra,
  };
}

function process(engine: MultiFingerEngine, inputs: FingertipInput[]) {
  return engine.processFrame(inputs, keys);
}

function armAndStrike(engine: MultiFingerEngine, inputs: Array<{ id: string; note: string }>) {
  process(engine, inputs.map(({ id, note }) => finger(id, note, 0.740, -0.010)));
  process(engine, inputs.map(({ id, note }) => finger(id, note, 0.740, -0.010)));
  process(engine, inputs.map(({ id, note }) => finger(id, note, 0.748, -0.035)));
  return process(engine, inputs.map(({ id, note }) => finger(id, note, 0.756, -0.060)));
}

test('MultiFingerEngine - requires a lifted-to-contact strike before playing a two-hand chord', () => {
  const engine = new MultiFingerEngine();
  const result = armAndStrike(engine, [
    { id: 'Left_thumb', note: 'C3' },
    { id: 'Right_index', note: 'G4' },
  ]);

  assert.deepEqual(result.notesToTrigger.map((trigger) => trigger.note).sort(), ['C3', 'G4']);
  assert.deepEqual(result.pressedKeys.map((key) => key.id).sort(), ['C3', 'G4']);
});

test('MultiFingerEngine - releases one finger without releasing another finger on the same frame', () => {
  const engine = new MultiFingerEngine();
  armAndStrike(engine, [
    { id: 'Left_thumb', note: 'C3' },
    { id: 'Right_index', note: 'G4' },
  ]);

  const result = process(engine, [
    finger('Left_thumb', 'C3', 0.710, -0.010),
    finger('Right_index', 'G4', 0.756, -0.060),
  ]);

  assert.deepEqual(result.notesToRelease, ['C3']);
  assert.deepEqual(result.pressedKeys.map((key) => key.id), ['G4']);
});

test('MultiFingerEngine - supports a white-key glissando while the finger remains pressed', () => {
  const engine = new MultiFingerEngine();
  armAndStrike(engine, [{ id: 'Right_index', note: 'C4' }]);

  const result = process(engine, [finger('Right_index', 'D4', 0.756, -0.060)]);

  assert.deepEqual(result.notesToRelease, ['C4']);
  assert.deepEqual(result.notesToTrigger.map((trigger) => trigger.note), ['D4']);
  assert.deepEqual(result.pressedKeys.map((key) => key.id), ['D4']);
});

test('MultiFingerEngine - releases a note when a tracked hand disappears', () => {
  const engine = new MultiFingerEngine();
  armAndStrike(engine, [{ id: 'Left_index', note: 'C4' }]);

  const result = process(engine, []);

  assert.deepEqual(result.notesToRelease, ['C4']);
  assert.equal(result.pressedKeys.length, 0);
});

test('MultiFingerEngine - leaving the keyboard releases and requires a new lifted strike', () => {
  const engine = new MultiFingerEngine();
  armAndStrike(engine, [{ id: 'Left_index', note: 'C4' }]);

  const exit = process(engine, [finger('Left_index', 'C4', 0.950, -0.060)]);
  const firstAfterExit = armAndStrike(engine, [{ id: 'Left_index', note: 'C4' }]);

  assert.deepEqual(exit.notesToRelease, ['C4']);
  assert.deepEqual(firstAfterExit.notesToTrigger.map((trigger) => trigger.note), ['C4']);
});

test('MultiFingerEngine - initial deep detection and a one-frame tracking loss cannot play a note', () => {
  const engine = new MultiFingerEngine();

  const firstDetection = process(engine, [finger('Right_index', 'C4', 0.756, -0.060)]);
  const lost = process(engine, []);
  const reacquired = process(engine, [finger('Right_index', 'C4', 0.756, -0.060)]);

  assert.equal(firstDetection.notesToTrigger.length, 0);
  assert.equal(lost.notesToRelease.length, 0);
  assert.equal(reacquired.notesToTrigger.length, 0);
});

test('MultiFingerEngine - lifted tip drifting into a black key never re-triggers, even after settling', () => {
  const engine = new MultiFingerEngine();
  armAndStrike(engine, [{ id: 'Right_index', note: 'C4' }]);

  const lift = process(engine, [finger('Right_index', 'C#4', 0.650, -0.010)]);
  assert.deepEqual(lift.notesToRelease, ['C4']);

  for (let frame = 0; frame < 60; frame++) {
    const settling = process(engine, [finger('Right_index', 'C#4', 0.650, frame % 2 ? -0.048 : -0.046)]);
    assert.equal(settling.notesToTrigger.length, 0, `Frame ${frame} must not trigger C#4`);
    assert.equal(settling.pressedKeys.length, 0);
  }
});

test('MultiFingerEngine - noisy depth alone cannot imitate a downward strike', () => {
  const engine = new MultiFingerEngine();
  process(engine, [finger('Right_index', 'C4', 0.740, -0.010)]);
  process(engine, [finger('Right_index', 'C4', 0.740, -0.010)]);

  for (const z of [-0.044, -0.047, -0.043, -0.049, -0.045, -0.048]) {
    const result = process(engine, [finger('Right_index', 'C4', 0.740, z)]);
    assert.equal(result.notesToTrigger.length, 0);
    assert.equal(result.pressedKeys.length, 0);
  }
});

test('MultiFingerEngine - calibrated threshold still accepts a deliberate descending strike', () => {
  const engine = new MultiFingerEngine();
  engine.applyCalibration({
    xMin: 0.05,
    xMax: 0.95,
    yMin: 0.55,
    yMax: 0.90,
    depthReference: -0.040,
    pressOffset: -0.020,
    releaseOffset: -0.006,
    isCalibrated: true,
    updatedAt: 100,
  });

  process(engine, [finger('Right_index', 'C4', 0.740, -0.035)]);
  process(engine, [finger('Right_index', 'C4', 0.740, -0.035)]);
  process(engine, [finger('Right_index', 'C4', 0.748, -0.050)]);
  const result = process(engine, [finger('Right_index', 'C4', 0.756, -0.065)]);

  assert.deepEqual(result.notesToTrigger.map((trigger) => trigger.note), ['C4']);
  assert.deepEqual(result.pressedKeys.map((key) => key.id), ['C4']);
});

test('MultiFingerEngine - an extended finger tip cannot count as contact', () => {
  const engine = new MultiFingerEngine();
  const dipPosition = { x: screenX('C4'), y: 0.758, z: -0.040 };

  process(engine, [finger('Right_index', 'C4', 0.740, -0.010, { dipPosition })]);
  process(engine, [finger('Right_index', 'C4', 0.740, -0.010, { dipPosition })]);
  process(engine, [finger('Right_index', 'C4', 0.748, -0.035, { dipPosition })]);
  const result = process(engine, [finger('Right_index', 'C4', 0.756, -0.060, { dipPosition })]);

  assert.equal(result.notesToTrigger.length, 0);
  assert.equal(result.pressedKeys.length, 0);
});
