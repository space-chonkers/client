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
 * Only the warning and its status are handled here; the hazard's effects are not.
 */
export function useHazardAlert(): HazardAlertControls {
  const [alarm] = useState(() => new AlarmSound())
  const [warningHazard, setWarningHazard] = useState<HazardDefinition | null>(null)
  const [ongoingHazard, setOngoingHazard] = useState<HazardDefinition | null>(null)

  useEffect(() => () => alarm.stop(), [alarm])

  const receiveHazardCode = useCallback(
    (code: number) => {
      if (code === NO_HAZARD_CODE) return

      const hazard = getHazardByCode(code)
      if (!hazard) {
        console.warn(`Ignoring unknown hazard code from server: ${code}`)
        return
      }

      // The server may repeat the same code on later ticks; that must not reopen
      // the banner nor replay the alarm for a hazard already shown or in progress
      if (warningHazard?.type === hazard.type) return
      if (ongoingHazard?.type === hazard.type) return

      setWarningHazard(hazard)
      alarm.play()
    },
    [alarm, warningHazard, ongoingHazard],
  )

  const closeWarning = useCallback(() => {
    if (!warningHazard) return
    setOngoingHazard(warningHazard)
    setWarningHazard(null)
    alarm.stop()
  }, [alarm, warningHazard])

  const resolveOngoingHazard = useCallback(() => {
    setOngoingHazard(null)
  }, [])

  const dismiss = useCallback(() => {
    setWarningHazard(null)
    setOngoingHazard(null)
    alarm.stop()
  }, [alarm])

  return { warningHazard, ongoingHazard, receiveHazardCode, closeWarning, resolveOngoingHazard, dismiss }
}
