/**
 * App.tsx
 *
 * Root application component.
 * Decides what to render based on game state:
 *   - No game: StartScreen
 *   - Game in progress: GameLayout
 *   - Season planner open: SeasonPlanner overlay
 *   - Season just resolved: SeasonSummary overlay
 */

import { useEffect } from 'react'
import { useGameStore } from '@store/gameStore'
import StartScreen    from '@components/shared/StartScreen'
import GameLayout     from '@components/shared/GameLayout'
import SeasonPlanner  from '@components/shared/SeasonPlanner'
import SeasonSummary  from '@components/summary/SeasonSummary'
import ContentWarning from '@components/shared/ContentWarning'

export default function App() {
  const isPlaying             = useGameStore(s => s.isPlaying)
  const showingSeasonSummary  = useGameStore(s => s.showingSeasonSummary)
  const showingSeasonPlanner  = useGameStore(s => s.showingSeasonPlanner)
  const loadGame              = useGameStore(s => s.loadGame)

  useEffect(() => { loadGame() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-earth-900 text-earth-100">
      <ContentWarning />
      {!isPlaying && <StartScreen />}
      {isPlaying && (
        <>
          <GameLayout />
          {showingSeasonPlanner && <SeasonPlanner />}
          {showingSeasonSummary && !showingSeasonPlanner && <SeasonSummary />}
        </>
      )}
    </div>
  )
}
