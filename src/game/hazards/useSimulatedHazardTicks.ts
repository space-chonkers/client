import { useEffect, useRef } from 'react'
import { HAZARD_CODES, NO_HAZARD_CODE } from './hazardEvents'

/** How often a simulated server tick is emitted. */
const SIMULATED_TICK_INTERVAL_MS = 5000
/** Probability (0–1) that a simulated tick carries a hazard instead of `NO_HAZARD_CODE`. */
const SIMULATED_HAZARD_CHANCE = 0.3

function pickSimulatedHazardCode(): number {
  if (Math.random() >= SIMULATED_HAZARD_CHANCE) return NO_HAZARD_CODE
  return HAZARD_CODES[Math.floor(Math.random() * HAZARD_CODES.length)]
}

/**
 * TEMPORARY: stands in for the server tick stream until it is connected.
 * While `enabled`, emits one hazard code per tick to `onHazardCode`, mostly
 * `NO_HAZARD_CODE` with an occasional random hazard. Replace this hook with the
 * real server subscription, keeping the same `onHazardCode` callback.
 */
export function useSimulatedHazardTicks(enabled: boolean, onHazardCode: (code: number) => void): void {
  // Keeps the interval stable while the callback identity changes between renders
  const onHazardCodeRef = useRef(onHazardCode)
  useEffect(() => {
    onHazardCodeRef.current = onHazardCode
  }, [onHazardCode])

  useEffect(() => {
    if (!enabled) return

    const intervalId = window.setInterval(() => {
      onHazardCodeRef.current(pickSimulatedHazardCode())
    }, SIMULATED_TICK_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [enabled])
}
