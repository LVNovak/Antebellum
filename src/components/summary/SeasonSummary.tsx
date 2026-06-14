/**
 * SeasonSummary.tsx — End-of-season summary overlay
 */

import { useGameStore } from '@store/gameStore'

export default function SeasonSummary() {
  const lastSeasonEvents   = useGameStore(s => s.lastSeasonEvents)
  const gameState          = useGameStore(s => s.gameState)
  const dismissSummary     = useGameStore(s => s.dismissSeasonSummary)

  if (!gameState) return null

  // The season that just ended is now the previous season (state has already advanced)
  const seasons = ['Spring', 'Summer', 'Autumn', 'Winter']
  const currentIdx = seasons.indexOf(gameState.currentSeason)
  const previousSeason = seasons[(currentIdx + 3) % 4]
  const previousYear   = gameState.currentSeason === 'Spring' ? gameState.currentYear - 1 : gameState.currentYear

  return (
    <div className="fixed inset-0 bg-black/80 z-40 flex items-end sm:items-center justify-center">
      <div className="bg-earth-900 border-t border-earth-700 w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-earth-700 flex justify-between items-center">
          <h2 className="font-serif text-earth-100 text-xl">
            {previousSeason} — Year {previousYear}
          </h2>
          <span className="text-earth-500 text-sm">{lastSeasonEvents.length} event{lastSeasonEvents.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Events */}
        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3">
          {lastSeasonEvents.length === 0 && (
            <p className="text-earth-500 text-sm italic">A quiet season. Nothing of note occurred.</p>
          )}
          {lastSeasonEvents.map(event => (
            <div key={event.id} className="border-l-2 border-earth-600 pl-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-earth-500">{event.category}</span>
              </div>
              <p className="text-earth-200 text-sm font-bold">{event.title}</p>
              <p className="text-earth-400 text-xs mt-0.5">{event.description}</p>
              {event.effects.length > 0 && (
                <ul className="mt-1">
                  {event.effects.map((e, i) => (
                    <li key={i} className="text-earth-500 text-xs">→ {e}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {/* Continue button */}
        <div className="px-6 py-4 border-t border-earth-700">
          <button
            onClick={dismissSummary}
            className="w-full py-3 bg-earth-700 border border-earth-500 text-earth-100 font-serif rounded"
          >
            Continue to {gameState.currentSeason}
          </button>
        </div>
      </div>
    </div>
  )
}
