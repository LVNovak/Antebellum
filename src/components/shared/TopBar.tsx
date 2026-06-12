/**
 * TopBar.tsx
 *
 * Always-visible top bar. Shows season, year, cash, and the Plan Season button.
 * Clicking Plan Season opens the SeasonPlanner overlay.
 */

import { useGameStore } from '@store/gameStore'

export default function TopBar() {
  const gameState         = useGameStore(s => s.gameState)
  const openSeasonPlanner = useGameStore(s => s.openSeasonPlanner)

  if (!gameState) return null

  const { currentSeason, currentYear, finances, workers, cornOnHand } = gameState
  const totalDebt = finances.factorAdvanceDebt + finances.mortgageDebt + finances.personalNoteDebt

  // Corn upkeep is 1 unit per worker per season — warn when on hand
  // covers less than one full season for the current workforce.
  const cornLow = cornOnHand < workers.length

  return (
    <header className="bg-earth-800 border-b border-earth-700 px-4 py-3">
      <div className="flex items-center justify-between">
        {/* Season and key stats */}
        <div>
          <div className="font-serif text-earth-100 text-base font-bold">
            {currentSeason} — Year {currentYear}
          </div>
          <div className="flex gap-3 mt-0.5">
            <span className="text-earth-300 text-xs">
              Cash: <span className={`font-mono font-bold ${finances.cashOnHand >= 0 ? 'text-soil-good' : 'text-soil-poor'}`}>
                ${finances.cashOnHand.toFixed(0)}
              </span>
            </span>
            {totalDebt > 0 && (
              <span className="text-earth-400 text-xs">
                Debt: <span className="font-mono text-soil-poor">${totalDebt.toFixed(0)}</span>
              </span>
            )}
            <span className="text-earth-400 text-xs">
              Corn: <span className={`font-mono font-bold ${cornLow ? 'text-soil-poor' : 'text-earth-200'}`}>
                {cornOnHand}
              </span>
            </span>
            <span className="text-earth-400 text-xs">
              Workers: <span className="font-mono text-earth-200">{workers.length}</span>
            </span>
          </div>
        </div>

        {/* Plan Season button */}
        <button
          onClick={openSeasonPlanner}
          className="px-4 py-2 bg-earth-600 border border-earth-500 text-earth-100 font-serif text-sm rounded"
        >
          Plan Season →
        </button>
      </div>
    </header>
  )
}
