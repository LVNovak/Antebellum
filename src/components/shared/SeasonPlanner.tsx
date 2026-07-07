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
 *   - Supply buying: food and blankets
 *   - Build actions: smokehouse if not built
 *   - Sale queuing: if storage has crops
 *   - Footer: allocated count + Confirm button
 */

import { useState } from 'react'
import { useGameStore, SeasonPlan, TileAction, countAllocatedWorkers } from '@store/gameStore'
import { CropType, Tile, TerrainType, LaborType } from '@engine/types'
import { getTileDisplayLabel } from '@engine/tileUtils'
import {
  STORAGE_CAPACITY_STOREHOUSE,
  SMOKEHOUSE_BUILD_COST_MIN,
  LAND_PARCEL_COST,
  WATER_ADJACENT_PRICE_PREMIUM,
  LABOR_ACQUISITION_COST,
  LABOR_SEASONAL_COST,
  CABIN_BUILD_COST_MIN,
  TIMBER_PER_CABIN_BUILD,
  TIMBER_SALE_PRICE_PER_UNIT,
  LABOR_UNITS_PER_WORKER_PER_SEASON,
  LAND_CLEARING_COST,
  CROP_LABOR_TO_PLANT,
  CROP_LABOR_TO_HARVEST,
  SEED_PURCHASE_COST,
  COMPOST_FACILITY_COST,
  COVER_CROP_SEED_STOCK_COST,
} from '@engine/constants'

const TERRAIN_LABELS: Record<TerrainType, string> = {
  [TerrainType.Upland]: 'Upland (cleared/clearable farmland)',
  [TerrainType.Forest]: 'Forest (needs clearing)',
  [TerrainType.Swamp]:  'Swamp (required for rice)',
}

const LABOR_TYPE_LABELS: Record<LaborType, string> = {
  [LaborType.EnslavedPurchased]: 'Enslaved (Purchase)',
  [LaborType.EnslavedHiredOut]:  'Enslaved (Hired-Out)',
  [LaborType.IndenturedBlack]:   'Indentured Servant — Black',
  [LaborType.IndenturedWhite]:   'Indentured Servant — White',
  [LaborType.FreeWage]:          'Free Wage Laborer',
}

// Plantable crops in Phase 1. Rice and Indigo are held back — Rice
// requires water-adjacent tiles (the GDD's land-purchase system can
// provide these, but the starting tile never is); Indigo is deferred
// as lower-priority per the original Phase 1 scoping. Tobacco, Corn,
// Cowpeas, Sweet Potato, and Cover Crop cover the core rotation loop
// (cash crop, food crop, nitrogen-fixer, subsistence buffer, soil
// restoration) without requiring water-adjacent land.
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

const CROP_DESCRIPTIONS: Record<CropType, string> = {
  [CropType.Tobacco]:     'Cash crop. High value, depletes soil fastest.',
  [CropType.Rice]:        'Cash crop. Requires water-adjacent land.',
  [CropType.Corn]:        'Food crop. Feeds your workers — adds to provisions.',
  [CropType.Cowpeas]:     'Nitrogen-fixer. Low value but restores soil nitrogen.',
  [CropType.SweetPotato]: 'Food crop. Modest soil restoration, adds to provisions.',
  [CropType.Indigo]:      'Cash crop. Moderate value.',
  [CropType.CoverCrop]:   'No yield. Best all-around soil restoration — plant to recover an exhausted field.',
  [CropType.Fallow]:      'No yield. Leave the field bare to rest and recover.',
}

