import { createSoundOutput, getAudioContext, playTone, type SoundOutput } from './soundManager'

/**
 * Ambient background music generated procedurally (pad + soft arpeggio), so no
 * audio file is needed.
 */

/** Actual maximum gain; UI volume 1.0 maps to this value. */
const MAX_MUSIC_GAIN = 0.35
const VOLUME_SMOOTHING_SECONDS = 0.05

const FIRST_STEP_DELAY_SECONDS = 0.1
const STEP_DURATION_SECONDS = 0.5
const STEPS_PER_CHORD = 8
const SCHEDULER_INTERVAL_MS = 100
const SCHEDULE_LOOKAHEAD_SECONDS = 0.3

const LOWPASS_CUTOFF_HZ = 1600
const PAD_PEAK_GAIN = 0.07
const PAD_ATTACK_SECONDS = 1.2
const PLUCK_PEAK_GAIN = 0.05
const PLUCK_ATTACK_SECONDS = 0.02
const PLUCK_DURATION_SECONDS = 0.9

/** Calm progression (Am - F - C - G) as MIDI notes. */
const CHORD_PROGRESSION: readonly (readonly number[])[] = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62],
]

/** Chord note index per step; -1 is a rest. */
const ARPEGGIO_PATTERN: readonly number[] = [0, 1, 2, 1, -1, 2, 1, -1]
const ARPEGGIO_OCTAVE_SHIFT = 12

function midiToFrequency(midiNote: number): number {
  return 440 * Math.pow(2, (midiNote - 69) / 12)
}

/**
 * Procedural music player. Notes are scheduled slightly ahead of time on a
 * timer (lookahead scheduling) so playback stays steady even if the main
 * thread is busy.
 */
export class BackgroundMusic {
  private context: AudioContext | null = null
  private output: SoundOutput | null = null
  private schedulerId: number | null = null
  private nextStepTime = 0
  private stepIndex = 0
  private volume = 0

  /** Starts (or resumes) the music. Must be called after a user gesture. */
  start(): void {
    const context = getAudioContext()
    if (!context || this.output) return

    this.context = context
    this.output = createSoundOutput(context, LOWPASS_CUTOFF_HZ, this.volume * MAX_MUSIC_GAIN)
    this.nextStepTime = context.currentTime + FIRST_STEP_DELAY_SECONDS
    this.schedulerId = window.setInterval(() => this.scheduleAhead(), SCHEDULER_INTERVAL_MS)
  }

  /** Normalized volume between 0 and 1. */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume))
    if (!this.context || !this.output) return

    this.output.gain.gain.setTargetAtTime(this.volume * MAX_MUSIC_GAIN, this.context.currentTime, VOLUME_SMOOTHING_SECONDS)
  }

  /** Stops scheduling and silences the music. `start()` can restart it afterwards. */
  dispose(): void {
    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId)
      this.schedulerId = null
    }
    this.output?.gain.disconnect()
    this.output = null
    this.context = null
  }

  private scheduleAhead(): void {
    if (!this.context) return

    const currentTime = this.context.currentTime
    this.skipMissedSteps(currentTime)

    const horizon = currentTime + SCHEDULE_LOOKAHEAD_SECONDS
    while (this.nextStepTime < horizon) {
      this.scheduleStep(this.stepIndex, this.nextStepTime)
      this.nextStepTime += STEP_DURATION_SECONDS
      this.stepIndex += 1
    }
  }

  /**
   * Browsers throttle timers in background tabs, so the scheduler can fall
   * behind the audio clock. Steps whose start time already passed are skipped
   * instead of scheduled in the past, which would make them all play at once.
   * The step index still advances so the chord progression stays in phase.
   */
  private skipMissedSteps(currentTime: number): void {
    if (this.nextStepTime >= currentTime) return

    const missedSteps = Math.ceil((currentTime - this.nextStepTime) / STEP_DURATION_SECONDS)
    this.nextStepTime += missedSteps * STEP_DURATION_SECONDS
    this.stepIndex += missedSteps
  }

  private scheduleStep(stepIndex: number, startTime: number): void {
    if (!this.output) return

    const { input } = this.output
    const chordIndex = Math.floor(stepIndex / STEPS_PER_CHORD) % CHORD_PROGRESSION.length
    const chord = CHORD_PROGRESSION[chordIndex]

    if (stepIndex % STEPS_PER_CHORD === 0) {
      const chordDuration = STEPS_PER_CHORD * STEP_DURATION_SECONDS
      chord.forEach((note) => {
        playTone(input, {
          frequency: midiToFrequency(note),
          waveform: 'triangle',
          startTime,
          duration: chordDuration,
          peakGain: PAD_PEAK_GAIN,
          attackSeconds: PAD_ATTACK_SECONDS,
        })
      })
    }

    const arpeggioNoteIndex = ARPEGGIO_PATTERN[stepIndex % ARPEGGIO_PATTERN.length]
    if (arpeggioNoteIndex >= 0) {
      playTone(input, {
        frequency: midiToFrequency(chord[arpeggioNoteIndex] + ARPEGGIO_OCTAVE_SHIFT),
        waveform: 'sine',
        startTime,
        duration: PLUCK_DURATION_SECONDS,
        peakGain: PLUCK_PEAK_GAIN,
        attackSeconds: PLUCK_ATTACK_SECONDS,
      })
    }
  }
}
