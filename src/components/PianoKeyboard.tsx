import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  type PianoKey,
  PIANO_88_KEYS,
  getKeysInOctaveRange,
} from '../services/piano/pianoModel.ts';

interface PianoKeyboardProps {
  activeNotes: string[];
  onNoteDown: (noteId: string, velocity?: number) => void;
  onNoteUp: (noteId: string) => void;
}

// Computer Keyboard Mapping centered around Middle C (C4)
const KEYBOARD_MAP: Record<string, string> = {
  // Octave 4
  KeyA: 'C4',
  KeyW: 'C#4',
  KeyS: 'D4',
  KeyE: 'D#4',
  KeyD: 'E4',
  KeyF: 'F4',
  KeyT: 'F#4',
  KeyG: 'G4',
  KeyY: 'G#4',
  KeyH: 'A4',
  KeyU: 'A#4',
  KeyJ: 'B4',
  // Octave 5
  KeyK: 'C5',
  KeyO: 'C#5',
  KeyL: 'D5',
  KeyP: 'D#5',
  Semicolon: 'E5',
  Quote: 'F5',
};

// Reverse map for keycap labels
const NOTE_TO_KEYCAP: Record<string, string> = Object.entries(KEYBOARD_MAP).reduce(
  (acc, [code, note]) => {
    const label = code.replace('Key', '').replace('Semicolon', ';').replace('Quote', "'");
    acc[note] = label;
    return acc;
  },
  {} as Record<string, string>
);

