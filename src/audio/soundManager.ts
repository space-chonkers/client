/**
 * Shared Web Audio building blocks. Every sound plays through one AudioContext,
 * created lazily because browsers block audio until there is a user gesture.
 */

const SILENT_GAIN = 0.0001
const TONE_STOP_PADDING_SECONDS = 0.05

let sharedContext: AudioContext | null = null

/** Returns the shared AudioContext (resumed), or `null` if audio is unavailable. */
export function getAudioContext(): AudioContext | null {
  if (!sharedContext) {
    try {
      sharedContext = new AudioContext()
    } catch (error) {
      console.error('Could not initialize audio:', error)
      return null
    }
  }
  void sharedContext.resume()
  return sharedContext
}

export interface SoundOutput {
  /** Node that tones are played into. */
  input: AudioNode
  /** Final gain before the speakers; adjust it for volume or disconnect it to silence the sound. */
  gain: GainNode
}

/** Builds a `lowpass -> gain -> speakers` chain so each sound has its own volume and off switch. */
export function createSoundOutput(context: AudioContext, lowpassCutoffHz: number, gainValue: number): SoundOutput {
  const gain = context.createGain()
  gain.gain.value = gainValue
  gain.connect(context.destination)

  const lowpass = context.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.value = lowpassCutoffHz
  lowpass.connect(gain)

  return { input: lowpass, gain }
}

export interface Tone {
  frequency: number
  waveform: OscillatorType
  startTime: number
  duration: number
  peakGain: number
  attackSeconds: number
}

/** Schedules one oscillator note with a linear attack and exponential decay. */
export function playTone(destination: AudioNode, tone: Tone): void {
  const context = destination.context
  const oscillator = context.createOscillator()
  oscillator.type = tone.waveform
  oscillator.frequency.value = tone.frequency

  const envelope = context.createGain()
  envelope.gain.setValueAtTime(0, tone.startTime)
  envelope.gain.linearRampToValueAtTime(tone.peakGain, tone.startTime + tone.attackSeconds)
  envelope.gain.exponentialRampToValueAtTime(SILENT_GAIN, tone.startTime + tone.duration)

  oscillator.connect(envelope)
  envelope.connect(destination)
  oscillator.start(tone.startTime)
  oscillator.stop(tone.startTime + tone.duration + TONE_STOP_PADDING_SECONDS)
  oscillator.onended = () => envelope.disconnect()
}
