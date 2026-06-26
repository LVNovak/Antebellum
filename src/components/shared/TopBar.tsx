/**
 * TopBar.tsx
 *
 * Always-visible top bar. Shows season, year, cash, provisions, and
 * the Plan Season button. Also hosts the settings menu (quit/reset).
 */

import { useState } from 'react'
import { useGameStore } from '@store/gameStore'

export default function TopBar() {
  const gameState         = useGameStore(s => s.gameState)
  const openSeasonPlanner = useGameStore(s => s.openSeasonPlanner)
  const resetGame         = useGameStore(s => s.resetGame)
  const [showMenu, setShowMenu] = useState(false)
  const [confirmingQuit, setConfirmingQuit] = useState(false)

  if (!gameState) return null

  const { currentSeason, currentYear, finances, workers, cornOnHand, blanketsOnHand } = gameState
  const totalDebt = finances.factorAdvanceDebt + finances.mortgageDebt + finances.personalNoteDebt

  const cornLow     = cornOnHand < workers.length
  const blanketsLow = blanketsOnHand < workers.length * 0.25

  function handleQuitClick() {
    if (!confirmingQuit) { setConfirmingQuit(true); return }
    resetGame()
  }

  return (
    <header className="bg-earth-800 border-b border-earth-700 px-4 py-3 relative" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
      <div className="flex items-center justify-between">
        <div>
          <div className="font-serif text-earth-100 text-base font-bold">
            {currentSeason} — Year {currentYear}
          </div>
          <div className="flex gap-3 mt-0.5 flex-wrap">
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
              Food: <span className={`font-mono font-bold ${cornLow ? 'text-soil-poor' : 'text-earth-200'}`}>
                {cornOnHand}
              </span>
            </span>
            <span className="text-earth-400 text-xs">
              Blankets: <span className={`font-mono font-bold ${blanketsLow ? 'text-soil-poor' : 'text-earth-200'}`}>
                {blanketsOnHand}
              </span>
            </span>
            <span className="text-earth-400 text-xs">
              Workers: <span className="font-mono text-earth-200">{workers.length}</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={openSeasonPlanner}
            className="px-4 py-2 bg-earth-600 border border-earth-500 text-earth-100 font-serif text-sm rounded"
          >
            Plan Season →
          </button>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="w-9 h-9 flex items-center justify-center bg-earth-700 border border-earth-600 text-earth-300 rounded text-lg"
            aria-label="Settings"
          >
            ⚙
          </button>
        </div>
      </div>

      {showMenu && (
        <div className="absolute right-4 top-full mt-1 bg-earth-800 border border-earth-600 rounded shadow-lg z-50 min-w-[180px]">
          <button
            onClick={handleQuitClick}
            className={`w-full text-left px-4 py-3 text-sm ${confirmingQuit ? 'bg-red-900 text-red-200' : 'text-earth-300'}`}
          >
            {confirmingQuit ? 'Confirm — Quit & Erase Save' : 'Quit to Main Menu'}
          </button>
          {confirmingQuit && (
            <button
              onClick={() => { setConfirmingQuit(false); setShowMenu(false) }}
              className="w-full text-left px-4 py-3 text-sm text-earth-400 border-t border-earth-700"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </header>
  )
}
