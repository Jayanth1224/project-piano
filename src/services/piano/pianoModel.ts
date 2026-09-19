export interface PianoKey {
  id: string; // e.g. "C4", "C#4"
  midiNote: number; // 21 to 108
  noteName: string; // "C", "C#", "D", etc.
  octave: number; // 0 to 8
  isBlack: boolean;
  whiteIndex: number; // Index among white keys (0 to 51)
  xStart: number; // Normalized 0..1 across full 88-key width
  xEnd: number; // Normalized 0..1
  yStart: number; // Normalized 0..1
  yEnd: number; // Normalized 0..1 (black keys: ~0.65, white keys: 1.0)
}

export const TOTAL_KEYS = 88;
export const TOTAL_WHITE_KEYS = 52;
export const TOTAL_BLACK_KEYS = 36;
export const LOWEST_MIDI = 21; // A0
export const HIGHEST_MIDI = 108; // C8

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Generates the full 88-key mathematical piano layout.
 * Accurately calculates normalized (0..1) bounding boxes for all 52 white keys
 * and 36 black keys.
 */
export function generate88Keys(): PianoKey[] {
  const keys: PianoKey[] = [];
  const whiteKeyWidth = 1.0 / TOTAL_WHITE_KEYS; // ~0.01923
  const blackKeyWidth = whiteKeyWidth * 0.65;
  const blackKeyHeight = 0.65;

  let whiteKeyCounter = 0;

  // First pass: generate white keys to establish horizontal positions
  const midiToWhiteIndex = new Map<number, number>();

  for (let midi = LOWEST_MIDI; midi <= HIGHEST_MIDI; midi++) {
    const noteInOctave = midi % 12;
    const isBlack = [1, 3, 6, 8, 10].includes(noteInOctave); // C#, D#, F#, G#, A#
    if (!isBlack) {
      midiToWhiteIndex.set(midi, whiteKeyCounter);
      whiteKeyCounter++;
    }
  }

  // Second pass: construct all keys with exact coordinates
  for (let midi = LOWEST_MIDI; midi <= HIGHEST_MIDI; midi++) {
    const noteIndex = midi % 12;
    const noteName = NOTE_NAMES[noteIndex];
    const octave = Math.floor(midi / 12) - 1;
    const id = `${noteName}${octave}`;
    const isBlack = [1, 3, 6, 8, 10].includes(noteIndex);

    if (!isBlack) {
      const wIndex = midiToWhiteIndex.get(midi)!;
      const xStart = wIndex * whiteKeyWidth;
      const xEnd = (wIndex + 1) * whiteKeyWidth;

      keys.push({
        id,
        midiNote: midi,
        noteName,
        octave,
        isBlack: false,
        whiteIndex: wIndex,
        xStart,
        xEnd,
        yStart: 0.0,
        yEnd: 1.0,
      });
    } else {
      // Black key sits between the previous white key and the next white key
      const prevWhiteIndex = midiToWhiteIndex.get(midi - 1)!;
      // Border between previous white key and next white key
      const borderX = (prevWhiteIndex + 1) * whiteKeyWidth;
      const xStart = borderX - blackKeyWidth / 2;
      const xEnd = borderX + blackKeyWidth / 2;

      keys.push({
        id,
        midiNote: midi,
        noteName,
        octave,
        isBlack: true,
        whiteIndex: prevWhiteIndex,
        xStart,
        xEnd,
        yStart: 0.0,
        yEnd: blackKeyHeight,
      });
    }
  }

  return keys;
}

/**
 * Hit test a normalized coordinate (x, y in [0, 1]) against the 88-key layout.
 * Black keys are tested first to respect visual and physical layering.
 */
export function getKeyAtCoordinate(
  x: number,
  y: number,
  keys: PianoKey[]
): PianoKey | null {
  if (x < 0 || x > 1 || y < 0 || y > 1) {
    return null;
  }

  // 1. Check black keys first (top layer precedence)
  for (const key of keys) {
    if (key.isBlack) {
      if (x >= key.xStart && x <= key.xEnd && y >= key.yStart && y <= key.yEnd) {
        return key;
      }
    }
  }

  // 2. Check white keys
  for (const key of keys) {
    if (!key.isBlack) {
      if (x >= key.xStart && x <= key.xEnd && y >= key.yStart && y <= key.yEnd) {
        return key;
      }
    }
  }

  return null;
}

export const PIANO_88_KEYS: PianoKey[] = generate88Keys();

/**
 * Filter keys belonging to a specific octave range (e.g. octaves 3 to 5).
 */
export function getKeysInOctaveRange(
  minOctave: number,
  maxOctave: number,
  keys: PianoKey[] = PIANO_88_KEYS
): PianoKey[] {
  return keys.filter((k) => k.octave >= minOctave && k.octave <= maxOctave);
}
