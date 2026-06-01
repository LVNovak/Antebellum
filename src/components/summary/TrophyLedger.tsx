/**
 * TrophyLedger.tsx — The achievement record
 *
 * A dated log of trophies earned. No fanfare — just the record.
 * See GDD Section 12 design note.
 */

import { useGameStore } from '@store/gameStore'

export default function TrophyLedger() {
  const gameState = useGameStore(s => s.gameState)
  if (!gameState) return null

  const { trophies } = gameState

  return (
    <div className="p-4 flex flex-col gap-4">
      <h2 className="font-serif text-earth-100 text-xl">Trophy Ledger</h2>

      {trophies.length === 0 && (
        <p className="text-earth-500 text-sm italic text-center py-8">
          No trophies earned yet. The ledger will record what you have done.
        </p>
      )}

      {trophies.map(trophy => (
        <div key={trophy.id} className="bg-earth-800 border border-earth-700 rounded p-4">
          <div className="flex items-center justify-between">
            <span className="font-serif text-earth-100 font-bold">🏆 {trophy.name}</span>
            <span className="text-earth-500 text-xs">
              {trophy.earnedOnSeason}, Year {trophy.earnedOnYear}
            </span>
          </div>
          <p className="text-earth-400 text-xs mt-1">{trophy.condition}</p>
        </div>
      ))}
    </div>
  )
}
