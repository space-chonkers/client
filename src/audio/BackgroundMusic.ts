/**
 * Ambient background music generated with the Web Audio API.
 *
 * It is generated procedurally (pad + soft arpeggio) so no audio file is needed.
 * The AudioContext is created lazily in `start()` because browsers block audio
 * until there is a user gesture.
 */

/** Actual maximum master gain; UI volume 1.0 maps to this value. */
const MAX_MASTER_GAIN = 0.35
const VOLUME_SMOOTHING_SECONDS = 0.05

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
  private masterGain: GainNode | null = null
  private outputNode: AudioNode | null = null
  private schedulerId: number | null = null
  private nextStepTime = 0
  private stepIndex = 0
  private volume = 0

  /** Starts (or resumes) the music. Must be called after a user gesture. */
  start(): void {
    if (this.context) {
      void this.context.resume()
      return
    }

    try {
      this.context = new AudioContext()
    } catch (error) {
      console.error('Could not initialize background audio:', error)
      return
    }

    const context = this.context
    this.masterGain = context.createGain()
    this.masterGain.gain.value = this.volume * MAX_MASTER_GAIN
    this.masterGain.connect(context.destination)

    const lowpass = context.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = LOWPASS_CUTOFF_HZ
    lowpass.connect(this.masterGain)
    this.outputNode = lowpass

    this.nextStepTime = context.currentTime + 0.1
    this.schedulerId = window.setInterval(() => this.scheduleAhead(), SCHEDULER_INTERVAL_MS)
  }

  /** Normalized volume between 0 and 1. */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume))
    if (!this.context || !this.masterGain) return

    this.masterGain.gain.setTargetAtTime(
      this.volume * MAX_MASTER_GAIN,
      this.context.currentTime,
      VOLUME_SMOOTHING_SECONDS,
    )
  }

  /** Stops scheduling and closes the AudioContext. `start()` can create a new one afterwards. */
  dispose(): void {
    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId)
      this.schedulerId = null
    }
    if (this.context) {
      void this.context.close()
    }
    this.context = null
    this.masterGain = null
    this.outputNode = null
  }

  private scheduleAhead(): void {
    if (!this.context) return

    const horizon = this.context.currentTime + SCHEDULE_LOOKAHEAD_SECONDS
    while (this.nextStepTime < horizon) {
      this.scheduleStep(this.stepIndex, this.nextStepTime)
      this.nextStepTime += STEP_DURATION_SECONDS
      this.stepIndex += 1
    }
  }

  private scheduleStep(stepIndex: number, startTime: number): void {
    const chordIndex = Math.floor(stepIndex / STEPS_PER_CHORD) % CHORD_PROGRESSION.length
    const chord = CHORD_PROGRESSION[chordIndex]
    const stepInChord = stepIndex % STEPS_PER_CHORD

    if (stepInChord === 0) {
      const chordDuration = STEPS_PER_CHORD * STEP_DURATION_SECONDS
      chord.forEach((note) => {
        this.playTone(midiToFrequency(note), 'triangle', startTime, chordDuration, PAD_PEAK_GAIN, PAD_ATTACK_SECONDS)
      })
    }

    const arpeggioNoteIndex = ARPEGGIO_PATTERN[stepIndex % ARPEGGIO_PATTERN.length]
    if (arpeggioNoteIndex >= 0) {
      const note = chord[arpeggioNoteIndex] + ARPEGGIO_OCTAVE_SHIFT
      this.playTone(midiToFrequency(note), 'sine', startTime, PLUCK_DURATION_SECONDS, PLUCK_PEAK_GAIN, PLUCK_ATTACK_SECONDS)
    }
  }

  private playTone(
    frequency: number,
    waveform: OscillatorType,
    startTime: number,
    duration: number,
    peakGain: number,
    attackSeconds: number,
  ): void {
    if (!this.context || !this.outputNode) return

    const oscillator = this.context.createOscillator()
    oscillator.type = waveform
    oscillator.frequency.value = frequency

    const envelope = this.context.createGain()
    envelope.gain.setValueAtTime(0, startTime)
    envelope.gain.linearRampToValueAtTime(peakGain, startTime + attackSeconds)
    envelope.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)

    oscillator.connect(envelope)
    envelope.connect(this.outputNode)
    oscillator.start(startTime)
    oscillator.stop(startTime + duration + 0.05)
    oscillator.onended = () => envelope.disconnect()
  }
}