export const PianoKeyboard: React.FC<PianoKeyboardProps> = ({
  activeNotes,
  onNoteDown,
  onNoteUp,
}) => {
  const [viewMode, setViewMode] = useState<'focused' | 'full'>('focused');
  const [baseOctave, setBaseOctave] = useState<number>(3); // Focused mode covers [baseOctave, baseOctave + 2]
  const [isPointerDown, setIsPointerDown] = useState<boolean>(false);

  // Filter keys depending on view mode
  const displayedKeys = useMemo(() => {
    if (viewMode === 'full') {
      return PIANO_88_KEYS;
    }
    return getKeysInOctaveRange(baseOctave, baseOctave + 2);
  }, [viewMode, baseOctave]);

  // Separate white and black keys for proper layered DOM rendering
  const whiteKeys = useMemo(() => displayedKeys.filter((k) => !k.isBlack), [displayedKeys]);
  const blackKeys = useMemo(() => displayedKeys.filter((k) => k.isBlack), [displayedKeys]);

  // Calculate relative left % and width % for displayed keys
  const minX = displayedKeys[0]?.xStart ?? 0;
  const maxX = displayedKeys[displayedKeys.length - 1]?.xEnd ?? 1;
  const rangeWidth = Math.max(0.0001, maxX - minX);

  const getKeyStyle = useCallback(
    (key: PianoKey) => {
      const leftPercent = ((key.xStart - minX) / rangeWidth) * 100;
      const widthPercent = ((key.xEnd - key.xStart) / rangeWidth) * 100;

      return {
        left: `${leftPercent}%`,
        width: `${widthPercent}%`,
        height: key.isBlack ? '64%' : '100%',
      };
    },
    [minX, rangeWidth]
  );

  // Handle pointer interactions (clicks and glissando drags)
  const handlePointerDown = (noteId: string, e: React.PointerEvent) => {
    e.preventDefault();
    setIsPointerDown(true);
    onNoteDown(noteId, 0.85);
  };

  const handlePointerEnter = (noteId: string) => {
    if (isPointerDown) {
      onNoteDown(noteId, 0.85);
    }
  };

  const handlePointerLeave = (noteId: string) => {
    if (isPointerDown) {
      onNoteUp(noteId);
    }
  };

  const handlePointerUp = (noteId: string) => {
    setIsPointerDown(false);
    onNoteUp(noteId);
  };

  // Global window pointer up to cancel dragging
  useEffect(() => {
    const handleGlobalUp = () => setIsPointerDown(false);
    window.addEventListener('pointerup', handleGlobalUp);
    return () => window.removeEventListener('pointerup', handleGlobalUp);
  }, []);

  // Computer keyboard listeners
  useEffect(() => {
    const pressedKeyCodes = new Set<string>();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const note = KEYBOARD_MAP[e.code];
      if (note && !pressedKeyCodes.has(e.code)) {
        pressedKeyCodes.add(e.code);
        onNoteDown(note, 0.85);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const note = KEYBOARD_MAP[e.code];
      if (note && pressedKeyCodes.has(e.code)) {
        pressedKeyCodes.delete(e.code);
        onNoteUp(note);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [onNoteDown, onNoteUp]);

  return (
    <div className="piano-container">
      {/* Viewport & Octave Controls Bar */}
      <div className="piano-controls-bar">
        <div className="view-mode-toggles">
          <button
            className={`mode-btn ${viewMode === 'focused' ? 'active' : ''}`}
            onClick={() => setViewMode('focused')}
          >
            Playable Zoom (3 Octaves)
          </button>
          <button
            className={`mode-btn ${viewMode === 'full' ? 'active' : ''}`}
            onClick={() => setViewMode('full')}
          >
            Full 88 Keys
          </button>
        </div>

        {viewMode === 'focused' && (
          <div className="octave-stepper">
            <button
              className="octave-btn"
              disabled={baseOctave <= 1}
              onClick={() => setBaseOctave((o) => Math.max(1, o - 1))}
              title="Lower Octave"
            >
              ◀ Octave Down
            </button>
            <span className="octave-label">
              Octaves C{baseOctave} – C{baseOctave + 2}
            </span>
            <button
              className="octave-btn"
              disabled={baseOctave >= 5}
              onClick={() => setBaseOctave((o) => Math.min(5, o + 1))}
              title="Higher Octave"
            >
              Octave Up ▶
            </button>
          </div>
        )}

        <div className="keyboard-hint">
          <span>QWERTY: Keys <strong>A-K</strong> play Middle C octave</span>
        </div>
      </div>

      {/* Main Interactive Keyboard Bed */}
      <div className="keyboard-bed">
        {/* White Keys Layer */}
        <div className="keys-layer white-layer">
          {whiteKeys.map((key) => {
            const isPressed = activeNotes.includes(key.id);
            const isMiddleC = key.id === 'C4';
            const keycap = NOTE_TO_KEYCAP[key.id];

            return (
              <div
                key={key.id}
                className={`piano-key white-key ${isPressed ? 'pressed' : ''} ${isMiddleC ? 'middle-c' : ''}`}
                style={getKeyStyle(key)}
                onPointerDown={(e) => handlePointerDown(key.id, e)}
                onPointerEnter={() => handlePointerEnter(key.id)}
                onPointerLeave={() => handlePointerLeave(key.id)}
                onPointerUp={() => handlePointerUp(key.id)}
              >
                {/* Middle C Badge */}
                {isMiddleC && <div className="middle-c-marker">C4</div>}

                {/* Octave label on all C keys */}
                {key.noteName === 'C' && (
                  <span className="octave-indicator">C{key.octave}</span>
                )}

                {/* Computer Keycap */}
                {keycap && viewMode === 'focused' && (
                  <span className="keycap-label">{keycap}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Black Keys Layer */}
        <div className="keys-layer black-layer">
          {blackKeys.map((key) => {
            const isPressed = activeNotes.includes(key.id);
            const keycap = NOTE_TO_KEYCAP[key.id];

            return (
              <div
                key={key.id}
                className={`piano-key black-key ${isPressed ? 'pressed' : ''}`}
                style={getKeyStyle(key)}
                onPointerDown={(e) => handlePointerDown(key.id, e)}
                onPointerEnter={() => handlePointerEnter(key.id)}
                onPointerLeave={() => handlePointerLeave(key.id)}
                onPointerUp={() => handlePointerUp(key.id)}
              >
                {/* Computer Keycap */}
                {keycap && viewMode === 'focused' && (
                  <span className="keycap-label black-keycap">{keycap}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
