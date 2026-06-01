/**
 * App.tsx
 *
 * Root application component.
 *
 * Decides what to show based on whether a game is in progress:
 *   - No game: show the Start Screen (new game / load game)
 *   - Game in progress: show the main Game layout
 *   - Season just resolved: show the Season Summary overlay on top of the game
 *
 * This component contains no game logic — it only reads from the store
 * and delegates to child components.
 */

import { useEffect } from 'react'
import { useGameStore } from '@store/gameStore'
import StartScreen from '@components/shared/StartScreen'
import GameLayout from '@components/shared/GameLayout'
import SeasonSummary from '@components/summary/SeasonSummary'
import ContentWarning from '@components/shared/ContentWarning'

export default function App() {
  const isPlaying            = useGameStore(s => s.isPlaying)
  const showingSeasonSummary = useGameStore(s => s.showingSeasonSummary)
  const loadGame             = useGameStore(s => s.loadGame)

  // On first load, attempt to restore a saved game
  useEffect(() => {
    loadGame()
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-earth-900 text-earth-100">
      {/* Content warning shown on very first launch */}
      <ContentWarning />

      {!isPlaying && <StartScreen />}

      {isPlaying && (
        <>
          <GameLayout />
          {showingSeasonSummary && <SeasonSummary />}
        </>
      )}
    </div>
  )
}
