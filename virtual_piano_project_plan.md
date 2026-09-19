# Virtual Piano — Project Plan

## 1. Project Vision

Build a **software-only virtual piano** that lets a person learn and play piano without owning a physical piano.

The user chooses a physical location in a room as the piano's "home." When the application is turned on, it displays an 88-key piano in that space, tracks both hands through the camera, converts finger movements into piano key presses, and produces piano audio.

When the application is closed, the piano disappears completely and takes up no physical space.

The long-term goal is more than a novelty demo:

> **A virtual piano + piano-learning environment that can replace the need for a beginner to buy a physical keyboard for basic learning and practice.**

---

# 2. Product Goals

### Core goals

- Play an 88-key piano using only a webcam and computer.
- Track both hands simultaneously.
- Track all 10 fingers.
- Detect virtual key presses and releases.
- Produce polyphonic piano audio.
- Visualize the keyboard clearly.
- Allow calibration to a fixed physical location.
- Remember the virtual piano's location.
- Provide a beginner-friendly learning mode.
- Require no physical piano or MIDI keyboard.

### Non-goals for MVP

- Perfect physical-piano realism.
- Professional-level pianist technique analysis.
- Hardware-level velocity sensing.
- Full AR glasses support.
- Realistic pedal hardware.
- AI-driven teaching during the real-time audio loop.

---

# 3. Core User Experience

The intended flow:

```text
Open app
   ↓
Camera turns on
   ↓
Select / calibrate piano area
   ↓
88-key virtual piano appears
   ↓
Place hands over the keyboard
   ↓
Move fingers toward virtual keys
   ↓
Key press detected
   ↓
Piano note plays
   ↓
Move finger away
   ↓
Key released
```

The piano should feel like a persistent virtual object in the user's room.

Example:

```text
                CAMERA VIEW

        ┌───────────────────────────┐
        │                           │
        │       User's hands        │
        │          ↓ ↓ ↓            │
        │                           │
        │  ┌─────────────────────┐  │
        │  │     VIRTUAL PIANO   │  │
        │  │ ▌ ▌ ▌  ▌ ▌ ▌  ▌ ▌   │  │
        │  │ C D E F G A B ...    │  │
        │  └─────────────────────┘  │
        │                           │
        └───────────────────────────┘
```

---

# 4. High-Level Architecture

```text
                         WEBCAM
                            │
                            ▼
                  ┌──────────────────┐
                  │ MediaPipe Hands  │
                  └──────────────────┘
                            │
               21 landmarks × 2 hands
                            │
                            ▼
                ┌─────────────────────┐
                │ Hand/Finger Tracker │
                └─────────────────────┘
                            │
                            ▼
                ┌─────────────────────┐
                │ Coordinate Mapping  │
                │ + Calibration       │
                └─────────────────────┘
                            │
                            ▼
                ┌─────────────────────┐
                │ Finger → Key Engine │
                └─────────────────────┘
                            │
                     note + velocity
                            │
                            ▼
                ┌─────────────────────┐
                │    Piano Engine     │
                └─────────────────────┘
                            │
                            ▼
                ┌─────────────────────┐
                │ Tone.js / Web Audio │
                └─────────────────────┘
                            │
                            ▼
                         AUDIO
```

The visual layer is separate:

```text
Camera
  │
  ├── video background
  │
  └── Three.js / Canvas
          │
          └── virtual piano
```

---

# 5. Recommended Technology Stack

## Frontend

- Next.js
- React
- TypeScript

## Vision

- MediaPipe Hand Landmarker
- Optional MediaPipe Pose later

## Rendering

- Three.js
- React Three Fiber, if useful
- HTML/CSS overlay for labels and controls

## Audio

- Tone.js
- Web Audio API
- AudioWorklet for custom DSP if needed later

## Data

For the MVP, avoid a backend if possible.

Use:

- LocalStorage / IndexedDB for calibration
- Local files for songs
- Browser memory for active sessions

A backend can be added later for accounts, progress sync, and cloud lessons.

---

# 6. Why There Should Be No LLM in the Real-Time Loop

Do **not** send every hand movement to Gemini/OpenAI.

The real-time loop needs to be deterministic and low latency.

The real-time path should be:

```text
Camera
  ↓
Vision model
  ↓
Coordinates
  ↓
Gesture logic
  ↓
Note event
  ↓
Audio
```

An LLM can be used later for:

