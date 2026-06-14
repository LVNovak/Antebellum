/**
 * DebugPanel.tsx — Master debug log for playtesting.
 * Full per-season record: soil state, yields, labor, finances, events.
 * Copy-to-clipboard button outputs full JSON for analysis.
 */

import { useState } from 'react'
import { useGameStore } from '@store/gameStore'
import { DebugEntry } from '@engine/types'

export default function DebugPanel() {
  const gameState = useGameStore(s => s.gameState)
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

  if (!gameState) return null

  const log = [...(gameState.debugLog ?? [])].reverse()

  function handleCopy() {
    const json = JSON.stringify(gameState.debugLog, null, 2)
    navigator.clipboard.writeText(json).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-earth-100 text-xl">Debug Log</h2>
        <button onClick={handleCopy}
          className="px-3 py-1.5 bg-earth-700 border border-earth-600 text-earth-300 text-xs rounded">
          {copied ? '✓ Copied' : 'Copy JSON'}
        </button>
      </div>
      <p className="text-earth-500 text-xs">{log.length} season{log.length !== 1 ? 's' : ''} recorded. Tap a row to expand.</p>
      <div className="flex flex-col gap-1">
        {log.map((entry, i) => (
          <DebugRow key={i} entry={entry} isExpanded={expandedIndex === i}
            onToggle={() => setExpandedIndex(expandedIndex === i ? null : i)} />
        ))}
      </div>
      {log.length === 0 && <p className="text-earth-600 text-sm italic text-center py-8">No seasons resolved yet.</p>}
    </div>
  )
}

function DebugRow({ entry, isExpanded, onToggle }: { entry: DebugEntry; isExpanded: boolean; onToggle: () => void }) {
  const cashDelta = entry.finances.cashEnd - entry.finances.cashStart
  const totalYield = entry.tiles.reduce((s, t) => s + t.yieldProduced, 0)

  return (
    <div className="bg-earth-800 border border-earth-700 rounded overflow-hidden">
      <button onClick={onToggle} className="w-full px-3 py-2 flex items-center justify-between text-left">
        <div className="flex items-center gap-3">
          <span className="text-earth-300 text-xs font-mono w-28">{entry.season} Yr {entry.year}</span>
          <span className="text-earth-500 text-xs">{entry.weather}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-earth-400 text-xs">yield: <span className="text-earth-200 font-mono">{totalYield}</span></span>
          <span className={`text-xs font-mono ${cashDelta >= 0 ? 'text-soil-good' : 'text-soil-poor'}`}>
            {cashDelta >= 0 ? '+' : ''}{cashDelta.toFixed(0)}
          </span>
          <span className="text-earth-500 text-xs">{isExpanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-earth-700 px-3 py-3 flex flex-col gap-3 text-xs">
          <div>
            <p className="text-earth-400 font-bold mb-1">Finances</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-earth-400">
              <span>Cash start</span><span className="font-mono text-earth-200">${entry.finances.cashStart.toFixed(0)}</span>
              <span>Cash end</span><span className="font-mono text-earth-200">${entry.finances.cashEnd.toFixed(0)}</span>
              <span>Sales revenue</span><span className="font-mono text-soil-good">+${entry.finances.salesRevenue.toFixed(0)}</span>
              <span>Clothing</span><span className="font-mono text-soil-poor">-${entry.finances.upkeepClothing.toFixed(0)}</span>
              <span>Rental/wages</span><span className="font-mono text-soil-poor">-${entry.finances.upkeepRental.toFixed(0)}</span>
              <span>Interest</span><span className="font-mono text-soil-poor">${entry.finances.upkeepInterest.toFixed(2)}</span>
              <span>Total debt</span><span className="font-mono text-earth-400">${entry.finances.debtTotal.toFixed(0)}</span>
            </div>
          </div>
          <div>
            <p className="text-earth-400 font-bold mb-1">Tiles (cleared only)</p>
            {entry.tiles.filter(t => t.isCleared).map(t => (
              <div key={t.id} className="flex items-center gap-2 text-earth-500 py-0.5">
                <span className="w-16 truncate font-mono">{t.id}</span>
                <span className="w-20">{t.crop ?? 'Fallow'}</span>
                <span className="font-mono text-earth-300 w-8 text-right">{t.yieldProduced > 0 ? t.yieldProduced : '—'}</span>
                <span className="text-earth-600 text-[10px]">soil {t.soilBefore.composite}%→{t.soilAfter.composite}% N:{t.soilBefore.n}→{t.soilAfter.n}</span>
              </div>
            ))}
          </div>
          <div>
            <p className="text-earth-400 font-bold mb-1">Workers</p>
            {entry.workers.map(w => (
              <div key={w.id} className="flex gap-2 text-earth-500 py-0.5">
                <span className="w-16">{w.name}</span>
                <span className="w-24 text-earth-600 text-[10px]">{w.type}</span>
                <span className="w-14">{w.health}</span>
                <span className="text-earth-600">{w.task}</span>
              </div>
            ))}
          </div>
          {entry.events.length > 0 && (
            <div>
              <p className="text-earth-400 font-bold mb-1">Events</p>
              {entry.events.map((e, i) => <p key={i} className="text-earth-600 py-0.5">{e}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
