import { useEffect, useState } from 'react'
import { EconomyStore } from './economy/EconomyStore'
import { createTransport } from './net/transport'
import SpinningCube from './SpinningCube'
import EconomyHUD from './ui/EconomyHUD'

export default function App() {
  const [economy] = useState(() => new EconomyStore(createTransport))
  useEffect(() => economy.connect(), [economy])

  return (
    <main className="game-client">
      <SpinningCube />
      <EconomyHUD store={economy} />
    </main>
  )
}
