/**
 * SeasonPlanner.tsx
 *
 * The main player decision screen — shown before each season advances.
 *
 * The player allocates workers across tasks using +/- controls.
 * A running total shows workers allocated vs. available.
 * Unallocated workers rest automatically (which aids health recovery).
 *
 * Layout:
 *   - Header: season name + available worker count
 *   - Tile tasks: one row per tile (clear / plant / tend / harvest)
 *   - Maintenance tasks: cabin repair, storage management
 *   - Supply buying: corn and blankets
 *   - Build actions: smokehouse if not built
 *   - Sale queuing: if storage has crops
 *   - Footer: allocated count + Confirm button
 */

import { useState } from 'react'
import { useGameStore, SeasonPlan, TileAction, countAllocatedWorkers } from '@store/gameStore'
import { CropType, Tile } from '@engine/types'
import { STORAGE_CAPACITY_SMOKEHOUSE, SMOKEHOUSE_BUILD_COST_MIN } from '@engine/constants'

// Phase 1 crops only
const PHASE1_CROPS: CropType[] = [CropType.Tobacco, CropType.Corn]

const CROP_LABELS: Record<CropType, string> = {
  [CropType.Tobacco]:     'Tobacco',
  [CropType.Rice]:        'Rice',
  [CropType.Corn]:        'Corn',
  [CropType.Cowpeas]:     'Cowpeas',
  [CropType.SweetPotato]: 'Sweet Potato',
  [CropType.Indigo]:      'Indigo',
  [CropType.CoverCrop]:   'Cover Crop',
  [CropType.Fallow]:      'Fallow (rest field)',
}

