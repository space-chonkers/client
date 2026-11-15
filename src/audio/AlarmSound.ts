/**
 * Hazard warning siren generated with the Web Audio API (no audio file needed).
 *
 * Six short square-wave beeps alternating between a high and a low tone, like
 * a klaxon, low-passed so it is urgent without being harsh (~1.5 s).
 * The AudioContext is created lazily in `play()` because browsers block audio
 * until there is a user gesture.
 */

const SIREN_START_DELAY_SECONDS = 0.02
const SIREN_MASTER_GAIN = 0.12
const SIREN_LOWPASS_CUTOFF_HZ = 2400

/** Alternating high/low tones. */
const SIREN_TONES_HZ: readonly number[] = [880, 660]
const BEEP_COUNT = 6
const BEEP_INTERVAL_SECONDS = 0.25
const BEEP_DURATION_SECONDS = 0.2
const BEEP_ATTACK_SECONDS = 0.01
const BEEP_STOP_PADDING_SECONDS = 0.05

export class AlarmSound {
  private context: AudioContext | null = null
  private outputGain: GainNode | null = null

  /** Plays the siren once, cutting off any siren that is still playing. */
  play(): void {
    const context = this.getContext()
    if (!context) return

    void context.resume()
    this.stop()

    // Each siren gets its own output so `stop()` can silence all its beeps at once
    const outputGain = context.createGain()
    outputGain.gain.value = SIREN_MASTER_GAIN
    outputGain.connect(context.destination)
    this.outputGain = outputGain

    const lowpass = context.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = SIREN_LOWPASS_CUTOFF_HZ
    lowpass.connect(outputGain)

    const startTime = context.currentTime + SIREN_START_DELAY_SECONDS
    for (let beepIndex = 0; beepIndex < BEEP_COUNT; beepIndex += 1) {
      const frequency = SIREN_TONES_HZ[beepIndex % SIREN_TONES_HZ.length]
      this.playBeep(context, lowpass, frequency, startTime + beepIndex * BEEP_INTERVAL_SECONDS)
    }
  }

  /** Silences the siren if it is playing. */
  stop(): void {
    this.outputGain?.disconnect()
    this.outputGain = null
  }

  /** Stops the siren and closes the AudioContext. `play()` can create a new one afterwards. */
  dispose(): void {
    this.stop()
    if (this.context) {
      void this.context.close()
    }
    this.context = null
  }

  private getContext(): AudioContext | null {
    if (this.context) return this.context

    try {
      this.context = new AudioContext()
    } catch (error) {
      console.error('Could not initialize alarm audio:', error)
    }
    return this.context
  }

  private playBeep(context: AudioContext, destination: AudioNode, frequency: number, startTime: number): void {
    const oscillator = context.createOscillator()
    oscillator.type = 'square'
    oscillator.frequency.value = frequency

    const envelope = context.createGain()
    envelope.gain.setValueAtTime(0, startTime)
    envelope.gain.linearRampToValueAtTime(1, startTime + BEEP_ATTACK_SECONDS)
    envelope.gain.exponentialRampToValueAtTime(0.0001, startTime + BEEP_DURATION_SECONDS)

    oscillator.connect(envelope)
    envelope.connect(destination)
    oscillator.start(startTime)
    oscillator.stop(startTime + BEEP_DURATION_SECONDS + BEEP_STOP_PADDING_SECONDS)
    oscillator.onended = () => envelope.disconnect()
  }
}