- Piano lessons
- Practice plans
- Song explanations
- Chord explanations
- Music theory
- Personalized exercises
- Feedback summaries
- Natural-language controls

Example:

> "Give me a 15-minute exercise for learning C major."

The LLM generates the lesson, but the actual piano interaction stays deterministic.

---

# 7. MVP Scope

The first playable prototype should contain only these features:

### Required

- Webcam input
- One-hand tracking
- Two-hand tracking
- Finger landmarks
- Virtual keyboard
- Calibration
- 88 keys
- Note triggering
- Note release
- Polyphony
- Basic piano sound
- Visual key highlighting
- Keyboard labels
- Start/stop button
- Camera permission handling

### Nice-to-have

- Sustain
- Octave selection
- Volume
- Metronome
- Recording

Do not build song learning before free-play works reliably.

---

# 8. Virtual Piano Representation

Represent the piano mathematically.

The piano consists of:

- 52 white keys
- 36 black keys
- 88 total keys

Recommended MVP representation:

```ts
type PianoKey = {
  id: string;
  midiNote: number;
  noteName: string;
  octave: number;
  type: "white" | "black";
  xStart: number;
  xEnd: number;
};
```

Example:

```text
A0
A#0
B0
C1
C#1
D1
...
C8
```

Use MIDI note numbers internally.

The mapping should be:

```text
finger position
      ↓
normalized X/Y/Z
      ↓
piano coordinate
      ↓
key ID
      ↓
MIDI note
      ↓
audio engine
```

---

# 9. Calibration System

Calibration is one of the most important parts of the project.

The app should not assume that the camera is perfectly positioned.

## Calibration flow

### Step 1

Show the piano outline.

### Step 2

User places the virtual piano where desired.

### Step 3

User confirms:

- left edge
- right edge
- keyboard depth
- keyboard height

### Step 4

Store calibration.

Example:

```ts
type PianoCalibration = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  depthReference: number;
};
```

Store in IndexedDB or LocalStorage.

---

# 10. Mapping Fingers to Keys

MediaPipe gives 21 landmarks per hand.

Important landmarks include:

```text
Wrist
Thumb
Index
Middle
Ring
Pinky
```

For each finger, track the fingertip.

The first approximation:

```text
finger.x → horizontal key location
finger.z → press depth
```

For example:

```text
          finger
             ↓
             │
             │
─────────────┼─────────────
             │
       virtual key plane
```

A press occurs when:

```text
fingerZ < pressThreshold
```

A release occurs when:

```text
fingerZ > releaseThreshold
```

Use hysteresis so the key does not rapidly toggle:

```text
PRESS  <  thresholdA
RELEASE > thresholdB
```

where:

```text
thresholdA < thresholdB
```

---

# 11. Finger → Key Mapping

For each frame:

```text
1. Get hand landmarks
2. Extract fingertips
3. Convert image coordinates to piano coordinates
4. Determine candidate key
5. Determine press state
6. Determine velocity
7. Emit note event
```

Pseudo-flow:

```ts
for (const finger of fingers) {
  const point = mapToPianoSpace(finger);

  const key = findKeyAt(point.x, point.y);

  const pressed = point.z < pressThreshold;

  if (pressed && !finger.wasPressed) {
    noteOn(key, estimateVelocity(finger));
  }

  if (!pressed && finger.wasPressed) {
    noteOff(key);
  }
}
```

---

# 12. Avoiding False Presses

This will probably be one of the hardest MVP problems.

Potential issues:

- Hand jitter
- Finger occlusion
- Crossing fingers
- Camera noise
- Fingers moving between keys
- One finger accidentally triggering two keys
- Hand detection dropping for a frame
- Depth estimation instability

Use:

### Smoothing

```text
raw position
    ↓
EMA / low-pass filter
    ↓
stable position
```

### Debouncing

Do not trigger repeated note-on events from tiny movements.

### Confidence thresholds

Only use landmarks when tracking confidence is sufficient.

### Hysteresis

Separate press and release thresholds.

### State machine

Each finger should have:

```text
IDLE
↓
APPROACHING
↓
PRESSED
↓
RELEASING
↓
IDLE
```

---

# 13. Velocity Detection

A real piano reacts differently depending on how hard the key is played.

A webcam cannot measure true key force.

Instead, approximate velocity from finger movement.

For example:

```text
vertical finger speed
        ↓
impact velocity
        ↓
MIDI velocity 0–127
```

Possible formula:

