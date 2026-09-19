import * as Tone from 'tone';

export interface AudioEngineStatus {
  isReady: boolean;
  contextState: AudioContextState;
  activeVoices: number;
  error?: string;
}

class PianoAudioService {
  private synth: Tone.PolySynth | null = null;
  private isInitialized = false;
  private activeNotes: Set<string> = new Set();
  private limiter: Tone.Limiter | null = null;

  /**
   * Initialize Tone.js audio context and polyphonic synthesizer.
   * Must be called in response to a user gesture to satisfy browser autoplay policies.
   */
  async initAudio(): Promise<AudioEngineStatus> {
    try {
      if (Tone.getContext().state !== 'running') {
        await Tone.start();
      }

      if (!this.synth) {
        // Master Limiter to prevent clipping when multi-note chords are struck
        this.limiter = new Tone.Limiter(-2);

        // Acoustic-inspired polyphonic synth with 32 voices
        this.synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: {
            type: 'triangle',
          },
          envelope: {
            attack: 0.005,
            decay: 1.8,
            sustain: 0.25,
            release: 1.0,
          },
          volume: -6,
        });
        this.synth.maxPolyphony = 32;

        // Add warmth with a subtle low-pass filter and room reverb
        const filter = new Tone.Filter({
          frequency: 4200,
          type: 'lowpass',
          rolloff: -12,
        });

        const reverb = new Tone.Reverb({
          decay: 1.8,
          preDelay: 0.01,
          wet: 0.18,
        });

        this.synth.chain(filter, reverb, this.limiter, Tone.getDestination());
      }

      this.isInitialized = true;

      return {
        isReady: true,
        contextState: Tone.getContext().state,
        activeVoices: this.activeNotes.size,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to initialize PianoAudioService:', err);
      return {
        isReady: false,
        contextState: Tone.getContext().state,
        activeVoices: 0,
        error: message,
      };
    }
  }

  isReady(): boolean {
    return this.isInitialized && Tone.getContext().state === 'running';
  }

  /**
   * Trigger note attack.
   * @param note Note name with octave, e.g. "C4", "F#3"
   * @param velocity Normalized velocity between 0.0 and 1.0
   */
  triggerNote(note = 'C4', velocity = 0.8): void {
    if (!this.synth || !this.isReady()) return;

    if (!this.activeNotes.has(note)) {
      this.activeNotes.add(note);
      this.synth.triggerAttack(note, Tone.now(), Math.max(0.1, Math.min(1.0, velocity)));
    }
  }

  /**
   * Trigger multiple notes simultaneously (chord).
   */
  triggerChord(notes: string[], velocity = 0.8): void {
    if (!this.synth || !this.isReady()) return;

    const unplayedNotes: string[] = [];
    for (const note of notes) {
      if (!this.activeNotes.has(note)) {
        this.activeNotes.add(note);
        unplayedNotes.push(note);
      }
    }

    if (unplayedNotes.length > 0) {
      this.synth.triggerAttack(unplayedNotes, Tone.now(), Math.max(0.1, Math.min(1.0, velocity)));
    }
  }

  /**
   * Trigger note release.
   * @param note Note name with octave, e.g. "C4"
   */
  releaseNote(note = 'C4'): void {
    if (!this.synth || !this.isReady()) return;

    if (this.activeNotes.has(note)) {
      this.activeNotes.delete(note);
      this.synth.triggerRelease(note, Tone.now());
    }
  }

  /**
   * Release multiple notes simultaneously.
   */
  releaseChord(notes: string[]): void {
    if (!this.synth || !this.isReady()) return;

    const notesToRelease: string[] = [];
    for (const note of notes) {
      if (this.activeNotes.has(note)) {
        this.activeNotes.delete(note);
        notesToRelease.push(note);
      }
    }

    if (notesToRelease.length > 0) {
      this.synth.triggerRelease(notesToRelease, Tone.now());
    }
  }

  /**
   * Get all currently sounding notes.
   */
  getActiveNotes(): string[] {
    return Array.from(this.activeNotes);
  }

  /**
   * Stop all sounding notes immediately.
   */
  stopAll(): void {
    if (!this.synth) return;
    this.synth.releaseAll();
    this.activeNotes.clear();
  }
}

export const pianoAudio = new PianoAudioService();
