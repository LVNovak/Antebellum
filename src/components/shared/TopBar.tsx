/**
 * TopBar.tsx
 *
 * The bar across the top of the game screen.
 * Shows the current season and year, and the "End Season" button.
 *
 * The End Season button is the player's deliberate action to advance the game.
 * It requires a confirmation tap to prevent accidental advances (GDD Section 13.4).
 */

import { useState } from 'react'
import { useGameStore } from '@store/gameStore'

export default function TopBar() {
  const gameState    = useGameStore(s => s.gameState)
  const advanceSeason = useGameStore(s => s.advanceSeason)
  const [confirming, setConfirming] = useState(false)

  if (!gameState) return null

  const { currentSeason, currentYear, finances } = gameState

  function handleEndSeasonClick() {
    if (!confirming) {
      // First tap: show confirmation
      setConfirming(true)
      return
    }
    // Second tap: actually advance
    setConfirming(false)
    advanceSeason()
  }

  function handleCancelConfirm() {
    setConfirming(false)
  }

  return (
    <header className="bg-earth-800 border-b border-earth-700 px-4 py-3 flex items-center justify-between">
      {/* Season and year */}
      <div>
        <div className="font-serif text-earth-100 text-lg font-bold">
          {currentSeason} — Year {currentYear}
        </div>
        <div className="text-earth-300 text-sm">
          Cash: <span className="text-earth-100 font-mono">${finances.cashOnHand.toFixed(0)}</span>
        </div>
      </div>

      {/* End season button */}
      <div className="flex items-center gap-2">
        {confirming && (
          <button
            onClick={handleCancelConfirm}
            className="px-3 py-2 text-sm text-earth-300 border border-earth-600 rounded"
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleEndSeasonClick}
          className={`px-4 py-2 rounded font-serif font-bold text-sm transition-colors ${
            confirming
              ? 'bg-red-800 text-white border-2 border-red-500'
              : 'bg-earth-600 text-earth-100 border border-earth-500'
          }`}
        >
          {confirming ? 'Confirm — End Season' : 'End Season →'}
        </button>
      </div>
    </header>
  )
}
