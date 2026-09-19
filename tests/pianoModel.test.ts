import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generate88Keys,
  getKeyAtCoordinate,
  getKeysInOctaveRange,
  TOTAL_KEYS,
  TOTAL_WHITE_KEYS,
  TOTAL_BLACK_KEYS,
  LOWEST_MIDI,
  HIGHEST_MIDI,
} from '../src/services/piano/pianoModel.ts';

test('pianoModel - exactly 88 total keys (52 white, 36 black)', () => {
  const keys = generate88Keys();

  assert.equal(keys.length, TOTAL_KEYS, 'Must have 88 total keys');

  const whiteKeys = keys.filter((k) => !k.isBlack);
  const blackKeys = keys.filter((k) => k.isBlack);

  assert.equal(whiteKeys.length, TOTAL_WHITE_KEYS, 'Must have 52 white keys');
  assert.equal(blackKeys.length, TOTAL_BLACK_KEYS, 'Must have 36 black keys');
});

test('pianoModel - correct MIDI range from A0 (21) to C8 (108)', () => {
  const keys = generate88Keys();

  assert.equal(keys[0].midiNote, LOWEST_MIDI);
  assert.equal(keys[0].id, 'A0');
  assert.equal(keys[0].isBlack, false);

  assert.equal(keys[keys.length - 1].midiNote, HIGHEST_MIDI);
  assert.equal(keys[keys.length - 1].id, 'C8');
  assert.equal(keys[keys.length - 1].isBlack, false);

  // Middle C is MIDI 60 (C4)
  const middleC = keys.find((k) => k.id === 'C4');
  assert.ok(middleC, 'Middle C must exist');
  assert.equal(middleC.midiNote, 60);
  assert.equal(middleC.isBlack, false);
});

test('pianoModel - coordinates are normalized within [0, 1]', () => {
  const keys = generate88Keys();

  for (const key of keys) {
    assert.ok(key.xStart >= 0 && key.xStart < 1, `Key ${key.id} xStart must be >= 0 and < 1`);
    assert.ok(key.xEnd > 0 && key.xEnd <= 1.0001, `Key ${key.id} xEnd must be > 0 and <= 1`);
    assert.ok(key.xEnd > key.xStart, `Key ${key.id} xEnd must be greater than xStart`);
    assert.ok(key.yEnd > key.yStart, `Key ${key.id} yEnd must be greater than yStart`);
  }
});

test('pianoModel - hit testing gives black keys precedence over white keys', () => {
  const keys = generate88Keys();

  // Find C#4 (black key) and C4 (white key)
  const c4 = keys.find((k) => k.id === 'C4')!;
  const cSharp4 = keys.find((k) => k.id === 'C#4')!;

  assert.ok(c4 && cSharp4);

  // Click directly on C#4 (upper part where black key sits)
  const blackKeyCenterX = (cSharp4.xStart + cSharp4.xEnd) / 2;
  const blackKeyCenterY = (cSharp4.yStart + cSharp4.yEnd) / 2;

  const hitBlack = getKeyAtCoordinate(blackKeyCenterX, blackKeyCenterY, keys);
  assert.equal(hitBlack?.id, 'C#4', 'Should hit black key when clicking within black key bounds');

  // Click on the lower part of C4 where no black key reaches (y = 0.85)
  const hitWhite = getKeyAtCoordinate(c4.xStart + 0.005, 0.85, keys);
  assert.equal(hitWhite?.id, 'C4', 'Should hit white key when clicking lower part');
});

test('pianoModel - octave filtering returns expected subsets', () => {
  const keys = generate88Keys();

  // Octave 4 has 12 notes: C4, C#4, D4, D#4, E4, F4, F#4, G4, G#4, A4, A#4, B4
  const octave4Keys = getKeysInOctaveRange(4, 4, keys);
  assert.equal(octave4Keys.length, 12, 'Octave 4 should contain 12 notes');

  // All keys in octave 4 must have octave = 4
  for (const k of octave4Keys) {
    assert.equal(k.octave, 4);
  }
});