```text
velocity = clamp(
  abs(previousZ - currentZ) * scale,
  1,
  127
)
```

Later this can be improved using:

- acceleration
- distance from keyboard
- finger motion history
- hand-specific calibration

Do not optimize velocity before note detection is reliable.

---

# 14. Audio Engine

Use Tone.js for the first prototype.

Possible architectures:

### Option A — Synthesized piano

```text
note
 ↓
synth
 ↓
filter
 ↓
envelope
 ↓
reverb
```

Advantages:

- Small
- Simple
- Instant loading

Disadvantages:

- Less realistic

### Option B — Piano samples

Use recorded piano samples.

```text
C1 sample
C#1 sample
D1 sample
...
```

Use interpolation / pitch shifting where appropriate.

Advantages:

- More realistic
- Better for learning

Disadvantages:

- Larger asset size

Recommended:

**Prototype with synth → switch to sampled piano when interaction is stable.**

---

# 15. Polyphony

The system must support multiple simultaneous notes.

Example:

```text
C + E + G
```

should play as a C major chord.

Never use a single global oscillator.

The audio engine should manage active voices:

```ts
Map<MidiNote, Voice>
```

Example:

```text
noteOn(60)
noteOn(64)
noteOn(67)

        ↓

C voice
E voice
G voice

        ↓

C major chord
```

---

# 16. Sustain Pedal — Future

A physical pedal does not exist in MVP.

Possible later implementations:

### Gesture pedal

Foot position from pose tracking.

### Keyboard shortcut

Example:

```text
Space = sustain
```

### UI button

Useful initially for testing.

---

# 17. Visual Piano

Use Three.js or Canvas.

The keyboard should visually respond to:

```text
pressed
released
hovered
correct
incorrect
```

Example:

```text
Normal

┌───┬───┬───┬───┬───┐
│ C │ D │ E │ F │ G │
└───┴───┴───┴───┴───┘


Pressed

┌───┬───┬───┬───┬───┐
│ C │███│ E │ F │ G │
└───┴───┴───┴───┴───┘
```

The key animation should have extremely low latency.

---

# 18. Piano Placement

There are two stages.

## Stage 1 — Screen-space piano

The piano exists on the screen over the webcam feed.

This is the easiest and should be MVP.

## Stage 2 — Room-space piano

The piano is anchored to a real location in the room.

Possible future technologies:

- WebXR
- ARKit / ARCore
- Browser spatial tracking
- Marker-based calibration
- Plane detection

Do not make room-scale AR a blocker for MVP.

---

# 19. Persistent Piano Corner

The user chooses:

> "This is where my piano lives."

The app stores:

```text
Piano position
Piano scale
Camera calibration
Keyboard orientation
Press depth
```

Then every session can restore the same setup.

Long-term:

```text
Open app
   ↓
Camera
   ↓
Load calibration
   ↓
Piano appears in same location
```

---

# 20. Learning Mode

After Free Play works, build learning.

## Stage 1 — Keyboard Familiarity

Display:

```text
C D E F G A B
```

Teach:

- Key names
- Octaves
- Middle C
- Black-key pattern
- Octave relationships

---

# 21. Falling Notes

Create a Guitar-Hero-style falling-note system.

```text
                  C
                  ↓
                  ↓
                  ↓
────────────────────────────
 C   D   E   F   G   A   B
```

The user must play the correct key at the correct time.

This provides:

- Visual guidance
- Timing feedback
- Song learning
- Motivation

---

# 22. MIDI Support

Use MIDI as the canonical song format.

Pipeline:

```text
MIDI file
   ↓
Parse notes
   ↓
Timeline
   ↓
Visual note objects
   ↓
Practice engine
```

A note contains:

```ts
type SongNote = {
  midiNote: number;
  startTime: number;
  duration: number;
  velocity: number;
};
```

---

# 23. Practice Feedback

After each song:

```text
Accuracy: 84%

Timing
  Good      ████████
  Early     ██
  Late      █

Wrong Notes
  7

Best Section
  Chorus

Needs Practice
  Left-hand chord transitions
```

Avoid making the feedback overly complicated in V1.

---

# 24. Finger Guidance

Eventually show suggested finger numbers:

```text
Right hand

5   4   3   2   1
│   │   │   │   │
C   D   E   F   G
```

The hand tracker can recognize which finger is being used.

This can allow:

```text
Correct finger
      ↓
     ✓

Wrong finger
      ↓
     !
```

This feature should come after reliable finger tracking.

