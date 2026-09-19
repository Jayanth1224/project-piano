import * as Tone from 'tone';

export interface AudioEngineStatus {
  isReady: boolean;
  contextState: AudioContextState;
  error?: string;
}

class PianoAudioService {
  private synth: Tone.PolySynth | null = null;
  private isInitialized = false;
  private activeNotes: Set<string> = new Set();

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
        // Acoustic-inspired piano synth with fast attack and exponential decay
        this.synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: {
            type: 'triangle',
          },
          envelope: {
            attack: 0.005,
            decay: 1.5,
            sustain: 0.2,
            release: 0.8,
          },
          volume: -4,
        });

        // Add warmth with a subtle low-pass filter and small hall reverb
        const filter = new Tone.Filter({
          frequency: 3500,
          type: 'lowpass',
          rolloff: -12,
        });

        const reverb = new Tone.Reverb({
          decay: 1.5,
          preDelay: 0.01,
          wet: 0.15,
        });

        this.synth.chain(filter, reverb, Tone.getDestination());
      }

      this.isInitialized = true;

      return {
        isReady: true,
        contextState: Tone.getContext().state,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to initialize PianoAudioService:', err);
      return {
        isReady: false,
        contextState: Tone.getContext().state,
        error: message,
      };
    }
  }

  isReady(): boolean {
    return this.isInitialized && Tone.getContext().state === 'running';
  }

  /**
   * Trigger note attack.
   * @param note Note name with octave, e.g. "C4"
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
   * Stop all sounding notes immediately.
   */
  stopAll(): void {
    if (!this.synth) return;
    this.synth.releaseAll();
    this.activeNotes.clear();
  }
}

export const pianoAudio = new PianoAudioService();
