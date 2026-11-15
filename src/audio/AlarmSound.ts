import { createSoundOutput, getAudioContext, playTone } from './soundManager'

/**
 * Hazard warning siren: six short square-wave beeps alternating between a high
 * and a low tone, like a klaxon, low-passed so it is urgent without being harsh (~1.5 s).
 */

const SIREN_START_DELAY_SECONDS = 0.02
const SIREN_GAIN = 0.12
const SIREN_LOWPASS_CUTOFF_HZ = 2400

/** Alternating high/low tones. */
const SIREN_TONES_HZ: readonly number[] = [880, 660]
const BEEP_COUNT = 6
const BEEP_INTERVAL_SECONDS = 0.25
const BEEP_DURATION_SECONDS = 0.2
const BEEP_ATTACK_SECONDS = 0.01

export class AlarmSound {
  private gain: GainNode | null = null

  /** Plays the siren once, cutting off any siren that is still playing. */
  play(): void {
    const context = getAudioContext()
    if (!context) return

    this.stop()
    // Each siren gets its own output so `stop()` can silence all its beeps at once
    const output = createSoundOutput(context, SIREN_LOWPASS_CUTOFF_HZ, SIREN_GAIN)
    this.gain = output.gain

    const startTime = context.currentTime + SIREN_START_DELAY_SECONDS
    for (let beepIndex = 0; beepIndex < BEEP_COUNT; beepIndex += 1) {
      playTone(output.input, {
        frequency: SIREN_TONES_HZ[beepIndex % SIREN_TONES_HZ.length],
        waveform: 'square',
        startTime: startTime + beepIndex * BEEP_INTERVAL_SECONDS,
        duration: BEEP_DURATION_SECONDS,
        peakGain: 1,
        attackSeconds: BEEP_ATTACK_SECONDS,
      })
    }
  }

  /** Silences the siren if it is playing. */
  stop(): void {
    this.gain?.disconnect()
    this.gain = null
  }
}
