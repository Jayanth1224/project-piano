import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiFingerEngine, type FingertipInput } from '../src/services/piano/multiFingerEngine.ts';
import { generate88Keys } from '../src/services/piano/pianoModel.ts';

const keys = generate88Keys();

test('MultiFingerEngine - simultaneous two-hand chord triggering', () => {
  const engine = new MultiFingerEngine();

  // Find C3 (white key) and G4 (white key)
  const c3Key = keys.find((k) => k.id === 'C3')!;
  const g4Key = keys.find((k) => k.id === 'G4')!;

  assert.ok(c3Key);
  assert.ok(g4Key);

  // Map key center to screen coordinates
  const c3CenterX = (c3Key.xStart + c3Key.xEnd) * 0.5;
  const g4CenterX = (g4Key.xStart + g4Key.xEnd) * 0.5;

  const c3ScreenX = 0.05 + c3CenterX * 0.90;
  const g4ScreenX = 0.05 + g4CenterX * 0.90;
  const screenY = 0.55 + 0.75 * 0.35; // Lower half of key (white key zone)

  const leftHandThumb: FingertipInput = {
    id: 'Left_thumb',
    handSide: 'Left',
    fingerName: 'thumb',
    rawPosition: { x: c3ScreenX, y: screenY, z: -0.06 }, // Pressed (z <= -0.045)
  };

  const rightHandIndex: FingertipInput = {
    id: 'Right_index',
    handSide: 'Right',
    fingerName: 'index',
    rawPosition: { x: g4ScreenX, y: screenY, z: -0.06 }, // Pressed (z <= -0.045)
  };

  const result = engine.processFrame([leftHandThumb, rightHandIndex], keys);

  assert.equal(result.notesToTrigger.length, 2);
  const triggeredNotes = result.notesToTrigger.map((n) => n.note).sort();
  assert.deepEqual(triggeredNotes, ['C3', 'G4']);
  assert.equal(result.notesToRelease.length, 0);
  assert.equal(result.pressedKeys.length, 2);
});

test('MultiFingerEngine - independent hysteresis (one finger lifts, another stays pressed)', () => {
  const engine = new MultiFingerEngine();
  const c3Key = keys.find((k) => k.id === 'C3')!;
  const g4Key = keys.find((k) => k.id === 'G4')!;
  const c3CenterX = (c3Key.xStart + c3Key.xEnd) * 0.5;
  const g4CenterX = (g4Key.xStart + g4Key.xEnd) * 0.5;
  const c3ScreenX = 0.05 + c3CenterX * 0.90;
  const g4ScreenX = 0.05 + g4CenterX * 0.90;
  const screenY = 0.55 + 0.75 * 0.35;

  // Frame 1: Both fingers pressed
  engine.processFrame(
    [
      { id: 'Left_thumb', handSide: 'Left', fingerName: 'thumb', rawPosition: { x: c3ScreenX, y: screenY, z: -0.06 } },
      { id: 'Right_index', handSide: 'Right', fingerName: 'index', rawPosition: { x: g4ScreenX, y: screenY, z: -0.06 } },
    ],
    keys
  );

  // Frame 2..4: Left thumb lifts up past release threshold (z = -0.01), right index stays pressed (z = -0.06)
  let result2;
  for (let i = 0; i < 3; i++) {
    result2 = engine.processFrame(
      [
        { id: 'Left_thumb', handSide: 'Left', fingerName: 'thumb', rawPosition: { x: c3ScreenX, y: screenY, z: -0.01 } },
        { id: 'Right_index', handSide: 'Right', fingerName: 'index', rawPosition: { x: g4ScreenX, y: screenY, z: -0.06 } },
      ],
      keys
    );
  }

  assert.ok(result2);
  assert.deepEqual(result2.notesToRelease, ['C3']);
  assert.equal(result2.notesToTrigger.length, 0);
  assert.equal(result2.pressedKeys.length, 1);
  assert.equal(result2.pressedKeys[0].id, 'G4');
});

test('MultiFingerEngine - sliding from one key to another while pressed', () => {
  const engine = new MultiFingerEngine();
  const c4Key = keys.find((k) => k.id === 'C4')!;
  const d4Key = keys.find((k) => k.id === 'D4')!;
  const c4CenterX = (c4Key.xStart + c4Key.xEnd) * 0.5;
  const d4CenterX = (d4Key.xStart + d4Key.xEnd) * 0.5;
  const c4ScreenX = 0.05 + c4CenterX * 0.90;
  const d4ScreenX = 0.05 + d4CenterX * 0.90;
  const screenY = 0.55 + 0.75 * 0.35;

  // Frame 1: Press on C4
  engine.processFrame(
    [{ id: 'Right_index', handSide: 'Right', fingerName: 'index', rawPosition: { x: c4ScreenX, y: screenY, z: -0.06 } }],
    keys
  );

  // Frame 2..6: Slide to D4 while keeping z pressed
  let finalResult;
  for (let i = 0; i < 6; i++) {
    finalResult = engine.processFrame(
      [{ id: 'Right_index', handSide: 'Right', fingerName: 'index', rawPosition: { x: d4ScreenX, y: screenY, z: -0.06 } }],
      keys
    );
  }

  assert.ok(finalResult);
  assert.equal(finalResult.pressedKeys.length, 1);
  assert.equal(finalResult.pressedKeys[0].id, 'D4');
});

test('MultiFingerEngine - hand leaves camera frame releases active held notes', () => {
  const engine = new MultiFingerEngine();
  const c4Key = keys.find((k) => k.id === 'C4')!;
  const c4CenterX = (c4Key.xStart + c4Key.xEnd) * 0.5;
  const c4ScreenX = 0.05 + c4CenterX * 0.90;
  const screenY = 0.55 + 0.75 * 0.35;

  // Frame 1: Holding C4
  engine.processFrame(
    [{ id: 'Left_index', handSide: 'Left', fingerName: 'index', rawPosition: { x: c4ScreenX, y: screenY, z: -0.06 } }],
    keys
  );

  // Frame 2: Hand vanished (empty inputs)
  const result = engine.processFrame([], keys);

  assert.deepEqual(result.notesToRelease, ['C4']);
  assert.equal(result.pressedKeys.length, 0);
});
