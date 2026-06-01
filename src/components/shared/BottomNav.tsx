/**
 * BottomNav.tsx
 *
 * Mobile-style bottom navigation bar.
 * Switches between the five main panels.
 */

import { useGameStore } from '@store/gameStore'

const NAV_ITEMS = [
  { id: 'map',      label: 'Land',    icon: '🌿' },
  { id: 'roster',   label: 'Labor',   icon: '👥' },
  { id: 'ledger',   label: 'Ledger',  icon: '📒' },
  { id: 'market',   label: 'Market',  icon: '⚖️' },
  { id: 'trophies', label: 'Trophies',icon: '🏆' },
] as const

export default function BottomNav() {
  const activePanel   = useGameStore(s => s.activePanel)
  const setActivePanel = useGameStore(s => s.setActivePanel)

  return (
    <nav className="bg-earth-800 border-t border-earth-700 flex">
      {NAV_ITEMS.map(item => (
        <button
          key={item.id}
          onClick={() => setActivePanel(item.id)}
          className={`flex-1 flex flex-col items-center py-2 gap-0.5 text-xs transition-colors ${
            activePanel === item.id
              ? 'text-earth-100 bg-earth-700'
              : 'text-earth-400'
          }`}
        >
          <span className="text-lg leading-none">{item.icon}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}