---

# 25. Song Learning Flow

Recommended:

```text
Choose song
    ↓
Difficulty
    ↓
Slow / Normal / Fast
    ↓
Practice right hand
    ↓
Practice left hand
    ↓
Combine hands
    ↓
Full song
```

Add tempo control:

```text
50%
75%
100%
125%
```

---

# 26. AI Teacher — Later

The LLM should sit above the learning engine.

Example:

```text
User:
"I keep messing up the transition between C and G."

       ↓

AI Teacher

       ↓

Analyze practice history

       ↓

"I'll give you a 5-minute
C → G transition exercise."
```

Other commands:

> "Teach me the notes in C major."

> "Why does this chord sound wrong?"

> "Create a beginner practice session."

> "What should I practice tomorrow?"

The AI should generate instructions and exercises, not control the audio loop.

---

# 27. Recording

Add a simple record button.

```text
RECORD
   ↓
Note events
   ↓
Timeline
   ↓
Playback
```

Eventually:

- Export MIDI
- Save recordings
- Compare takes
- Practice history

---

# 28. Development Phases

## Phase 0 — Technical Spike

Goal:

Prove:

```text
Webcam
+
hand tracking
+
one virtual key
+
sound
```

Success criteria:

A finger moving into a defined region reliably plays one piano note.

---

## Phase 1 — Virtual Keyboard

Build:

- 88 keys
- keyboard renderer
- key coordinates
- note mapping
- audio engine
- polyphony

Success criteria:

You can play simple melodies and chords.

---

## Phase 2 — Two-Hand Tracking

Build:

- left hand
- right hand
- 10 fingers
- finger states
- smoothing
- debouncing

Success criteria:

Both hands can independently play notes without excessive false triggers.

---

## Phase 3 — Calibration

Build:

- keyboard placement
- depth calibration
- saved calibration
- reset calibration

Success criteria:

User can place the piano in the same corner and reuse it.

---

## Phase 4 — Learning Mode

Build:

- key labels
- exercises
- falling notes
- timing
- wrong-note detection
- accuracy score

Success criteria:

A beginner can learn a short song.

---

## Phase 5 — MIDI / Songs

Build:

- MIDI parser
- song timeline
- note visualization
- playback
- tempo control

Success criteria:

A MIDI song can be loaded and practiced.

---

## Phase 6 — AI Teacher

Build:

- practice history
- LLM lesson generation
- personalized exercises
- natural-language music questions

Success criteria:

The user can ask the system what to practice and receive useful exercises.

---

## Phase 7 — Spatial / AR Piano

Build:

- room placement
- persistent piano location
- 3D orientation
- spatial rendering

Success criteria:

The piano appears anchored to a physical location.

---

# 29. Recommended MVP UI

Keep the first UI extremely simple.

```text
┌──────────────────────────────────────────────┐
│ Virtual Piano                         ⚙      │
├──────────────────────────────────────────────┤
│                                              │
│              CAMERA VIEW                     │
│                                              │
│            Your hands here                   │
│                                              │
│                                              │
├──────────────────────────────────────────────┤
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │       88-KEY VIRTUAL PIANO             │  │
│  └────────────────────────────────────────┘  │
│                                              │
├──────────────────────────────────────────────┤
│ Free Play │ Learn │ Songs │ Record          │
└──────────────────────────────────────────────┘
```

---

# 30. Performance Requirements

Target:

- Camera processing: real-time
- Visual response: ideally 60 FPS
- Audio latency: as low as possible
- Note triggering: <50 ms perceived response if practical
- No server round-trip for note generation
- No LLM calls during playing

Use browser profiling early.

The audio path should remain independent from React rendering as much as possible.

---

# 31. Major Risks

## Risk 1 — Depth estimation

A standard webcam does not provide perfect physical depth.

Mitigation:

- Use relative depth
- Calibrate press plane
- Use hand world coordinates
- Combine position + velocity + state

---

## Risk 2 — Occluded fingers

Hands can hide fingers from each other.

Mitigation:

- Use both-hand tracking
- Smooth short tracking gaps
- Avoid triggering notes from low-confidence landmarks

---

## Risk 3 — Realism

The system may feel like a game instead of a piano.

Mitigation:

- High-quality piano samples
- Good key animations
- Immediate audio
- Correct sustain behavior
- Good visual alignment

---

## Risk 4 — False notes

This is probably the biggest UX risk.

Mitigation:

