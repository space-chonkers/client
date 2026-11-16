import { useCallback, useEffect, useState } from 'react'
import { AlarmSound } from '../../audio/AlarmSound'
import { getHazardByCode, NO_HAZARD_CODE, type HazardDefinition } from './hazardEvents'

export interface HazardAlertControls {
  /** Hazard whose warning banner is showing, or `null` when there is none. */
  warningHazard: HazardDefinition | null
  /** Hazard shown as "in progress" after its banner was closed, or `null`. */
  ongoingHazard: HazardDefinition | null
  /** Feed the hazard code received on each server tick. */
  receiveHazardCode: (code: number) => void
  /** Feed an instantaneous server hazard that should not become ongoing. */
  receiveInstantHazardCode: (code: number) => void
  /** Closes the warning banner (X button); its hazard becomes the ongoing one. */
  closeWarning: () => void
  /** Marks the ongoing hazard as solved. To be called by the (not yet built) resolution logic. */
  resolveOngoingHazard: () => void
  /** Clears the warning and the ongoing hazard and silences the alarm (e.g. when leaving the mission). */
  dismiss: () => void
}

/**
 * Turns the hazard codes sent on each server tick into a warning banner and
 * plays an alarm only when the banner first appears. Closing the banner turns
 * the hazard into the "ongoing" one until `resolveOngoingHazard` is called.
 * Hazards never stack: a new one is accepted only when none is active.
 * Only the warning and its status are handled here; the hazard's effects are not.
 */
export function useHazardAlert(): HazardAlertControls {
  const [alarm] = useState(() => new AlarmSound())
  const [warningHazard, setWarningHazard] = useState<HazardDefinition | null>(null)
  const [ongoingHazard, setOngoingHazard] = useState<HazardDefinition | null>(null)
  const [instantWarning, setInstantWarning] = useState(false)

  useEffect(() => () => alarm.stop(), [alarm])

  const showHazard = useCallback(
    (code: number, instant: boolean) => {
      if (code === NO_HAZARD_CODE) return

      const hazard = getHazardByCode(code)
      if (!hazard) {
        console.warn(`Ignoring unknown hazard code from server: ${code}`)
        return
      }

      // Only one hazard can be active at a time: while one is in the banner or in
      // progress, any other code (including repeats of the same one) is ignored
      if (warningHazard || ongoingHazard) return

      setWarningHazard(hazard)
      setInstantWarning(instant)
      alarm.play()
    },
    [alarm, warningHazard, ongoingHazard],
  )

  const receiveHazardCode = useCallback((code: number) => showHazard(code, false), [showHazard])
  const receiveInstantHazardCode = useCallback((code: number) => showHazard(code, true), [showHazard])

  const closeWarning = useCallback(() => {
    if (!warningHazard) return
    setWarningHazard(null)
    if (instantWarning) {
      setInstantWarning(false)
    } else {
      setOngoingHazard(warningHazard)
    }
    alarm.stop()
  }, [alarm, instantWarning, warningHazard])

  const resolveOngoingHazard = useCallback(() => {
    setWarningHazard(null)
    setOngoingHazard(null)
    setInstantWarning(false)
    alarm.stop()
  }, [alarm])

  const dismiss = useCallback(() => {
    setWarningHazard(null)
    setOngoingHazard(null)
    setInstantWarning(false)
    alarm.stop()
  }, [alarm])

  return {
    warningHazard,
    ongoingHazard,
    receiveHazardCode,
    receiveInstantHazardCode,
    closeWarning,
    resolveOngoingHazard,
    dismiss,
  }
}