export default function SeasonPlanner() {
  const gameState            = useGameStore(s => s.gameState)
  const seasonPlan           = useGameStore(s => s.seasonPlan)
  const setTileAction        = useGameStore(s => s.setTileAction)
  const setCabinRepair       = useGameStore(s => s.setCabinRepairWorkers)
  const setStorageWorkers    = useGameStore(s => s.setStorageWorkers)
  const confirmPlanAndAdvance = useGameStore(s => s.confirmPlanAndAdvance)
  const closeSeasonPlanner   = useGameStore(s => s.closeSeasonPlanner)
  const buySupplies          = useGameStore(s => s.buySupplies)
  const buildSmokehouse      = useGameStore(s => s.buildSmokehouse)
  const queueSale            = useGameStore(s => s.queueSale)

  const [cornToBuy,    setCornToBuy]    = useState(0)
  const [blanketsToBuy, setBlanketsToBuy] = useState(0)
  const [saleQty,      setSaleQty]      = useState<Partial<Record<CropType, number>>>({})
  const [salePrice,    setSalePrice]    = useState<Partial<Record<CropType, number>>>({})

  if (!gameState) return null

  const { workers, tiles, storage, finances, currentSeason, currentYear } = gameState
  const totalWorkers     = workers.length
  const allocated        = countAllocatedWorkers(seasonPlan)
  const remaining        = totalWorkers - allocated
  const overAllocated    = remaining < 0
  const smokehouseBuilt  = storage.capacity >= STORAGE_CAPACITY_SMOKEHOUSE
  const canAffordSmokehouse = finances.cashOnHand >= SMOKEHOUSE_BUILD_COST_MIN
  const cornCost         = cornToBuy * 2
  const blanketCost      = blanketsToBuy * 3
  const supplyCost       = cornCost + blanketCost
  const canAffordSupplies = finances.cashOnHand >= supplyCost

  // Crops in storage that can be sold
  const sellableCrops = Object.entries(storage.inventory)
    .filter(([, qty]) => (qty ?? 0) > 0) as [CropType, number][]

  function handleBuySupplies() {
    if (cornToBuy > 0 || blanketsToBuy > 0) {
      buySupplies(cornToBuy, blanketsToBuy)
      setCornToBuy(0)
      setBlanketsToBuy(0)
    }
  }

  function handleQueueSale(crop: CropType) {
    const qty   = saleQty[crop]   ?? 0
    const price = salePrice[crop] ?? null
    if (qty > 0) {
      queueSale(crop, qty, price)
      setSaleQty(p  => ({ ...p, [crop]: 0 }))
    }
  }

  function getTileDescription(tile: Tile): string {
    if (!tile.isCleared) return `Uncleared — ${tile.clearingProgressRemaining} season(s) to clear`
    if (tile.currentCrop) return `Planted: ${CROP_LABELS[tile.currentCrop]}`
    return 'Cleared — ready to plant'
  }

  function getAvailableActionsForTile(tile: Tile): TileAction['type'][] {
    if (!tile.isCleared) return ['Clear']
    if (tile.currentCrop === CropType.Fallow || tile.currentCrop === CropType.CoverCrop) return ['Tend', 'Idle']
    if (tile.currentCrop) return ['Tend', 'Harvest', 'Idle']
    return ['Plant', 'Idle']
  }

  function getCurrentTileAction(tileId: string): TileAction {
    return seasonPlan.tileAllocations[tileId] ?? { type: 'Idle' }
  }

  function getWorkerCountForTile(tileId: string): number {
    const action = getCurrentTileAction(tileId)
    if (action.type === 'Idle') return 0
    return action.workers
  }

  function adjustTileWorkers(tile: Tile, delta: number) {
    const current = getWorkerCountForTile(tile.id)
    const action  = getCurrentTileAction(tile.id)
    const newCount = Math.max(0, current + delta)

    if (newCount === 0) {
      setTileAction(tile.id, { type: 'Idle' })
      return
    }

    // Preserve the current action type when adjusting count
    if (action.type === 'Clear')   setTileAction(tile.id, { type: 'Clear',   workers: newCount })
    if (action.type === 'Tend')    setTileAction(tile.id, { type: 'Tend',    workers: newCount })
    if (action.type === 'Harvest') setTileAction(tile.id, { type: 'Harvest', workers: newCount })
    if (action.type === 'Plant' && action.crop)
      setTileAction(tile.id, { type: 'Plant', workers: newCount, crop: action.crop })
  }

  function selectTileActionType(tile: Tile, actionType: TileAction['type'], crop?: CropType) {
    if (actionType === 'Idle') { setTileAction(tile.id, { type: 'Idle' }); return }
    const workers = getWorkerCountForTile(tile.id) || 1
    if (actionType === 'Clear')   setTileAction(tile.id, { type: 'Clear',   workers })
    if (actionType === 'Tend')    setTileAction(tile.id, { type: 'Tend',    workers })
    if (actionType === 'Harvest') setTileAction(tile.id, { type: 'Harvest', workers })
    if (actionType === 'Plant' && crop) setTileAction(tile.id, { type: 'Plant', workers, crop })
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-40 flex items-end justify-center">
      <div className="bg-earth-900 border-t border-earth-700 w-full max-w-lg max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="px-4 py-3 border-b border-earth-700 flex items-center justify-between">
          <div>
            <h2 className="font-serif text-earth-100 text-lg font-bold">
              Plan Your Season
            </h2>
            <p className="text-earth-400 text-xs">{currentSeason} — Year {currentYear}</p>
          </div>
          <div className="text-right">
            <div className={`font-mono font-bold text-sm ${overAllocated ? 'text-soil-poor' : 'text-soil-good'}`}>
              {allocated} / {totalWorkers} workers
            </div>
            <div className="text-earth-500 text-xs">
              {remaining > 0 ? `${remaining} resting` : overAllocated ? 'Over-allocated!' : 'All assigned'}
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── LAND TASKS ── */}
          <Section title="Land & Crops">
            {tiles.map(tile => {
              const currentAction = getCurrentTileAction(tile.id)
              const workerCount   = getWorkerCountForTile(tile.id)
              const availableActions = getAvailableActionsForTile(tile)
              const isPlantAction = currentAction.type === 'Plant'
              const selectedCrop  = isPlantAction ? currentAction.crop : null

              return (
                <div key={tile.id} className="px-4 py-3 border-b border-earth-800">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-earth-200 text-sm font-bold">
                        {tile.terrain} Parcel
                      </span>
                      <span className="text-earth-500 text-xs ml-2">
                        {getTileDescription(tile)}
                      </span>
                    </div>
                  </div>

                  {/* Action selector */}
                  <div className="flex flex-wrap gap-1 mb-2">
                    {availableActions.map(actionType => (
                      <button
                        key={actionType}
                        onClick={() => selectTileActionType(tile, actionType)}
                        className={`px-2 py-1 rounded text-xs border transition-colors ${
                          currentAction.type === actionType
                            ? 'bg-earth-600 border-earth-400 text-earth-100'
                            : 'bg-earth-800 border-earth-700 text-earth-400'
                        }`}
                      >
                        {actionType}
                      </button>
                    ))}
                  </div>

                  {/* Crop selector — shown when Plant is selected */}
                  {currentAction.type === 'Plant' && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {PHASE1_CROPS.map(crop => (
                        <button
                          key={crop}
                          onClick={() => selectTileActionType(tile, 'Plant', crop)}
                          className={`px-2 py-1 rounded text-xs border transition-colors ${
                            selectedCrop === crop
                              ? 'bg-earth-500 border-earth-300 text-earth-100'
                              : 'bg-earth-800 border-earth-700 text-earth-400'
                          }`}
                        >
                          {CROP_LABELS[crop]}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Worker allocator — shown when action is not Idle */}
                  {currentAction.type !== 'Idle' && (
                    <div className="flex items-center gap-3">
                      <span className="text-earth-400 text-xs">Workers:</span>
                      <WorkerCounter
                        value={workerCount}
                        onDecrease={() => adjustTileWorkers(tile, -1)}
                        onIncrease={() => adjustTileWorkers(tile, +1)}
                        max={remaining + workerCount}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </Section>

          {/* ── MAINTENANCE ── */}
          <Section title="Maintenance">
            <div className="px-4 py-3 border-b border-earth-800 flex items-center justify-between">
              <div>
                <span className="text-earth-200 text-sm">Cabin Repair</span>
                <p className="text-earth-500 text-xs">Prevents condition decay</p>
              </div>
              <WorkerCounter
                value={seasonPlan.cabinRepairWorkers}
                onDecrease={() => setCabinRepair(Math.max(0, seasonPlan.cabinRepairWorkers - 1))}
                onIncrease={() => setCabinRepair(seasonPlan.cabinRepairWorkers + 1)}
                max={remaining + seasonPlan.cabinRepairWorkers}
              />
            </div>

            {smokehouseBuilt && (
              <div className="px-4 py-3 border-b border-earth-800 flex items-center justify-between">
                <div>
                  <span className="text-earth-200 text-sm">Storage Management</span>
                  <p className="text-earth-500 text-xs">Cooper/Carpenter reduces spoilage</p>
                </div>
                <WorkerCounter
                  value={seasonPlan.storageWorkers}
                  onDecrease={() => setStorageWorkers(Math.max(0, seasonPlan.storageWorkers - 1))}
                  onIncrease={() => setStorageWorkers(seasonPlan.storageWorkers + 1)}
                  max={remaining + seasonPlan.storageWorkers}
                />
              </div>
            )}
          </Section>

          {/* ── SUPPLIES ── */}
          <Section title="Buy Supplies">
            <div className="px-4 py-3 space-y-3">
              <SupplyRow
                label="Corn"
                subLabel="$2 / unit — feeds workers"
                value={cornToBuy}
                onChange={setCornToBuy}
                cost={cornToBuy * 2}
              />
              <SupplyRow
                label="Blankets"
                subLabel="$3 each — prevents cold health loss"
                value={blanketsToBuy}
                onChange={setBlanketsToBuy}
                cost={blanketsToBuy * 3}
              />
              {(cornToBuy > 0 || blanketsToBuy > 0) && (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-earth-300 text-sm">Total: ${supplyCost}</span>
                  <button
                    onClick={handleBuySupplies}
                    disabled={!canAffordSupplies}
                    className="px-4 py-1.5 bg-earth-600 text-earth-100 rounded text-sm disabled:opacity-40"
                  >
                    {canAffordSupplies ? 'Buy' : 'Cannot Afford'}
                  </button>
                </div>
              )}
            </div>
          </Section>

          {/* ── BUILD ── */}
          {!smokehouseBuilt && (
            <Section title="Build">
              <div className="px-4 py-3 flex items-center justify-between">
                <div>
                  <span className="text-earth-200 text-sm font-bold">Smokehouse</span>
                  <p className="text-earth-500 text-xs">Unlocks 50-unit crop storage. Required to sell crops.</p>
                  <p className="text-earth-400 text-xs mt-0.5">Cost: ${SMOKEHOUSE_BUILD_COST_MIN}</p>
                </div>
                <button
                  onClick={buildSmokehouse}
                  disabled={!canAffordSmokehouse}
                  className="px-4 py-2 bg-earth-600 border border-earth-500 text-earth-100 rounded text-sm disabled:opacity-40"
                >
                  {canAffordSmokehouse ? 'Build' : `Need $${SMOKEHOUSE_BUILD_COST_MIN}`}
                </button>
              </div>
            </Section>
          )}

          {/* ── SELL ── */}
          {sellableCrops.length > 0 && (
            <Section title="Queue Sales">
              <div className="px-4 py-3 space-y-3">
                <p className="text-earth-500 text-xs">
                  Your factor will execute these sales next market day. Set a minimum price floor to wait for better prices — at the risk of spoilage.
                </p>
                {sellableCrops.map(([crop, available]) => (
                  <div key={crop} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-earth-200 text-sm">{CROP_LABELS[crop]}</span>
                      <span className="text-earth-500 text-xs">{available} units in storage</span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min={0}
                        max={available}
                        value={saleQty[crop] ?? 0}
                        onChange={e => setSaleQty(p => ({ ...p, [crop]: Math.min(available, Number(e.target.value)) }))}
                        placeholder="Qty"
                        className="w-20 bg-earth-800 border border-earth-600 text-earth-100 px-2 py-1 rounded text-sm"
                      />
                      <input
                        type="number"
                        min={0}
                        value={salePrice[crop] ?? ''}
                        onChange={e => setSalePrice(p => ({ ...p, [crop]: Number(e.target.value) || 0 }))}
                        placeholder="Min $"
                        className="w-20 bg-earth-800 border border-earth-600 text-earth-100 px-2 py-1 rounded text-sm"
                      />
                      <button
                        onClick={() => handleQueueSale(crop)}
                        disabled={!saleQty[crop]}
                        className="px-3 py-1 bg-earth-600 text-earth-100 rounded text-sm disabled:opacity-40"
                      >
                        Queue
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Queued sales this season */}
          {finances.queuedSales.length > 0 && (
            <Section title="Queued This Season">
              {finances.queuedSales.map(sale => (
                <div key={sale.id} className="px-4 py-2 text-earth-400 text-xs">
                  {sale.quantity} × {sale.crop}
                  {sale.minPriceFloor ? ` (floor $${sale.minPriceFloor})` : ''}
                </div>
              ))}
            </Section>
          )}

          <div className="h-4" /> {/* bottom padding */}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-earth-700 flex gap-3">
          <button
            onClick={closeSeasonPlanner}
            className="flex-1 py-3 border border-earth-600 text-earth-300 font-serif rounded"
          >
            Cancel
          </button>
          <button
            onClick={confirmPlanAndAdvance}
            disabled={overAllocated}
            className="flex-2 flex-grow-[2] py-3 bg-earth-600 border border-earth-500 text-earth-100 font-serif font-bold rounded disabled:opacity-40"
          >
            {overAllocated ? 'Too many workers assigned' : `End ${currentSeason} →`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-earth-800">
      <div className="px-4 py-2 bg-earth-800/50">
        <span className="text-earth-400 text-xs font-bold uppercase tracking-wider">{title}</span>
      </div>
      {children}
    </div>
  )
}

function WorkerCounter({ value, onDecrease, onIncrease, max }: {
  value:      number
  onDecrease: () => void
  onIncrease: () => void
  max:        number
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onDecrease}
        disabled={value <= 0}
        className="w-8 h-8 bg-earth-700 border border-earth-600 text-earth-200 rounded disabled:opacity-30 text-lg leading-none"
      >
        −
      </button>
      <span className="font-mono text-earth-100 w-6 text-center text-sm">{value}</span>
      <button
        onClick={onIncrease}
        disabled={value >= max}
        className="w-8 h-8 bg-earth-700 border border-earth-600 text-earth-200 rounded disabled:opacity-30 text-lg leading-none"
      >
        +
      </button>
    </div>
  )
}

function SupplyRow({ label, subLabel, value, onChange, cost }: {
  label:    string
  subLabel: string
  value:    number
  onChange: (n: number) => void
  cost:     number
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="text-earth-200 text-sm">{label}</span>
        <p className="text-earth-500 text-xs">{subLabel}</p>
      </div>
      <div className="flex items-center gap-2">
        {cost > 0 && <span className="text-earth-400 text-xs">${cost}</span>}
        <WorkerCounter
          value={value}
          onDecrease={() => onChange(Math.max(0, value - 1))}
          onIncrease={() => onChange(value + 1)}
          max={99}
        />
      </div>
    </div>
  )
}
