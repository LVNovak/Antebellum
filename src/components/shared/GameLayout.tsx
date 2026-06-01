/**
 * GameLayout.tsx
 *
 * The main game shell — shown whenever a game is in progress.
 *
 * Layout (mobile-first):
 *   - Top bar: season/year indicator + advance season button
 *   - Main panel area: whichever view is currently active
 *   - Bottom nav: tabs to switch between panels
 *
 * On wider screens the bottom nav moves to a sidebar.
 */

import { useGameStore } from '@store/gameStore'
import PlantationMap from '@components/map/PlantationMap'
import LaborRoster from '@components/roster/LaborRoster'
import Ledger from '@components/ledger/Ledger'
import MarketPanel from '@components/market/MarketPanel'
import TrophyLedger from '@components/summary/TrophyLedger'
import TopBar from '@components/shared/TopBar'
import BottomNav from '@components/shared/BottomNav'

export default function GameLayout() {
  const activePanel = useGameStore(s => s.activePanel)

  return (
    <div className="flex flex-col h-screen max-h-screen overflow-hidden">
      {/* Top bar — always visible */}
      <TopBar />

      {/* Main content area — scrollable */}
      <main className="flex-1 overflow-y-auto panel-scroll">
        {activePanel === 'map'     && <PlantationMap />}
        {activePanel === 'roster'  && <LaborRoster />}
        {activePanel === 'ledger'  && <Ledger />}
        {activePanel === 'market'  && <MarketPanel />}
        {activePanel === 'trophies'&& <TrophyLedger />}
      </main>

      {/* Bottom nav — always visible */}
      <BottomNav />
    </div>
  )
}