- Hysteresis
- Debouncing
- Confidence thresholds
- Temporal smoothing
- Finger state machines
- Calibration

---

## Risk 5 — User expects physical feedback

The software cannot replace tactile feedback.

Mitigation:

Position the product as:

> A zero-cost virtual piano for learning and basic practice.

Not:

> A perfect replacement for a professional piano.

---

# 32. First Prototype Success Test

Do not start by building the entire application.

The first test should literally be:

```text
Camera
   ↓
One hand
   ↓
Index finger
   ↓
Virtual C key
   ↓
Finger moves down
   ↓
C plays
   ↓
Finger moves up
   ↓
C stops
```

Then:

```text
C → D → E → F → G
```

Then:

```text
C + E + G
```

Then:

```text
Left hand + right hand
```

Only after those work should the full 88-key system be built.

---

# 33. Suggested Folder Structure

```text
virtual-piano/
│
├── app/
│   ├── page.tsx
│   ├── play/
│   ├── learn/
│   └── songs/
│
├── components/
│   ├── CameraView.tsx
│   ├── VirtualPiano.tsx
│   ├── PianoKey.tsx
│   ├── HandOverlay.tsx
│   ├── Calibration.tsx
│   └── FallingNotes.tsx
│
├── lib/
│   ├── tracking/
│   │   ├── hands.ts
│   │   ├── landmarks.ts
│   │   └── smoothing.ts
│   │
│   ├── piano/
│   │   ├── keys.ts
│   │   ├── mapping.ts
│   │   ├── state.ts
│   │   └── calibration.ts
│   │
│   ├── audio/
│   │   ├── engine.ts
│   │   ├── piano.ts
│   │   └── voices.ts
│   │
│   └── songs/
│       ├── midi.ts
│       └── timeline.ts
│
├── public/
│   ├── audio/
│   └── songs/
│
└── README.md
```

---

# 34. Definition of Done — MVP

The MVP is complete when:

- [ ] Camera works
- [ ] Both hands are tracked
- [ ] 10 fingertips can be identified
- [ ] Virtual piano renders
- [ ] Piano can be calibrated
- [ ] Finger-to-key mapping works
- [ ] Note-on works
- [ ] Note-off works
- [ ] Multiple notes can play simultaneously
- [ ] Piano sound is acceptable
- [ ] Keys visually respond
- [ ] Calibration persists
- [ ] Free-play mode is usable
- [ ] No server is required to play
- [ ] Piano disappears when the app is closed

---

# 35. Definition of Done — Learning Version

After MVP:

- [ ] Keyboard note labels
- [ ] Middle C training
- [ ] Scales
- [ ] Chords
- [ ] Falling-note mode
- [ ] MIDI import
- [ ] Timing accuracy
- [ ] Wrong-note feedback
- [ ] Practice history
- [ ] Finger guidance
- [ ] Slow-motion practice
- [ ] Recording
- [ ] MIDI export

---

# 36. Long-Term Product Vision

The final system could become:

```text
                 VIRTUAL PIANO
                       │
       ┌───────────────┼────────────────┐
       │               │                │
       ▼               ▼                ▼
   FREE PLAY         LEARN            SONGS
       │               │                │
       │          ┌────┴─────┐          │
       │          │          │          │
       ▼          ▼          ▼          ▼
   Recording   Exercises  Teacher     MIDI
                       │
                       ▼
                  AI COACH
                       │
                       ▼
               Personalized lessons
```

The key product principle should remain:

> **No physical piano. No permanent setup. No dedicated room. Open the app, practice, close it, and the piano disappears.**

---

# 37. Recommended Build Order

Build exactly in this order:

```text
1. Webcam
        ↓
2. MediaPipe hand tracking
        ↓
3. One virtual key
        ↓
4. One note
        ↓
5. Five white keys
        ↓
6. Full octave
        ↓
7. Full 88-key keyboard
        ↓
8. Two hands
        ↓
9. Polyphony
        ↓
10. Calibration
        ↓
11. Better piano audio
        ↓
12. Free-play polish
        ↓
13. Learning mode
        ↓
14. MIDI
        ↓
15. Falling notes
        ↓
16. Practice analytics
        ↓
17. AI teacher
        ↓
18. Spatial / AR placement
```

The most important rule:

**Do not start with AR, AI teaching, songs, or fancy visuals.**

First make:

**finger → key → sound**

feel instant and reliable.

Once that works, everything else becomes an expansion of the same system.