export default function SeasonPlanner() {
  const gameState            = useGameStore(s => s.gameState)
  const seasonPlan: SeasonPlan = useGameStore(s => s.seasonPlan)
  const setTileAction        = useGameStore(s => s.setTileAction)
  const setCabinRepair       = useGameStore(s => s.setCabinRepairWorkers)
  const setStorageWorkers    = useGameStore(s => s.setStorageWorkers)
  const setCompostWorkers    = useGameStore(s => s.setCompostWorkers)
  const sellTimber           = useGameStore(s => s.sellTimber)
  const setFamilyTask        = useGameStore(s => s.setFamilyTask)
  const setSkilledWorkerTask = useGameStore(s => s.setSkilledWorkerTask)
  const confirmPlanAndAdvance = useGameStore(s => s.confirmPlanAndAdvance)
  const closeSeasonPlanner   = useGameStore(s => s.closeSeasonPlanner)
  const buySupplies          = useGameStore(s => s.buySupplies)
  const buildSmokehouse      = useGameStore(s => s.buildSmokehouse)
  const queueSale            = useGameStore(s => s.queueSale)
  const buyLandParcel        = useGameStore(s => s.buyLandParcel)
  const createField          = useGameStore(s => s.createField)
  const renameField          = useGameStore(s => s.renameField)
  const deleteField          = useGameStore(s => s.deleteField)
  const addTileToField       = useGameStore(s => s.addTileToField)
  const removeTileFromField  = useGameStore(s => s.removeTileFromField)
  const setFieldMixedCropMode = useGameStore(s => s.setFieldMixedCropMode)
  const hireWorker           = useGameStore(s => s.hireWorker)
  const compostTile          = useGameStore(s => s.compostTile)
  const buySeeds             = useGameStore(s => s.buySeeds)
  const buildCompostFacility  = useGameStore(s => s.buildCompostFacility)
  const buyCoverCropSeedStock = useGameStore(s => s.buyCoverCropSeedStock)
  const clearTileField        = useGameStore(s => s.clearTileField)
  const buildNewCabin         = useGameStore(s => s.buildNewCabin)
  const cancelSale            = useGameStore(s => s.cancelSale)
  const updateSaleQuantity    = useGameStore(s => s.updateSaleQuantity)

  const [cornToBuy,    setCornToBuy]    = useState(0)
  const [blanketsToBuy, setBlanketsToBuy] = useState(0)
  const [saleQty,      setSaleQty]      = useState<Partial<Record<CropType, number>>>({})
  const [saleQtyRaw,   setSaleQtyRaw]   = useState<Partial<Record<CropType, string>>>({})
  const [salePrice,    setSalePrice]    = useState<Partial<Record<CropType, number>>>({})
  const [lastHireMessage, setLastHireMessage] = useState<string | null>(null)
  const [queueFlash,   setQueueFlash]   = useState<Partial<Record<CropType, boolean>>>({})
  const [buyFlash,     setBuyFlash]     = useState(false)
  const [newFieldName, setNewFieldName] = useState('')
  const [actionFlash,  setActionFlash]  = useState<Record<string, boolean>>({})

  function flashAction(key: string) {
    setActionFlash(p => ({ ...p, [key]: true }))
    setTimeout(() => setActionFlash(p => ({ ...p, [key]: false })), 600)
  }

  function flashQueue(crop: CropType) {
    setQueueFlash(p => ({ ...p, [crop]: true }))
    setTimeout(() => setQueueFlash(p => ({ ...p, [crop]: false })), 600)
  }

  if (!gameState) return null

  const {
    workers, tiles, storage, finances, cabins,
    currentSeason, currentYear,
    clearedMaterialOnHand, seedInventory,
    compostFacilityBuilt, coverCropSeedStockOwned,
    family, timberOnHand, fields,
  } = gameState
  const skilledWorkerIds  = workers.filter(w => w.skill !== 'Field').map(w => w.id)
  const pinnedSkilledCount = Object.entries(seasonPlan.skilledAssignments ?? {})
    .filter(([id, t]) => t !== null && t !== undefined && skilledWorkerIds.includes(id)).length
  const generalWorkers   = workers.length - skilledWorkerIds.length
  const totalWorkers     = generalWorkers
  const allocated        = countAllocatedWorkers(seasonPlan)
  const remaining        = totalWorkers - allocated
  const overAllocated    = remaining < 0
  // Family labor is tracked separately — doesn't consume worker slots
  const activeFamilyUnits = (family ?? []).filter(m => m.laborUnits > 0 && seasonPlan.familyAssignments[m.id] && seasonPlan.familyAssignments[m.id] !== null).length
  const storehouseBuilt  = storage.capacity >= STORAGE_CAPACITY_STOREHOUSE
  const canAffordStorehouse = finances.cashOnHand >= SMOKEHOUSE_BUILD_COST_MIN
  const cornCost         = cornToBuy * 2
  const blanketCost      = blanketsToBuy * 3
  const supplyCost       = cornCost + blanketCost
  const canAffordSupplies = finances.cashOnHand >= supplyCost
  const cabinSpaceAvailable = cabins.reduce((sum, c) => sum + c.capacity, 0) - workers.length

  // Crops in storage available to sell — subtract already-queued quantities
  // so the player sees the true remaining sellable amount, not the stale total.
  const queuedByType = finances.queuedSales.reduce((acc, sale) => {
    acc[sale.crop] = (acc[sale.crop] ?? 0) + sale.quantity
    return acc
  }, {} as Partial<Record<CropType, number>>)

  const sellableCrops = Object.entries(storage.inventory)
    .map(([crop, qty]) => {
      const queued = queuedByType[crop as CropType] ?? 0
      return [crop as CropType, Math.max(0, (qty ?? 0) - queued)] as [CropType, number]
    })
    .filter(([, qty]) => qty > 0)

  function handleBuySupplies() {
    if (cornToBuy > 0 || blanketsToBuy > 0) {
      buySupplies(cornToBuy, blanketsToBuy)
      setCornToBuy(0)
      setBlanketsToBuy(0)
      setBuyFlash(true)
      setTimeout(() => setBuyFlash(false), 600)
    }
  }

  function handleQueueSale(crop: CropType) {
    const qty   = saleQty[crop]   ?? 0
    const price = (salePrice[crop] && salePrice[crop]! > 0) ? salePrice[crop]! : null
    if (qty > 0) {
      queueSale(crop, qty, price)
      setSaleQty(p    => ({ ...p, [crop]: 0 }))
      setSaleQtyRaw(p => ({ ...p, [crop]: '' }))
      flashQueue(crop)
    }
  }

  function getTileDescription(tile: Tile): string {
    if (!tile.isCleared) return `Uncleared — ${tile.clearingProgressRemaining.toFixed(1)} labor-unit(s) to clear`
    if (tile.currentCrop === CropType.Fallow) return 'Fallow — resting and recovering'
    if (tile.currentCrop === CropType.CoverCrop) return 'Cover crop — actively restoring soil'
    if (tile.currentCrop) return `Planted: ${CROP_LABELS[tile.currentCrop]}`
    return 'Empty — resting as fallow (soil recovering)'
  }

  // Only show plantable crops for which the player has seeds.
  // CoverCrop additionally requires coverCropSeedStockOwned flag.
  const availableCrops = [
    CropType.Tobacco,
    CropType.Corn,
    CropType.Cowpeas,
    CropType.SweetPotato,
    CropType.CoverCrop,
  ].filter(crop => {
    if (crop === CropType.CoverCrop) return coverCropSeedStockOwned
    return (seedInventory?.[crop] ?? 0) > 0
  })

  function getAvailableActionsForTile(tile: Tile): TileAction['type'][] {
    if (!tile.isCleared) return ['Clear']
    // Planted tile — allow tending, harvesting, or clearing the field
    // "ClearField" removes the crop without harvesting (cover crops, bad harvests)
    if (tile.currentCrop === CropType.Fallow || tile.currentCrop === CropType.CoverCrop) {
      return ['Tend', 'ClearField', 'Idle']
    }
    if (tile.currentCrop) return ['Tend', 'Harvest', 'ClearField', 'Idle']
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

    if (action.type === 'Clear')      setTileAction(tile.id, { type: 'Clear',   workers: newCount })
    if (action.type === 'Tend')       setTileAction(tile.id, { type: 'Tend',    workers: newCount })
    if (action.type === 'Harvest')    setTileAction(tile.id, { type: 'Harvest', workers: newCount })
    if (action.type === 'ClearField') setTileAction(tile.id, { type: 'ClearField', workers: newCount })
    if (action.type === 'Plant' && action.crop)
      setTileAction(tile.id, { type: 'Plant', workers: newCount, crop: action.crop })
  }

  function selectTileActionType(tile: Tile, actionType: TileAction['type'], crop?: CropType) {
    if (actionType === 'Idle') { setTileAction(tile.id, { type: 'Idle' }); return }
    // ClearField is handled immediately in the store — no labor allocated
    if (actionType === 'ClearField') {
      clearTileField(tile.id)
      return
    }
    const workers = getWorkerCountForTile(tile.id) || 1
    if (actionType === 'Clear')   setTileAction(tile.id, { type: 'Clear',   workers })
    if (actionType === 'Tend')    setTileAction(tile.id, { type: 'Tend',    workers })
    if (actionType === 'Harvest') setTileAction(tile.id, { type: 'Harvest', workers })
    if (actionType === 'Plant') {
      const cropToUse = crop ?? (availableCrops[0] ?? CropType.Tobacco)
      setTileAction(tile.id, { type: 'Plant', workers, crop: cropToUse })
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-40 flex items-end sm:items-center justify-center">
      <div className="bg-earth-900 border border-earth-700 sm:rounded-lg w-full max-w-lg max-h-[92vh] sm:max-h-[85vh] flex flex-col">

        {/* Header — sticky, always visible while scrolling */}
        <div className="sticky top-0 z-10 bg-earth-900 px-4 py-3 border-b border-earth-700 flex items-center justify-between">
          <div>
            <h2 className="font-serif text-earth-100 text-lg font-bold">
              Plan Your Season
            </h2>
            <p className="text-earth-400 text-xs">{currentSeason} — Year {currentYear}</p>
          </div>
          <div className="text-right">
            <div className={`font-mono font-bold text-sm ${overAllocated ? 'text-soil-poor' : 'text-soil-good'}`}>
              {allocated} / {totalWorkers} general
            </div>
            {skilledWorkerIds.length > 0 && (
              <div className="font-mono text-xs text-earth-300">
                {pinnedSkilledCount} / {skilledWorkerIds.length} skilled assigned
              </div>
            )}
            {activeFamilyUnits > 0 && (
              <div className="font-mono text-xs text-earth-400">+{activeFamilyUnits} household</div>
            )}
            <div className="text-earth-500 text-xs">
              {remaining > 0 ? `${remaining} resting` : overAllocated ? 'Over-allocated!' : 'All assigned'}
            </div>
            <div className={`font-mono text-xs mt-0.5 ${finances.cashOnHand >= 0 ? 'text-earth-400' : 'text-soil-poor'}`}>
              ${finances.cashOnHand.toFixed(0)} cash
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── LABOR REFERENCE ── */}
          <LaborReference />

          {/* ── LAND TASKS ── */}
          <Section title="Land & Crops">
            {tiles.map((tile, tileIndex) => {
              const currentAction = getCurrentTileAction(tile.id)
              const workerCount   = getWorkerCountForTile(tile.id)
              const availableActions = getAvailableActionsForTile(tile)
              const isPlantAction = currentAction.type === 'Plant'
              const selectedCrop  = isPlantAction ? currentAction.crop : null

              return (
                <div key={tile.id} className="px-4 py-3 border-b border-earth-800">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-earth-500 text-xs font-mono mr-1">#{tileIndex + 1}</span>
                      <span className="text-earth-200 text-sm font-bold">
                        {getTileDisplayLabel(tile)}
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
                    <div className="mb-2">
                      <div className="flex flex-wrap gap-1">
                        {availableCrops.length > 0 ? availableCrops.map(crop => (
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
                        )) : (
                          <p className="text-soil-poor text-xs">No seeds available — buy seeds in the Supplies section below.</p>
                        )}
                      </div>
                      {selectedCrop && (
                        <p className="text-earth-500 text-xs mt-1">{CROP_DESCRIPTIONS[selectedCrop]}</p>
                      )}
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

                  {/* Compost cleared material — shown on cleared tiles when material is available */}
                  {tile.isCleared && clearedMaterialOnHand > 0 && (
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-earth-800">
                      <span className="text-earth-400 text-xs">
                        Compost cleared material onto this field
                      </span>
                      <button
                        onClick={() => { compostTile(tile.id); flashAction(`compost-${tile.id}`) }}
                        className={`px-3 py-1 rounded text-xs transition-colors duration-300 ${actionFlash[`compost-${tile.id}`] ? 'bg-soil-good text-white' : 'bg-earth-600 text-earth-100'}`}
                      >
                        {actionFlash[`compost-${tile.id}`] ? '✓ Applied' : 'Apply (1 unit)'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </Section>

          {/* Cleared material stockpile note */}
          {clearedMaterialOnHand > 0 && (
            <div className="px-4 py-2 bg-earth-800/30 text-earth-500 text-xs">
              {clearedMaterialOnHand} unit(s) of cleared material in storage — apply to a field above to boost its soil.
            </div>
          )}

          {/* ── FIELDS ── */}
          {tiles.filter(t => t.isCleared).length >= 10 && (
            <Section title="Fields">
              <p className="px-4 pt-2 text-earth-500 text-xs">
                Group tiles into named fields to assign tasks and workers in one action.
                Each tile still has its own soil — grouping is organizational only.
              </p>

              <div className="px-4 py-3 flex gap-2 border-b border-earth-800">
                <input
                  type="text"
                  value={newFieldName}
                  onChange={e => setNewFieldName(e.target.value)}
                  placeholder="New field name…"
                  className="flex-1 bg-earth-700 border border-earth-600 text-earth-200 text-sm px-2 py-1 rounded"
                />
                <button
                  onClick={() => {
                    if (newFieldName.trim()) {
                      createField(newFieldName)
                      setNewFieldName('')
                      flashAction('createField')
                    }
                  }}
                  disabled={!newFieldName.trim()}
                  className={`px-3 py-1 rounded text-xs disabled:opacity-40 transition-colors duration-300 ${actionFlash.createField ? 'bg-soil-good text-white' : 'bg-earth-600 text-earth-100'}`}
                >
                  {actionFlash.createField ? '✓ Created' : 'Create'}
                </button>
              </div>

              {(fields ?? []).map(field => {
                const fieldTiles = tiles.filter(t => field.tileIds.includes(t.id))
                const tilesInAnyField = new Set((fields ?? []).flatMap(f => f.tileIds))
                const availableTilesToAdd = tiles.filter(t => !tilesInAnyField.has(t.id))

                // Aggregate stats for the field summary line
                const avgYield = fieldTiles.length > 0
                  ? Math.round(fieldTiles.reduce((s, t) => {
                      const lastHarvest = t.history?.filter(h => h.yieldProduced > 0).slice(-1)[0]
                      return s + (lastHarvest?.yieldProduced ?? 0)
                    }, 0) / fieldTiles.length)
                  : 0
                const needsRotation = fieldTiles.some(t => {
                  const soilAvg = (t.soil.organicMatter + t.soil.nitrogen + t.soil.soilFauna + t.soil.moistureRetention) / 4
                  return soilAvg < 35
                })

                // Batch task state — read from the first tile's current action as a proxy
                const firstTileAction = fieldTiles[0] ? getCurrentTileAction(fieldTiles[0].id) : { type: 'Idle' as const }
                const fieldTaskType = firstTileAction.type
                const fieldCrop = firstTileAction.type === 'Plant' ? firstTileAction.crop : null
                const fieldWorkerTotal = fieldTiles.reduce((s, t) => s + getWorkerCountForTile(t.id), 0)

                function applyFieldTask(taskType: string, crop?: CropType) {
                  const total = fieldWorkerTotal || fieldTiles.length
                  const base = Math.floor(total / fieldTiles.length)
                  const remainder = total % fieldTiles.length
                  fieldTiles.forEach((t, i) => {
                    const workersForTile = base + (i < remainder ? 1 : 0)
                    if (taskType === 'Idle')    { setTileAction(t.id, { type: 'Idle' }); return }
                    if (taskType === 'Clear')   setTileAction(t.id, { type: 'Clear', workers: Math.max(1, workersForTile) })
                    if (taskType === 'Tend')    setTileAction(t.id, { type: 'Tend', workers: Math.max(1, workersForTile) })
                    if (taskType === 'Harvest') setTileAction(t.id, { type: 'Harvest', workers: Math.max(1, workersForTile) })
                    if (taskType === 'Plant') {
                      const cropToUse = crop ?? fieldCrop ?? availableCrops[0] ?? CropType.Tobacco
                      setTileAction(t.id, { type: 'Plant', workers: Math.max(1, workersForTile), crop: cropToUse })
                    }
                  })
                }

                function setFieldWorkerTotal(total: number) {
                  applyFieldTask(fieldTaskType === 'Idle' ? 'Clear' : fieldTaskType, fieldCrop ?? undefined)
                  // Re-run distribution with the new total by directly writing here
                  const base = Math.floor(total / fieldTiles.length)
                  const remainder = total % fieldTiles.length
                  fieldTiles.forEach((t, i) => {
                    const workersForTile = base + (i < remainder ? 1 : 0)
                    const taskType = fieldTaskType === 'Idle' ? 'Clear' : fieldTaskType
                    if (taskType === 'Clear')   setTileAction(t.id, { type: 'Clear', workers: workersForTile })
                    if (taskType === 'Tend')    setTileAction(t.id, { type: 'Tend', workers: workersForTile })
                    if (taskType === 'Harvest') setTileAction(t.id, { type: 'Harvest', workers: workersForTile })
                    if (taskType === 'Plant') {
                      const cropToUse = fieldCrop ?? availableCrops[0] ?? CropType.Tobacco
                      setTileAction(t.id, { type: 'Plant', workers: workersForTile, crop: cropToUse })
                    }
                  })
                }

                return (
                  <div key={field.id} className="px-4 py-3 border-b border-earth-800 last:border-0">
                    <div className="flex items-center justify-between mb-1">
                      <input
                        type="text"
                        defaultValue={field.name}
                        onBlur={e => renameField(field.id, e.target.value)}
                        className="bg-transparent text-earth-100 text-sm font-bold border-b border-transparent focus:border-earth-600 outline-none"
                      />
                      <button
                        onClick={() => deleteField(field.id)}
                        className="text-earth-500 text-xs hover:text-soil-poor"
                      >
                        Delete
                      </button>
                    </div>

                    <p className="text-earth-500 text-xs mb-2">
                      {fieldTiles.length} tile{fieldTiles.length !== 1 ? 's' : ''}
                      {fieldTiles.length > 0 && `, last yield avg ${avgYield}/tile`}
                      {needsRotation && <span className="text-soil-poor"> — rotation needed</span>}
                    </p>

                    <div className="flex flex-wrap gap-1 mb-2">
                      {fieldTiles.map(t => (
                        <span key={t.id} className="inline-flex items-center gap-1 bg-earth-700 text-earth-300 text-[10px] px-1.5 py-0.5 rounded">
                          #{tiles.findIndex(x => x.id === t.id) + 1}
                          <button onClick={() => removeTileFromField(field.id, t.id)} className="text-earth-500 hover:text-soil-poor">×</button>
                        </span>
                      ))}
                    </div>

                    {availableTilesToAdd.length > 0 && (
                      <select
                        value=""
                        onChange={e => { if (e.target.value) addTileToField(field.id, e.target.value) }}
                        className="w-full bg-earth-700 border border-earth-600 text-earth-200 text-xs px-2 py-1 rounded mb-2"
                      >
                        <option value="">Add a tile…</option>
                        {availableTilesToAdd.map(t => (
                          <option key={t.id} value={t.id}>
                            #{tiles.findIndex(x => x.id === t.id) + 1} — {t.terrain} {t.currentCrop ? `(${t.currentCrop})` : '(empty)'}
                          </option>
                        ))}
                      </select>
                    )}

                    <label className="flex items-center gap-2 text-earth-400 text-xs mb-2">
                      <input
                        type="checkbox"
                        checked={field.mixedCropMode}
                        onChange={e => setFieldMixedCropMode(field.id, e.target.checked)}
                      />
                      Advanced: allow mixed crops (manage tiles individually above)
                    </label>

                    {!field.mixedCropMode && fieldTiles.length > 0 && (
                      <div className="bg-earth-900 rounded p-2">
                        <div className="flex flex-wrap gap-1 mb-2">
                          {(['Clear', 'Plant', 'Tend', 'Harvest'] as const).map(t => (
                            <button
                              key={t}
                              onClick={() => applyFieldTask(t)}
                              className={`px-2 py-1 rounded text-xs border ${fieldTaskType === t ? 'bg-earth-500 border-earth-300 text-earth-100' : 'bg-earth-800 border-earth-700 text-earth-400'}`}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                        {fieldTaskType === 'Plant' && (
                          <div className="flex flex-wrap gap-1 mb-2">
                            {availableCrops.map(crop => (
                              <button
                                key={crop}
                                onClick={() => applyFieldTask('Plant', crop)}
                                className={`px-2 py-1 rounded text-xs border ${fieldCrop === crop ? 'bg-earth-500 border-earth-300 text-earth-100' : 'bg-earth-800 border-earth-700 text-earth-400'}`}
                              >
                                {CROP_LABELS[crop]}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-earth-400 text-xs">Total workers for field</span>
                          <WorkerCounter
                            value={fieldWorkerTotal}
                            onDecrease={() => setFieldWorkerTotal(Math.max(0, fieldWorkerTotal - 1))}
                            onIncrease={() => setFieldWorkerTotal(fieldWorkerTotal + 1)}
                            max={remaining + fieldWorkerTotal}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </Section>
          )}

          {/* ── SKILLED ASSIGNMENTS ── */}
          {workers.filter(w => w.skill !== 'Field').length > 0 && (
            <Section title="Skilled Assignments">
              <p className="px-4 pt-2 text-earth-500 text-xs">
                Pin a skilled worker to a specific task so their talent actually lands where it's needed.
              </p>
              {workers.filter(w => w.skill !== 'Field').map(worker => {
                const currentTask = seasonPlan.skilledAssignments[worker.id] ?? worker.assignedTask ?? null
                const currentType = currentTask?.type ?? 'null'
                const needsTile = currentType === 'ClearLand' || currentType === 'PlantCrop' || currentType === 'TendCrop' || currentType === 'HarvestCrop'
                const currentTileId = needsTile && currentTask && 'tileId' in currentTask ? currentTask.tileId : ''
                const currentCropChoice: CropType | null = currentType === 'PlantCrop' && currentTask && 'crop' in currentTask ? currentTask.crop : null

                // Recommend the task that matches the worker's skill
                const RECOMMENDED_TASK: Record<string, string> = {
                  Cooper:     'ManageStorage',
                  Carpenter:  'RepairCabin',
                  Cook:       'PlantCrop',
                  Blacksmith: 'PlantCrop',
                }

                const TASK_TYPES = [
                  { label: 'Rest', value: 'null' },
                  { label: 'Clear Land', value: 'ClearLand' },
                  { label: 'Plant Crop', value: 'PlantCrop', disabled: availableCrops.length === 0 },
                  { label: 'Tend Crop', value: 'TendCrop' },
                  { label: 'Harvest Crop', value: 'HarvestCrop' },
                  { label: 'Repair Cabin', value: 'RepairCabin' },
                  { label: 'Manage Storage', value: 'ManageStorage' },
                  { label: 'Tend Compost', value: 'TendCompost' },
                ]

                const tileOptions = tiles.filter(t => {
                  if (currentType === 'ClearLand') return !t.isCleared
                  if (!t.isCleared) return false
                  if (currentType === 'PlantCrop') return !t.currentCrop
                  if (currentType === 'TendCrop' || currentType === 'HarvestCrop') return !!t.currentCrop
                  return false
                })

                function handleTypeChange(newType: string) {
                  if (newType === 'null') { setSkilledWorkerTask(worker.id, null); return }
                  if (newType === 'ClearLand')     { setSkilledWorkerTask(worker.id, { type: 'ClearLand', tileId: '' }); return }
                  if (newType === 'RepairCabin')   { setSkilledWorkerTask(worker.id, { type: 'RepairCabin', cabinId: cabins[0]?.id ?? 'cabin-1' }); return }
                  if (newType === 'ManageStorage') { setSkilledWorkerTask(worker.id, { type: 'ManageStorage' }); return }
                  if (newType === 'TendCompost')   { setSkilledWorkerTask(worker.id, { type: 'TendCompost' }); return }
                  if (newType === 'PlantCrop' && availableCrops.length > 0) {
                    setSkilledWorkerTask(worker.id, { type: 'PlantCrop', tileId: '', crop: availableCrops[0] })
                    return
                  }
                  if (newType === 'TendCrop')   { setSkilledWorkerTask(worker.id, { type: 'TendCrop', tileId: '' }); return }
                  if (newType === 'HarvestCrop'){ setSkilledWorkerTask(worker.id, { type: 'HarvestCrop', tileId: '' }); return }
                }

                function handleTileChange(tileId: string) {
                  if (currentType === 'ClearLand') {
                    setSkilledWorkerTask(worker.id, { type: 'ClearLand', tileId })
                  } else if (currentType === 'PlantCrop' && currentCropChoice) {
                    setSkilledWorkerTask(worker.id, { type: 'PlantCrop', tileId, crop: currentCropChoice })
                  } else if (currentType === 'TendCrop') {
                    setSkilledWorkerTask(worker.id, { type: 'TendCrop', tileId })
                  } else if (currentType === 'HarvestCrop') {
                    setSkilledWorkerTask(worker.id, { type: 'HarvestCrop', tileId })
                  }
                }

                function handleCropChange(crop: CropType) {
                  setSkilledWorkerTask(worker.id, { type: 'PlantCrop', tileId: currentTileId, crop })
                }

                const isOptimal = currentType === RECOMMENDED_TASK[worker.skill]

                return (
                  <div key={worker.id} className="px-4 py-3 border-b border-earth-800 last:border-0">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="text-earth-200 text-sm font-bold">{worker.name}</span>
                        <span className="text-soil-good text-xs ml-2 font-semibold">{worker.skill}</span>
                      </div>
                      {isOptimal && <span className="text-soil-good text-xs">Skill active</span>}
                    </div>
                    <select
                      value={currentType}
                      onChange={e => handleTypeChange(e.target.value)}
                      className="w-full bg-earth-700 border border-earth-600 text-earth-200 text-sm px-2 py-1 rounded"
                    >
                      {TASK_TYPES.map(t => (
                        <option key={t.value} value={t.value} disabled={'disabled' in t && t.disabled}>
                          {t.label}{'disabled' in t && t.disabled ? ' (no seeds)' : ''}
                        </option>
                      ))}
                    </select>
                    {needsTile && (
                      <select
                        value={currentTileId}
                        onChange={e => handleTileChange(e.target.value)}
                        className="w-full bg-earth-700 border border-earth-600 text-earth-200 text-sm px-2 py-1 rounded mt-2"
                      >
                        <option value="">Select a tile…</option>
                        {tileOptions.map(t => (
                          <option key={t.id} value={t.id}>
                            #{tiles.findIndex(x => x.id === t.id) + 1} — {t.terrain} {t.currentCrop ? `(${t.currentCrop})` : '(empty)'}
                          </option>
                        ))}
                      </select>
                    )}
                    {currentType === 'PlantCrop' && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {availableCrops.length > 0 ? availableCrops.map(crop => (
                          <button
                            key={crop}
                            onClick={() => handleCropChange(crop)}
                            className={`px-2 py-1 rounded text-xs border transition-colors ${
                              currentCropChoice === crop
                                ? 'bg-earth-500 border-earth-300 text-earth-100'
                                : 'bg-earth-800 border-earth-700 text-earth-400'
                            }`}
                          >
                            {CROP_LABELS[crop]}
                          </button>
                        )) : (
                          <p className="text-soil-poor text-xs">No seeds available — buy seeds below.</p>
                        )}
                      </div>
                    )}
                    {needsTile && (!currentTileId || (currentType === 'PlantCrop' && !currentCropChoice)) && (
                      <p className="text-soil-poor text-xs mt-1">
                        {!currentTileId ? 'Select a tile — no tile chosen means no effect.' : 'Select a crop to plant.'}
                      </p>
                    )}
                  </div>
                )
              })}
            </Section>
          )}

          {/* ── FAMILY LABOR ── */}
          {(family ?? []).filter(m => m.laborUnits > 0).length > 0 && (
            <Section title="Household Labor">
              {(family ?? []).filter(m => m.laborUnits > 0).map(member => {
                const currentTask = seasonPlan.familyAssignments[member.id] ?? null
                const currentType = currentTask?.type ?? 'null'
                const needsTile = currentType === 'ClearLand' || currentType === 'PlantCrop' || currentType === 'TendCrop' || currentType === 'HarvestCrop'
                const currentTileId = needsTile && currentTask && 'tileId' in currentTask ? currentTask.tileId : ''
                const currentCropChoice: CropType | null = currentType === 'PlantCrop' && currentTask && 'crop' in currentTask ? currentTask.crop : null

                const TASK_TYPES = [
                  { label: 'Rest', value: 'null' },
                  { label: 'Clear Land', value: 'ClearLand' },
                  { label: 'Plant Crop', value: 'PlantCrop', disabled: availableCrops.length === 0 },
                  { label: 'Tend Crop', value: 'TendCrop' },
                  { label: 'Harvest Crop', value: 'HarvestCrop' },
                  { label: 'Repair Cabin', value: 'RepairCabin' },
                  { label: 'Manage Storage', value: 'ManageStorage' },
                  { label: 'Tend Compost', value: 'TendCompost' },
                ]

                // Tile options depend on task: Clear needs uncleared land,
                // Plant needs cleared+empty tiles, Tend/Harvest need tiles
                // with a crop already in the ground.
                const tileOptions = tiles.filter(t => {
                  if (currentType === 'ClearLand') return !t.isCleared
                  if (!t.isCleared) return false
                  if (currentType === 'PlantCrop') return !t.currentCrop
                  if (currentType === 'TendCrop' || currentType === 'HarvestCrop') return !!t.currentCrop
                  return false
                })

                function handleTypeChange(newType: string) {
                  if (newType === 'null') { setFamilyTask(member.id, null); return }
                  if (newType === 'ClearLand')     { setFamilyTask(member.id, { type: 'ClearLand', tileId: '' }); return }
                  if (newType === 'RepairCabin')   { setFamilyTask(member.id, { type: 'RepairCabin', cabinId: cabins[0]?.id ?? 'cabin-1' }); return }
                  if (newType === 'ManageStorage') { setFamilyTask(member.id, { type: 'ManageStorage' }); return }
                  if (newType === 'TendCompost')   { setFamilyTask(member.id, { type: 'TendCompost' }); return }
                  if (newType === 'PlantCrop' && availableCrops.length > 0) {
                    setFamilyTask(member.id, { type: 'PlantCrop', tileId: '', crop: availableCrops[0] })
                    return
                  }
                  if (newType === 'TendCrop')   { setFamilyTask(member.id, { type: 'TendCrop', tileId: '' }); return }
                  if (newType === 'HarvestCrop'){ setFamilyTask(member.id, { type: 'HarvestCrop', tileId: '' }); return }
                }

                function handleTileChange(tileId: string) {
                  if (currentType === 'ClearLand') {
                    setFamilyTask(member.id, { type: 'ClearLand', tileId })
                  } else if (currentType === 'PlantCrop' && currentCropChoice) {
                    setFamilyTask(member.id, { type: 'PlantCrop', tileId, crop: currentCropChoice })
                  } else if (currentType === 'TendCrop') {
                    setFamilyTask(member.id, { type: 'TendCrop', tileId })
                  } else if (currentType === 'HarvestCrop') {
                    setFamilyTask(member.id, { type: 'HarvestCrop', tileId })
                  }
                }

                function handleCropChange(crop: CropType) {
                  setFamilyTask(member.id, { type: 'PlantCrop', tileId: currentTileId, crop })
                }

                return (
                  <div key={member.id} className="px-4 py-3 border-b border-earth-800 last:border-0">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="text-earth-200 text-sm font-bold">{member.name}</span>
                        <span className="text-earth-500 text-xs ml-2">{member.role} — free labor</span>
                      </div>
                      <span className="text-soil-good text-xs">No wage cost</span>
                    </div>
                    <select
                      value={currentType}
                      onChange={e => handleTypeChange(e.target.value)}
                      className="w-full bg-earth-700 border border-earth-600 text-earth-200 text-sm px-2 py-1 rounded"
                    >
                      {TASK_TYPES.map(t => (
                        <option key={t.value} value={t.value} disabled={'disabled' in t && t.disabled}>
                          {t.label}{'disabled' in t && t.disabled ? ' (no seeds)' : ''}
                        </option>
                      ))}
                    </select>
                    {needsTile && (
                      <select
                        value={currentTileId}
                        onChange={e => handleTileChange(e.target.value)}
                        className="w-full bg-earth-700 border border-earth-600 text-earth-200 text-sm px-2 py-1 rounded mt-2"
                      >
                        <option value="">Select a tile…</option>
                        {tileOptions.map(t => (
                          <option key={t.id} value={t.id}>
                            #{tiles.findIndex(x => x.id === t.id) + 1} — {t.terrain} {t.currentCrop ? `(${t.currentCrop})` : '(empty)'}
                          </option>
                        ))}
                      </select>
                    )}
                    {currentType === 'PlantCrop' && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {availableCrops.length > 0 ? availableCrops.map(crop => (
                          <button
                            key={crop}
                            onClick={() => handleCropChange(crop)}
                            className={`px-2 py-1 rounded text-xs border transition-colors ${
                              currentCropChoice === crop
                                ? 'bg-earth-500 border-earth-300 text-earth-100'
                                : 'bg-earth-800 border-earth-700 text-earth-400'
                            }`}
                          >
                            {CROP_LABELS[crop]}
                          </button>
                        )) : (
                          <p className="text-soil-poor text-xs">No seeds available — buy seeds below.</p>
                        )}
                      </div>
                    )}
                    {needsTile && (!currentTileId || (currentType === 'PlantCrop' && !currentCropChoice)) && (
                      <p className="text-soil-poor text-xs mt-1">
                        {!currentTileId ? 'Select a tile — no tile chosen means no effect.' : 'Select a crop to plant.'}
                      </p>
                    )}
                  </div>
                )
              })}
            </Section>
          )}

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

            {storage.capacity > 0 && (
              <div className="px-4 py-3 border-b border-earth-800 flex items-center justify-between">
                <div>
                  <span className="text-earth-200 text-sm">Storage Management</span>
                  <p className="text-earth-500 text-xs">Skilled Cooper/Carpenter reduces spoilage</p>
                </div>
                <WorkerCounter
                  value={seasonPlan.storageWorkers}
                  onDecrease={() => setStorageWorkers(Math.max(0, seasonPlan.storageWorkers - 1))}
                  onIncrease={() => setStorageWorkers(seasonPlan.storageWorkers + 1)}
                  max={remaining + seasonPlan.storageWorkers}
                />
              </div>
            )}

            {compostFacilityBuilt && clearedMaterialOnHand > 0 && (
              <div className="px-4 py-3 border-b border-earth-800 flex items-center justify-between">
                <div>
                  <span className="text-earth-200 text-sm">Tend Compost</span>
                  <p className="text-earth-500 text-xs">
                    {clearedMaterialOnHand} unit(s) available. 1 worker applies compost to 1 parcel per season.
                    Apply in Land &amp; Crops above after assigning a worker here.
                  </p>
                </div>
                <WorkerCounter
                  value={seasonPlan.compostWorkers}
                  onDecrease={() => setCompostWorkers(Math.max(0, seasonPlan.compostWorkers - 1))}
                  onIncrease={() => setCompostWorkers(seasonPlan.compostWorkers + 1)}
                  max={remaining + seasonPlan.compostWorkers}
                />
              </div>
            )}
          </Section>

          {/* ── LAND & LABOR ── */}
          <Section title="Acquire Land & Labor">
            <div className="px-4 py-3 space-y-4">

              {/* Land purchase */}
              <div>
                <p className="text-earth-200 text-sm font-bold mb-1">Buy Land Parcel</p>
                <p className="text-earth-500 text-xs mb-2">~2-3 acres per parcel. Swamp required for rice but costs more.</p>
                <div className="flex flex-col gap-1.5">
                  {(Object.keys(TERRAIN_LABELS) as TerrainType[]).map(terrain => {
                    const cost = LAND_PARCEL_COST[terrain]
                    const canAfford = finances.cashOnHand >= cost
                    const flashKey = `buyLand-${terrain}`
                    return (
                      <div key={terrain} className="flex items-center justify-between">
                        <span className="text-earth-300 text-xs">{TERRAIN_LABELS[terrain]}</span>
                        <button
                          onClick={() => { buyLandParcel(terrain, false); flashAction(flashKey) }}
                          disabled={!canAfford}
                          className={`px-3 py-1 rounded text-xs disabled:opacity-40 transition-colors duration-300 ${actionFlash[flashKey] ? 'bg-soil-good text-white' : 'bg-earth-600 text-earth-100'}`}
                        >
                          {actionFlash[flashKey] ? '✓ Bought' : `$${cost}`}
                        </button>
                      </div>
                    )
                  })}
                  <div className="flex items-center justify-between pt-1 border-t border-earth-800 mt-1">
                    <span className="text-earth-400 text-xs">Water-adjacent (rice-capable) swamp</span>
                    <button
                      onClick={() => { buyLandParcel(TerrainType.Swamp, true); flashAction('buyLand-swamp-water') }}
                      disabled={finances.cashOnHand < LAND_PARCEL_COST[TerrainType.Swamp] + WATER_ADJACENT_PRICE_PREMIUM}
                      className={`px-3 py-1 rounded text-xs disabled:opacity-40 transition-colors duration-300 ${actionFlash['buyLand-swamp-water'] ? 'bg-soil-good text-white' : 'bg-earth-600 text-earth-100'}`}
                    >
                      {actionFlash['buyLand-swamp-water'] ? '✓ Bought' : `$${LAND_PARCEL_COST[TerrainType.Swamp] + WATER_ADJACENT_PRICE_PREMIUM}`}
                    </button>
                  </div>
                </div>
              </div>

              {/* Labor hiring */}
              <div>
                <p className="text-earth-200 text-sm font-bold mb-1">Hire Labor</p>
                <p className="text-earth-500 text-xs mb-2">
                  {cabinSpaceAvailable > 0
                    ? `${cabinSpaceAvailable} cabin slot(s) available. Currently ${workers.length} worker(s).`
                    : `No cabin space — build a new cabin first ($${CABIN_BUILD_COST_MIN}+).`}
                </p>
                <div className="flex flex-col gap-1.5">
                  {(Object.keys(LABOR_TYPE_LABELS) as LaborType[]).map(laborType => {
                    const cost = LABOR_ACQUISITION_COST[laborType].min
                    const seasonalCost = LABOR_SEASONAL_COST[laborType].min
                    const canAfford = finances.cashOnHand >= cost && cabinSpaceAvailable > 0
                    const costLabel = laborType === LaborType.EnslavedPurchased
                      ? 'Provisions only (food + blankets)'
                      : `~$${seasonalCost}/season`
                    return (
                      <div key={laborType} className="flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="text-earth-300 text-xs">{LABOR_TYPE_LABELS[laborType]}</span>
                          <span className="text-earth-600 text-[10px]">
                            {costLabel}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            const before = workers.length
                            hireWorker(laborType)
                            setLastHireMessage(
                              `Hired — now ${before + 1} worker(s) on the roster.`
                            )
                            flashAction(`hire-${laborType}`)
                          }}
                          disabled={!canAfford}
                          className={`px-3 py-1 rounded text-xs disabled:opacity-40 transition-colors duration-300 ${actionFlash[`hire-${laborType}`] ? 'bg-soil-good text-white' : 'bg-earth-600 text-earth-100'}`}
                        >
                          {actionFlash[`hire-${laborType}`] ? '✓ Hired' : cost > 0 ? `Hire — $${cost}` : 'Hire'}
                        </button>
                      </div>
                    )
                  })}
                </div>
                {lastHireMessage && (
                  <p className="text-soil-good text-xs mt-2 bg-earth-900 border border-earth-700 rounded px-2 py-1.5">
                    ✓ {lastHireMessage}
                  </p>
                )}
              </div>
            </div>
          </Section>

          {/* ── SUPPLIES ── */}
          <Section title="Buy Supplies">
            <div className="px-4 py-3 space-y-3">
              <SupplyRow
                label="Food"
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
                    className={`px-4 py-1.5 rounded text-sm disabled:opacity-40 transition-colors duration-300 ${buyFlash ? 'bg-soil-good text-white' : 'bg-earth-600 text-earth-100'}`}
                  >
                    {canAffordSupplies ? 'Buy' : 'Cannot Afford'}
                  </button>
                </div>
              )}
            </div>
          </Section>

          {/* ── TIMBER ── */}
          <Section title="Timber">
            <div className="px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-earth-200 text-sm font-bold">{timberOnHand ?? 0} units on hand</span>
                  <p className="text-earth-500 text-xs">Used for cabin construction, repairs, and cooking fuel.</p>
                  <p className="text-earth-400 text-xs">Sell surplus at ${TIMBER_SALE_PRICE_PER_UNIT}/unit</p>
                </div>
                <button
                  onClick={() => { sellTimber(timberOnHand ?? 0); flashAction('sellTimber') }}
                  disabled={(timberOnHand ?? 0) === 0}
                  className={`px-3 py-1.5 rounded text-xs disabled:opacity-40 transition-colors duration-300 ${actionFlash.sellTimber ? 'bg-soil-good text-white' : 'bg-earth-600 text-earth-100'}`}
                >
                  {actionFlash.sellTimber ? '✓ Sold' : 'Sell All'}
                </button>
              </div>
            </div>
          </Section>

          {/* ── BUILD & SEEDS ── */}
          <Section title="Build & Seeds">
            <div className="px-4 py-3 space-y-4">

              {/* Build Cabin */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-earth-200 text-sm font-bold">New Cabin</span>
                  <p className="text-earth-500 text-xs">Adds 4 worker capacity. Starts in Good condition.</p>
                  <p className="text-earth-400 text-xs">
                    ${CABIN_BUILD_COST_MIN} + {TIMBER_PER_CABIN_BUILD} timber — {cabins.length} cabin{cabins.length !== 1 ? 's' : ''} now
                    ({cabins.reduce((s, c) => s + c.capacity, 0)} capacity / {workers.length} workers)
                  </p>
                </div>
                <button
                  onClick={() => { buildNewCabin(); flashAction('buildCabin') }}
                  disabled={finances.cashOnHand < CABIN_BUILD_COST_MIN || (timberOnHand ?? 0) < TIMBER_PER_CABIN_BUILD}
                  className={`px-3 py-1.5 rounded text-xs disabled:opacity-40 transition-colors duration-300 ${actionFlash.buildCabin ? 'bg-soil-good text-white' : 'bg-earth-600 text-earth-100'}`}
                >
                  {actionFlash.buildCabin
                    ? '✓ Built'
                    : finances.cashOnHand < CABIN_BUILD_COST_MIN
                      ? `Need $${CABIN_BUILD_COST_MIN}`
                      : (timberOnHand ?? 0) < TIMBER_PER_CABIN_BUILD
                        ? `Need ${TIMBER_PER_CABIN_BUILD} timber`
                        : 'Build'}
                </button>
              </div>
              {!storehouseBuilt && (
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-earth-200 text-sm font-bold">Storehouse</span>
                    <p className="text-earth-500 text-xs">Unlocks 50-unit crop storage. Required to sell crops.</p>
                    <p className="text-earth-400 text-xs">${SMOKEHOUSE_BUILD_COST_MIN}</p>
                  </div>
                  <button onClick={() => { buildSmokehouse(); flashAction('buildStorehouse') }} disabled={!canAffordStorehouse}
                    className={`px-3 py-1.5 rounded text-xs disabled:opacity-40 transition-colors duration-300 ${actionFlash.buildStorehouse ? 'bg-soil-good text-white' : 'bg-earth-600 text-earth-100'}`}>
                    {actionFlash.buildStorehouse ? '✓ Built' : canAffordStorehouse ? 'Build' : `Need $${SMOKEHOUSE_BUILD_COST_MIN}`}
                  </button>
                </div>
              )}

              {/* Compost facility */}
              {!compostFacilityBuilt && (
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-earth-200 text-sm font-bold">Compost Facility</span>
                    <p className="text-earth-500 text-xs">Enables composting cleared material onto fields. 1 worker tends the whole operation.</p>
                    <p className="text-earth-400 text-xs">${COMPOST_FACILITY_COST}</p>
                  </div>
                  <button onClick={buildCompostFacility}
                    disabled={finances.cashOnHand < COMPOST_FACILITY_COST}
                    className="px-3 py-1.5 bg-earth-600 text-earth-100 rounded text-xs disabled:opacity-40">
                    {finances.cashOnHand >= COMPOST_FACILITY_COST ? 'Build' : `Need $${COMPOST_FACILITY_COST}`}
                  </button>
                </div>
              )}

              {/* Cover crop seed stock */}
              {!coverCropSeedStockOwned && (
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-earth-200 text-sm font-bold">Cover Crop Seed Stock</span>
                    <p className="text-earth-500 text-xs">One-time purchase. Unlocks cover cropping permanently — best all-round soil restoration.</p>
                    <p className="text-earth-400 text-xs">${COVER_CROP_SEED_STOCK_COST}</p>
                  </div>
                  <button onClick={buyCoverCropSeedStock}
                    disabled={finances.cashOnHand < COVER_CROP_SEED_STOCK_COST}
                    className="px-3 py-1.5 bg-earth-600 text-earth-100 rounded text-xs disabled:opacity-40">
                    {finances.cashOnHand >= COVER_CROP_SEED_STOCK_COST ? 'Buy' : `Need $${COVER_CROP_SEED_STOCK_COST}`}
                  </button>
                </div>
              )}

              {/* Seed buying */}
              <div>
                <p className="text-earth-300 text-sm font-bold mb-1">Buy Seeds</p>
                <p className="text-earth-500 text-xs mb-2">Seeds required before planting. Harvest perpetuates your supply.</p>
                <div className="flex flex-col gap-1.5">
                  {([CropType.Tobacco, CropType.Corn, CropType.Cowpeas, CropType.SweetPotato] as CropType[]).map(crop => {
                    const cost = SEED_PURCHASE_COST[crop] ?? 0
                    const owned = (seedInventory?.[crop] ?? 0) > 0
                    return (
                      <div key={crop} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-earth-300 text-xs">{CROP_LABELS[crop]}</span>
                          {owned && <span className="text-soil-good text-[10px]">✓ have seeds</span>}
                        </div>
                        <button
                          onClick={() => { buySeeds(crop); flashAction(`buySeeds-${crop}`) }}
                          disabled={owned || finances.cashOnHand < cost}
                          className={`px-3 py-1 rounded text-xs disabled:opacity-40 transition-colors duration-300 ${actionFlash[`buySeeds-${crop}`] ? 'bg-soil-good text-white' : 'bg-earth-600 text-earth-100'}`}
                        >
                          {owned ? 'Owned' : `$${cost}`}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </Section>

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
                        type="text"
                        inputMode="numeric"
                        value={saleQtyRaw[crop] ?? ''}
                        onFocus={() => setSaleQtyRaw(p => ({ ...p, [crop]: saleQty[crop] ? String(saleQty[crop]) : '' }))}
                        onChange={e => {
                          const raw = e.target.value.replace(/[^0-9]/g, '')
                          setSaleQtyRaw(p => ({ ...p, [crop]: raw }))
                          const n = Math.min(available, parseInt(raw, 10) || 0)
                          setSaleQty(p => ({ ...p, [crop]: n }))
                        }}
                        placeholder="Qty"
                        className="w-20 bg-earth-800 border border-earth-600 text-earth-100 px-2 py-1 rounded text-sm"
                      />
                      <input
                        type="number"
                        min={0}
                        value={salePrice[crop] ?? ''}
                        onChange={e => {
                          const val = Number(e.target.value)
                          setSalePrice(p => ({ ...p, [crop]: val > 0 ? val : undefined }))
                        }}
                        placeholder="Min $"
                        className="w-20 bg-earth-800 border border-earth-600 text-earth-100 px-2 py-1 rounded text-sm"
                      />
                      <button
                        onClick={() => handleQueueSale(crop)}
                        disabled={!saleQty[crop]}
                        className={`px-3 py-1 rounded text-sm disabled:opacity-40 transition-colors duration-300 ${queueFlash[crop] ? 'bg-soil-good text-white' : 'bg-earth-600 text-earth-100'}`}
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
              {finances.queuedSales.map(sale => {
                const available = storage.inventory[sale.crop] ?? 0
                const overQueued = sale.quantity > available
                return (
                  <div key={sale.id} className="px-4 py-2 border-b border-earth-800 last:border-0">
                    <div className="flex items-center justify-between">
                      <span className={"text-xs " + (overQueued ? "text-red-400" : "text-earth-300")}>
                        {sale.quantity} × {sale.crop}
                        {sale.minPriceFloor ? ` (floor $${sale.minPriceFloor})` : ''}
                        {overQueued && ` — only ${available} in storage`}
                      </span>
                      <button
                        onClick={() => cancelSale(sale.id)}
                        className="ml-2 px-2 py-0.5 text-[10px] text-earth-500 border border-earth-700 rounded hover:text-red-400 hover:border-red-700"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-[10px] text-earth-600">Qty:</span>
                      <button
                        onClick={() => updateSaleQuantity(sale.id, Math.max(1, sale.quantity - 1))}
                        className="w-5 h-5 text-xs text-earth-400 border border-earth-700 rounded flex items-center justify-center"
                      >−</button>
                      <span className="text-xs text-earth-300 w-6 text-center">{sale.quantity}</span>
                      <button
                        onClick={() => updateSaleQuantity(sale.id, Math.min(available, sale.quantity + 1))}
                        disabled={sale.quantity >= available}
                        className="w-5 h-5 text-xs text-earth-400 border border-earth-700 rounded flex items-center justify-center disabled:opacity-40"
                      >+</button>
                    </div>
                  </div>
                )
              })}
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

// ── Labor reference panel ────────────────────────────────────────────────

/**
 * A collapsible reference explaining, in plain language, the labor
 * math the player needs to plan effectively: parcel size, what one
 * worker accomplishes per season for each task, and how long clearing
 * takes. All numbers are pulled from constants.ts — this component
 * is display-only and adds no new game logic.
 */
function LaborReference() {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border-b border-earth-800">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2 bg-earth-800/50 flex items-center justify-between text-left"
      >
        <span className="text-earth-400 text-xs font-bold uppercase tracking-wider">
          How Labor Works
        </span>
        <span className="text-earth-500 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-4 py-3 text-earth-400 text-xs space-y-2">
          <p>
            Each land parcel is roughly <strong className="text-earth-200">2-3 acres</strong> —
            about what one worker can fully tend in a season.
          </p>
          <p>
            <strong className="text-earth-200">Clearing:</strong> one worker clears
            roughly <strong className="text-earth-200">{LABOR_UNITS_PER_WORKER_PER_SEASON}</strong> labor-unit(s)
            per season. Forest needs {LAND_CLEARING_COST[TerrainType.Forest]} units total
            (~{Math.ceil(LAND_CLEARING_COST[TerrainType.Forest] / LABOR_UNITS_PER_WORKER_PER_SEASON)} seasons with one worker),
            Swamp needs {LAND_CLEARING_COST[TerrainType.Swamp]} units
            (~{Math.ceil(LAND_CLEARING_COST[TerrainType.Swamp] / LABOR_UNITS_PER_WORKER_PER_SEASON)} seasons with one worker),
            Upland needs only {LAND_CLEARING_COST[TerrainType.Upland]}.
            Assign more workers to clear faster.
          </p>
          <p>
            <strong className="text-earth-200">Planting &amp; Harvesting:</strong> most crops need{' '}
            <strong className="text-earth-200">{CROP_LABOR_TO_PLANT[CropType.Tobacco]} worker</strong> to plant
            and <strong className="text-earth-200">{CROP_LABOR_TO_HARVEST[CropType.Tobacco]} worker</strong> to
            harvest a single parcel of Tobacco or Corn. Rice needs more —
            {' '}{CROP_LABOR_TO_PLANT[CropType.Rice]} to plant and {CROP_LABOR_TO_HARVEST[CropType.Rice]} to harvest —
            reflecting its much higher labor demands.
          </p>
          <p>
            <strong className="text-earth-200">Tending:</strong> assigning a worker to "Tend" reduces
            weather damage to that parcel this season. Each tending worker
            offsets some of the penalty, up to a cap — tending helps in bad
            weather but can't fully prevent crop loss in severe conditions.
          </p>
          <p>
            <strong className="text-earth-200">Resting fields:</strong> a cleared parcel with nothing
            planted automatically rests as Fallow, slowly recovering its
            soil. Planting a Cover Crop recovers soil faster but yields
            nothing that season.
          </p>
        </div>
      )}
    </div>
  )
}

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
