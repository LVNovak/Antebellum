/**
 * gameStore.ts
 *
 * Global state store. Bridges the game engine (pure logic) and the UI (React).
 *
 * Three layers:
 *   Engine (logic) → Store (state + actions) → UI (display)
 *
 * The engine never imports from UI.
 * The UI never contains game logic.
 * The store is the only connection point.
 */

import { create } from 'zustand'
import {
  GameState,
  Season,
  Origin,
  StartingCapital,
  CropType,
  LaborType,
  WorkerSkill,
  WorkerTask,
  HealthLevel,
  CabinCondition,
  TerrainType,
  Transaction,
  FamilyMember,
  FamilyMemberRole,
} from '@engine/types'
import { resolveSeasonEnd } from '@engine/season'
import { recordTransaction } from '@engine/transactions'
import {
  STORAGE_CAPACITY_SMOKEHOUSE,
  STORAGE_CAPACITY_STOREHOUSE,
  SMOKEHOUSE_BUILD_COST_MIN,
  CABIN_BUILD_COST_MIN,
  LAND_PARCEL_COST,
  WATER_ADJACENT_PRICE_PREMIUM,
  LABOR_ACQUISITION_COST,
  LABOR_SEASONAL_COST,
  STARTING_SOIL_BY_TERRAIN,
  LAND_CLEARING_COST,
  MANURE_APPLICATION_BOOST,
  SEED_PURCHASE_COST,
  COMPOST_FACILITY_COST,
  COVER_CROP_SEED_STOCK_COST,
  FACTOR_ADVANCE_RATE,
  CROP_BASE_YIELD_PER_TILE,
} from '@engine/constants'

// ---------------------------------------------------------------------------
// SEASON PLAN
// Labor allocation the player sets before ending a season.
// Keys are task identifiers; values are worker counts allocated.
// ---------------------------------------------------------------------------

export interface SeasonPlan {
  tileAllocations: Record<string, TileAction>
  cabinRepairWorkers: number
  storageWorkers: number
  compostWorkers: number
  // Family member task assignments — keyed by family member id
  familyAssignments: Record<string, WorkerTask | null>
}

export type TileAction =
  | { type: 'Clear';      workers: number }
  | { type: 'Plant';      workers: number; crop: CropType }
  | { type: 'Tend';       workers: number }
  | { type: 'Harvest';    workers: number }
  | { type: 'ClearField'; workers: number }
  | { type: 'Idle' }

// ---------------------------------------------------------------------------
// STORE SHAPE
// ---------------------------------------------------------------------------

interface GameStore {
  gameState:            GameState | null
  isPlaying:            boolean
  activePanel:          'map' | 'roster' | 'ledger' | 'market' | 'trophies' | 'debug'
  showingSeasonSummary: boolean
  showingSeasonPlanner: boolean
  lastSeasonEvents:     GameState['eventLog']
  seasonPlan:           SeasonPlan

  // Core game actions
  startNewGame:           (params: NewGameParams) => void
  advanceSeason:          () => void
  dismissSeasonSummary:   () => void
  setActivePanel:         (panel: GameStore['activePanel']) => void
  saveGame:               () => void
  loadGame:               () => boolean
  resetGame:              () => void

  // Season planning actions
  openSeasonPlanner:      () => void
  closeSeasonPlanner:     () => void
  setTileAction:          (tileId: string, action: TileAction) => void
  setCabinRepairWorkers:  (count: number) => void
  setStorageWorkers:      (count: number) => void
  setCompostWorkers:      (count: number) => void
  setFamilyTask:          (memberId: string, task: WorkerTask | null) => void
  confirmPlanAndAdvance:  () => void

  // Supply and build actions
  buySupplies:            (corn: number, blankets: number) => void
  buildSmokehouse:        () => void
  queueSale:              (crop: CropType, quantity: number, minPrice: number | null) => void
  cancelSale:             (saleId: string) => void
  updateSaleQuantity:     (saleId: string, newQuantity: number) => void
  repayDebt:              (amount: number) => void
  requestFactorAdvance:   () => void

  // Land and labor acquisition
  buyLandParcel:          (terrain: TerrainType, isWaterAdjacent: boolean) => void
  hireWorker:             (laborType: LaborType) => void

  // Soil management
  compostTile:            (tileId: string) => void

  // Seeds and infrastructure
  buySeeds:               (crop: CropType) => void
  buildCompostFacility:   () => void
  buyCoverCropSeedStock:  () => void
  buildNewCabin:          () => void

  // Field management
  clearTileField:         (tileId: string) => void

  // Labor release
  releaseWorker:          (workerId: string) => void
}

interface NewGameParams {
  playerName:      string
  origin:          Origin
  startingCapital: StartingCapital
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function emptySeasonPlan(): SeasonPlan {
  return { tileAllocations: {}, cabinRepairWorkers: 0, storageWorkers: 0, compostWorkers: 0, familyAssignments: {} }
}

export function countAllocatedWorkers(plan: SeasonPlan): number {
  const tileTotal = Object.values(plan.tileAllocations).reduce((sum, action) => {
    if (action.type === 'Idle') return sum
    return sum + action.workers
  }, 0)
  return tileTotal + plan.cabinRepairWorkers + plan.storageWorkers + plan.compostWorkers
}

/**
 * Applies the season plan to worker assignments in the game state.
 * Returns updated workers with assignedTask set.
 */
function applyPlanToWorkers(state: GameState, plan: SeasonPlan): GameState['workers'] {
  // Build a flat list of assignments: [workerId, task]
  // We assign workers in order from the roster — the engine handles
  // individual productivity from there.
  const assignments: Array<GameState['workers'][0]['assignedTask']> = []

  // Tile assignments
  for (const [tileId, action] of Object.entries(plan.tileAllocations)) {
    if (action.type === 'Idle') continue
    for (let i = 0; i < action.workers; i++) {
      if (action.type === 'Clear')   assignments.push({ type: 'ClearLand',   tileId })
      if (action.type === 'Plant')   assignments.push({ type: 'PlantCrop',   tileId, crop: action.crop })
      if (action.type === 'Tend')    assignments.push({ type: 'TendCrop',    tileId })
      if (action.type === 'Harvest') assignments.push({ type: 'HarvestCrop', tileId })
    }
  }

  // Cabin repair
  // Distribute repair workers across all cabins evenly.
  // Each cabin gets at least one worker if enough are assigned.
  // Any remaining workers go to the first cabin.
  const cabinIds = state.cabins.map(c => c.id)
  for (let i = 0; i < plan.cabinRepairWorkers; i++) {
    const cabinId = cabinIds[i % cabinIds.length] ?? 'cabin-1'
    assignments.push({ type: 'RepairCabin', cabinId })
  }

  // Storage management
  for (let i = 0; i < plan.storageWorkers; i++) {
    assignments.push({ type: 'ManageStorage' })
  }

  // Compost tending — dedicated task type, distinct from storage management
  for (let i = 0; i < plan.compostWorkers; i++) {
    assignments.push({ type: 'TendCompost' })
  }

  // Assign workers in roster order; remaining workers rest
  return state.workers.map((worker, index) => ({
    ...worker,
    assignedTask: index < assignments.length ? assignments[index] : { type: 'Rest' as const },
  }))
}

/**
 * Applies crop planting from the plan to tiles.
 * Tiles with a Plant action get their currentCrop set.
 */
function applyFamilyPlan(state: GameState, plan: SeasonPlan): GameState['family'] {
  return (state.family ?? []).map(member => {
    const task = plan.familyAssignments[member.id] ?? null
    return { ...member, assignedTask: task as FamilyMember['assignedTask'] }
  })
}

function applyPlanToTiles(state: GameState, plan: SeasonPlan): GameState['tiles'] {
  return state.tiles.map(tile => {
    const action = plan.tileAllocations[tile.id]
    if (!action || action.type !== 'Plant') return tile
    return { ...tile, currentCrop: action.crop, seasonsInGround: 0 }
  })
}

// ---------------------------------------------------------------------------
// STORE IMPLEMENTATION
// ---------------------------------------------------------------------------

export const useGameStore = create<GameStore>((set, get) => ({
  gameState:            null,
  isPlaying:            false,
  activePanel:          'map',
  showingSeasonSummary: false,
  showingSeasonPlanner: false,
  lastSeasonEvents:     [],
  seasonPlan:           emptySeasonPlan(),

  // ── Start a new game ─────────────────────────────────────────────────────
  startNewGame: (params) => {
    const initialState = buildInitialGameState(params)
    set({
      gameState:            initialState,
      isPlaying:            true,
      activePanel:          'map',
      showingSeasonSummary: false,
      showingSeasonPlanner: false,
      lastSeasonEvents:     [],
      seasonPlan:           emptySeasonPlan(),
    })
    saveToLocalStorage(initialState)
  },

  // ── Season planner ────────────────────────────────────────────────────────
  openSeasonPlanner: () => set({ showingSeasonPlanner: true }),
  closeSeasonPlanner: () => set({ showingSeasonPlanner: false }),

  setTileAction: (tileId, action) => set(s => ({
    seasonPlan: {
      ...s.seasonPlan,
      tileAllocations: { ...s.seasonPlan.tileAllocations, [tileId]: action },
    }
  })),

  setCabinRepairWorkers: (count) => set(s => ({
    seasonPlan: { ...s.seasonPlan, cabinRepairWorkers: count }
  })),

  setStorageWorkers: (count) => set(s => ({
    seasonPlan: { ...s.seasonPlan, storageWorkers: count }
  })),

  setCompostWorkers: (count) => set(s => ({
    seasonPlan: { ...s.seasonPlan, compostWorkers: count }
  })),

  setFamilyTask: (memberId, task) => set(s => ({
    seasonPlan: {
      ...s.seasonPlan,
      familyAssignments: {
        ...s.seasonPlan.familyAssignments,
        [memberId]: task,
      }
    }
  })),

  // ── Confirm plan and advance season ──────────────────────────────────────
  confirmPlanAndAdvance: () => {
    const { gameState, seasonPlan } = get()
    if (!gameState) return

    // Apply plan to workers, tiles, and family before resolving the season
    const withAssignments: GameState = {
      ...gameState,
      workers: applyPlanToWorkers(gameState, seasonPlan),
      tiles:   applyPlanToTiles(gameState, seasonPlan),
      family:  applyFamilyPlan(gameState, seasonPlan),
    }

    const eventCountBefore = withAssignments.eventLog.length
    const nextState        = resolveSeasonEnd(withAssignments)
    const newEvents        = nextState.eventLog.slice(eventCountBefore)

    set({
      gameState:            nextState,
      showingSeasonPlanner: false,
      showingSeasonSummary: true,
      lastSeasonEvents:     newEvents,
      seasonPlan: {
        ...emptySeasonPlan(),
        // Carry forward family task assignments so the owner doesn't reset
        // to Rest every season — player only needs to change if they want to
        familyAssignments: Object.fromEntries(
          (nextState.family ?? []).map(m => [m.id, m.assignedTask])
        ),
      },
    })
    saveToLocalStorage(nextState)
  },

  // ── Legacy advance (kept for TopBar button — opens planner instead) ───────
  advanceSeason: () => {
    set({ showingSeasonPlanner: true })
  },

  // ── Buy supplies ──────────────────────────────────────────────────────────
  buySupplies: (corn, blankets) => {
    const { gameState } = get()
    if (!gameState) return

    // Corn costs $2/unit, blankets $3 each (approximate period prices)
    const cornCost    = corn * 2
    const blanketCost = blankets * 3
    const totalCost   = cornCost + blanketCost

    if (totalCost === 0) return  // nothing to buy
    if (gameState.finances.cashOnHand < totalCost) return  // can't afford

    const newCash = gameState.finances.cashOnHand - totalCost
    const parts: string[] = []
    if (corn > 0)     parts.push(`${corn} corn`)
    if (blankets > 0) parts.push(`${blankets} blanket${blankets !== 1 ? 's' : ''}`)

    const updated: GameState = {
      ...gameState,
      blanketsOnHand: gameState.blanketsOnHand + blankets,
      cornOnHand:     gameState.cornOnHand + corn,
      finances: {
        ...gameState.finances,
        cashOnHand: newCash,
      },
      transactionLog: [...gameState.transactionLog, recordTransaction({
        description:   `Bought supplies: ${parts.join(', ')}`,
        amount:        -totalCost,
        newCashOnHand: newCash,
        season:        gameState.currentSeason,
        year:          gameState.currentYear,
      })],
    }
    set({ gameState: updated })
    saveToLocalStorage(updated)
  },

  // ── Build smokehouse ──────────────────────────────────────────────────────
  buildSmokehouse: () => {
    // Smokehouse is now a starting item. This action upgrades to a full storehouse.
    const { gameState } = get()
    if (!gameState) return
    if (gameState.storage.capacity >= STORAGE_CAPACITY_STOREHOUSE) return // already upgraded
    if (gameState.finances.cashOnHand < SMOKEHOUSE_BUILD_COST_MIN) return

    const newCash = gameState.finances.cashOnHand - SMOKEHOUSE_BUILD_COST_MIN

    const updated: GameState = {
      ...gameState,
      storage: { ...gameState.storage, capacity: STORAGE_CAPACITY_STOREHOUSE },
      finances: {
        ...gameState.finances,
        cashOnHand: newCash,
      },
      transactionLog: [...gameState.transactionLog, recordTransaction({
        description:   'Built storehouse (expanded storage capacity)',
        amount:        -SMOKEHOUSE_BUILD_COST_MIN,
        newCashOnHand: newCash,
        season:        gameState.currentSeason,
        year:          gameState.currentYear,
      })],
    }
    set({ gameState: updated })
    saveToLocalStorage(updated)
  },

  // ── Queue a sale ──────────────────────────────────────────────────────────
  queueSale: (crop, quantity, minPrice) => {
    const { gameState } = get()
    if (!gameState) return

    const available = gameState.storage.inventory[crop] ?? 0
    if (available < quantity) return

    const sale = {
      id:             Math.random().toString(36).slice(2, 10),
      crop,
      quantity,
      minPriceFloor:  minPrice,
      queuedOnSeason: gameState.currentSeason,
      queuedOnYear:   gameState.currentYear,
    }

    const updated: GameState = {
      ...gameState,
      finances: {
        ...gameState.finances,
        queuedSales: [...gameState.finances.queuedSales, sale],
      },
    }
    set({ gameState: updated })
    saveToLocalStorage(updated)
  },

  // ── Cancel a queued sale ─────────────────────────────────────────────────
  cancelSale: (saleId) => {
    const { gameState } = get()
    if (!gameState) return
    const updated: GameState = {
      ...gameState,
      finances: {
        ...gameState.finances,
        queuedSales: gameState.finances.queuedSales.filter(s => s.id !== saleId),
      },
    }
    set({ gameState: updated })
    saveToLocalStorage(updated)
  },

  // ── Update a queued sale quantity ─────────────────────────────────────────
  updateSaleQuantity: (saleId, newQuantity) => {
    const { gameState } = get()
    if (!gameState) return
    if (newQuantity <= 0) {
      // Treat zero quantity as a cancel
      const updated: GameState = {
        ...gameState,
        finances: {
          ...gameState.finances,
          queuedSales: gameState.finances.queuedSales.filter(s => s.id !== saleId),
        },
      }
      set({ gameState: updated })
      saveToLocalStorage(updated)
      return
    }
    const updated: GameState = {
      ...gameState,
      finances: {
        ...gameState.finances,
        queuedSales: gameState.finances.queuedSales.map(s =>
          s.id === saleId ? { ...s, quantity: newQuantity } : s
        ),
      },
    }
    set({ gameState: updated })
    saveToLocalStorage(updated)
  },

  // ── Buy a new land parcel ──────────────────────────────────────────────────
  buyLandParcel: (terrain, isWaterAdjacent) => {
    const { gameState } = get()
    if (!gameState) return

    const baseCost  = LAND_PARCEL_COST[terrain]
    const totalCost = baseCost + (isWaterAdjacent ? WATER_ADJACENT_PRICE_PREMIUM : 0)
    if (gameState.finances.cashOnHand < totalCost) return

    const soilStart = STARTING_SOIL_BY_TERRAIN[terrain]
    const newTile = {
      id:                        `tile-${String(gameState.tiles.length + 1).padStart(3, '0')}`,
      terrain,
      isCleared:                 false,
      isWaterAdjacent,
      soil:                      { ...soilStart },
      currentCrop:               null as CropType | null,
      seasonsInGround:           0,
      hasStumpRot:               false,
      stumpRotSeasonsLeft:       0,
      clearingProgressRemaining: LAND_CLEARING_COST[terrain],
      history: [],
    }

    const newCash = gameState.finances.cashOnHand - totalCost

    const updated: GameState = {
      ...gameState,
      tiles: [...gameState.tiles, newTile],
      finances: { ...gameState.finances, cashOnHand: newCash },
      transactionLog: [...gameState.transactionLog, recordTransaction({
        description:   `Bought ${terrain.toLowerCase()} parcel${isWaterAdjacent ? ' (water-adjacent)' : ''}`,
        amount:        -totalCost,
        newCashOnHand: newCash,
        season:        gameState.currentSeason,
        year:          gameState.currentYear,
      })],
    }
    set({ gameState: updated })
    saveToLocalStorage(updated)
  },

  // ── Hire a new worker ──────────────────────────────────────────────────────
  hireWorker: (laborType) => {
    const { gameState } = get()
    if (!gameState) return

    const acquisitionCost = LABOR_ACQUISITION_COST[laborType].min
    if (acquisitionCost > 0 && gameState.finances.cashOnHand < acquisitionCost) return

    const totalCapacity = gameState.cabins.reduce((sum, c) => sum + c.capacity, 0)
    if (gameState.workers.length >= totalCapacity) return  // no cabin space

    // Pick a name not already on the roster; fall back to any name if pool exhausted
    const usedNames = new Set(gameState.workers.map(w => w.name))
    const availableNames = WORKER_NAMES.filter(n => !usedNames.has(n))
    const namePool = availableNames.length > 0 ? availableNames : WORKER_NAMES
    const name = namePool[Math.floor(Math.random() * namePool.length)]
    const newWorker = {
      id:                       `worker-${gameState.workers.length + 1}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      age:                      Math.floor(Math.random() * 25) + 18,
      laborType,
      skill:                    WorkerSkill.Field,
      health:                   HealthLevel.Healthy,
      assignedTask:             null,
      individualScore:          75,
      contractSeasonsRemaining: (laborType === LaborType.IndenturedBlack || laborType === LaborType.IndenturedWhite)
        ? (4 + Math.floor(Math.random() * 4)) * 4  // 4-7 years, in seasons
        : null,
      wagePerSeason: laborType === LaborType.FreeWage
        ? LABOR_SEASONAL_COST[LaborType.FreeWage].min
        : null,
    }

    const updatedCabins = gameState.cabins.map(c => ({ ...c, occupants: [...c.occupants] }))
    for (const cabin of updatedCabins) {
      if (cabin.occupants.length < cabin.capacity) {
        cabin.occupants.push(newWorker.id)
        break
      }
    }

    const newCash = gameState.finances.cashOnHand - acquisitionCost
    const seasonalCost = LABOR_SEASONAL_COST[laborType].min

    const updated: GameState = {
      ...gameState,
      workers: [...gameState.workers, newWorker],
      cabins:  updatedCabins,
      finances: { ...gameState.finances, cashOnHand: newCash },
      transactionLog: [...gameState.transactionLog, recordTransaction({
        description:   acquisitionCost > 0
          ? `Hired ${name} (${HIRE_LABOR_SHORT_LABELS[laborType]}) — ~$${seasonalCost}/season upkeep`
          : `Hired ${name} (${HIRE_LABOR_SHORT_LABELS[laborType]}) — no purchase cost, ~$${seasonalCost}/season`,
        amount:        -acquisitionCost,
        newCashOnHand: newCash,
        season:        gameState.currentSeason,
        year:          gameState.currentYear,
      })],
    }
    set({ gameState: updated })
    saveToLocalStorage(updated)
  },

  // ── Compost cleared material onto a tile ────────────────────────────────
  compostTile: (tileId) => {
    const { gameState } = get()
    if (!gameState) return
    if (!gameState.compostFacilityBuilt) return      // facility required
    if (gameState.clearedMaterialOnHand < 1) return

    const tile = gameState.tiles.find(t => t.id === tileId)
    if (!tile || !tile.isCleared) return

    const updatedTiles = gameState.tiles.map(t => {
      if (t.id !== tileId) return t
      return {
        ...t,
        soil: {
          organicMatter:     Math.min(100, t.soil.organicMatter + MANURE_APPLICATION_BOOST.organicMatter),
          nitrogen:          Math.min(100, t.soil.nitrogen + MANURE_APPLICATION_BOOST.nitrogen),
          soilFauna:         Math.min(100, t.soil.soilFauna + MANURE_APPLICATION_BOOST.soilFauna),
          moistureRetention: Math.min(100, t.soil.moistureRetention + MANURE_APPLICATION_BOOST.moistureRetention),
        },
      }
    })

    const updated: GameState = {
      ...gameState,
      tiles: updatedTiles,
      clearedMaterialOnHand: gameState.clearedMaterialOnHand - 1,
    }
    set({ gameState: updated })
    saveToLocalStorage(updated)
  },

  // ── Buy seeds for a crop ──────────────────────────────────────────────────
  buySeeds: (crop) => {
    const { gameState } = get()
    if (!gameState) return
    const cost = SEED_PURCHASE_COST[crop] ?? 0
    if (cost > 0 && gameState.finances.cashOnHand < cost) return

    const newCash = gameState.finances.cashOnHand - cost
    const updated: GameState = {
      ...gameState,
      seedInventory: { ...gameState.seedInventory, [crop]: 1 },
      finances: { ...gameState.finances, cashOnHand: newCash },
      transactionLog: cost > 0 ? [...gameState.transactionLog, recordTransaction({
        description:   `Bought ${crop} seed stock`,
        amount:        -cost,
        newCashOnHand: newCash,
        season:        gameState.currentSeason,
        year:          gameState.currentYear,
      })] : gameState.transactionLog,
    }
    set({ gameState: updated })
    saveToLocalStorage(updated)
  },

  // ── Build compost facility ────────────────────────────────────────────────
  buildCompostFacility: () => {
    const { gameState } = get()
    if (!gameState) return
    if (gameState.compostFacilityBuilt) return
    if (gameState.finances.cashOnHand < COMPOST_FACILITY_COST) return

    const newCash = gameState.finances.cashOnHand - COMPOST_FACILITY_COST
    const updated: GameState = {
      ...gameState,
      compostFacilityBuilt: true,
      finances: { ...gameState.finances, cashOnHand: newCash },
      transactionLog: [...gameState.transactionLog, recordTransaction({
        description:   'Built compost facility',
        amount:        -COMPOST_FACILITY_COST,
        newCashOnHand: newCash,
        season:        gameState.currentSeason,
        year:          gameState.currentYear,
      })],
    }
    set({ gameState: updated })
    saveToLocalStorage(updated)
  },

  // ── Buy cover crop seed stock ─────────────────────────────────────────────
  buyCoverCropSeedStock: () => {
    const { gameState } = get()
    if (!gameState) return
    if (gameState.coverCropSeedStockOwned) return
    if (gameState.finances.cashOnHand < COVER_CROP_SEED_STOCK_COST) return

    const newCash = gameState.finances.cashOnHand - COVER_CROP_SEED_STOCK_COST
    const updated: GameState = {
      ...gameState,
      coverCropSeedStockOwned: true,
      seedInventory: { ...gameState.seedInventory, [CropType.CoverCrop]: 1 },
      finances: { ...gameState.finances, cashOnHand: newCash },
      transactionLog: [...gameState.transactionLog, recordTransaction({
        description:   'Bought cover crop seed stock (permanent unlock)',
        amount:        -COVER_CROP_SEED_STOCK_COST,
        newCashOnHand: newCash,
        season:        gameState.currentSeason,
        year:          gameState.currentYear,
      })],
    }
    set({ gameState: updated })
    saveToLocalStorage(updated)
  },

  // ── Manual debt repayment ─────────────────────────────────────────────────
  repayDebt: (amount) => {
    const { gameState } = get()
    if (!gameState) return
    const available = Math.min(amount, gameState.finances.cashOnHand)
    if (available <= 0) return

    let remaining = available
    let newFactorDebt = gameState.finances.factorAdvanceDebt
    let newNoteDebt   = gameState.finances.personalNoteDebt

    // Waterfall: factor advance first, then personal note
    if (newFactorDebt > 0) {
      const payment = Math.min(remaining, newFactorDebt)
      newFactorDebt -= payment
      remaining     -= payment
    }
    if (remaining > 0 && newNoteDebt > 0) {
      const payment = Math.min(remaining, newNoteDebt)
      newNoteDebt -= payment
      remaining   -= payment
    }

    const paid = available - remaining
    if (paid <= 0) return

    const newCash = gameState.finances.cashOnHand - paid
    const updated: GameState = {
      ...gameState,
      finances: {
        ...gameState.finances,
        cashOnHand:        newCash,
        factorAdvanceDebt: newFactorDebt,
        personalNoteDebt:  newNoteDebt,
      },
      transactionLog: [...gameState.transactionLog, recordTransaction({
        description:   'Manual debt repayment: $' + paid.toFixed(2) + ' applied to principal',
        amount:        -paid,
        newCashOnHand: newCash,
        season:        gameState.currentSeason,
        year:          gameState.currentYear,
      })],
    }
    set({ gameState: updated })
    saveToLocalStorage(updated)
  },

  // ── Request in-game factor advance ────────────────────────────────────────
  requestFactorAdvance: () => {
    const { gameState } = get()
    if (!gameState) return

    const clearedCount = gameState.tiles.filter(t => t.isCleared).length
    const advance = computeFactorAdvance(clearedCount)
    if (advance <= 0) return

    const newCash = gameState.finances.cashOnHand + advance
    const newFactorDebt = (gameState.finances.factorAdvanceDebt ?? 0) + advance
    const updated: GameState = {
      ...gameState,
      finances: {
        ...gameState.finances,
        cashOnHand:        newCash,
        factorAdvanceDebt: newFactorDebt,
      },
      transactionLog: [...gameState.transactionLog, recordTransaction({
        description:   'Factor advance received: $' + advance.toFixed(0) + ' against estimated harvest',
        amount:        advance,
        newCashOnHand: newCash,
        season:        gameState.currentSeason,
        year:          gameState.currentYear,
      })],
    }
    set({ gameState: updated })
    saveToLocalStorage(updated)
  },

  // ── Build a new cabin ─────────────────────────────────────────────────────
  buildNewCabin: () => {
    const { gameState } = get()
    if (!gameState) return
    if (gameState.finances.cashOnHand < CABIN_BUILD_COST_MIN) return

    const newId   = `cabin-${Date.now()}`
    const newCash = gameState.finances.cashOnHand - CABIN_BUILD_COST_MIN
    const newCabin = {
      id:       newId,
      condition: CabinCondition.Good,
      capacity:  4 as const,
      occupants: [] as string[],
      receivedMaintenanceThisSeason: false,
    }

    const updated: GameState = {
      ...gameState,
      cabins:   [...gameState.cabins, newCabin],
      finances: { ...gameState.finances, cashOnHand: newCash },
      transactionLog: [...gameState.transactionLog, recordTransaction({
        description:   `Built new cabin (+4 capacity)`,
        amount:        -CABIN_BUILD_COST_MIN,
        newCashOnHand: newCash,
        season:        gameState.currentSeason,
        year:          gameState.currentYear,
      })],
    }
    set({ gameState: updated })
    saveToLocalStorage(updated)
  },

  // ── Clear a tile's crop without harvesting ────────────────────────────────
  clearTileField: (tileId) => {
    const { gameState } = get()
    if (!gameState) return
    const updated: GameState = {
      ...gameState,
      tiles: gameState.tiles.map(t =>
        t.id === tileId ? { ...t, currentCrop: null } : t
      ),
    }
    set({ gameState: updated })
    saveToLocalStorage(updated)
  },

  releaseWorker: (workerId) => {
    const { gameState } = get()
    if (!gameState) return

    const worker = gameState.workers.find(w => w.id === workerId)
    if (!worker) return

    let cashDelta = 0
    let description = ''

    switch (worker.laborType) {
      case LaborType.EnslavedPurchased:
        // Sold back at a loss — half the liquidation value used in
        // foreclosure assessment, reflecting a forced/quick sale.
        cashDelta = 150  // ~50% of $300 purchase price floor in a forced sale
        description = `Sold ${worker.name} (Enslaved, Purchased) — recovered $${cashDelta} at a loss`
        break

      case LaborType.EnslavedHiredOut:
        // Rental simply ends — no transaction, seasonal cost just stops.
        cashDelta = 0
        description = `Ended hire-out arrangement for ${worker.name} (Enslaved, Hired-Out)`
        break

      case LaborType.IndenturedBlack:
      case LaborType.IndenturedWhite: {
        // Releasing before the contract term ends triggers a dispute
        // penalty — the planter forfeits part of the original contract
        // fee as a small cash cost.
        const earlyRelease = (worker.contractSeasonsRemaining ?? 0) > 0
        if (earlyRelease) {
          cashDelta = -50
          description = `Released ${worker.name} (Indentured) early — contract dispute cost $${Math.abs(cashDelta)}`
        } else {
          cashDelta = 0
          description = `${worker.name}'s indenture contract has ended`
        }
        break
      }

      case LaborType.FreeWage:
        // Employment simply ends — no transaction, seasonal wage stops.
        cashDelta = 0
        description = `Ended employment for ${worker.name} (Free Wage)`
        break
    }

    if (cashDelta < 0 && gameState.finances.cashOnHand < Math.abs(cashDelta)) return  // can't afford the dispute cost

    const newCash = gameState.finances.cashOnHand + cashDelta

    // Remove worker from roster and any cabin occupancy
    const updatedCabins = gameState.cabins.map(c => ({
      ...c,
      occupants: c.occupants.filter(id => id !== workerId),
    }))

    const updated: GameState = {
      ...gameState,
      workers: gameState.workers.filter(w => w.id !== workerId),
      cabins:  updatedCabins,
      finances: { ...gameState.finances, cashOnHand: newCash },
      transactionLog: cashDelta !== 0
        ? [...gameState.transactionLog, recordTransaction({
            description,
            amount:        cashDelta,
            newCashOnHand: newCash,
            season:        gameState.currentSeason,
            year:          gameState.currentYear,
          })]
        : gameState.transactionLog,
    }
    set({ gameState: updated })
    saveToLocalStorage(updated)
  },

  dismissSeasonSummary: () => set({ showingSeasonSummary: false }),

  setActivePanel: (panel) => set({ activePanel: panel }),

  // ── Save/load/reset ───────────────────────────────────────────────────────
  saveGame: () => {
    const { gameState } = get()
    if (gameState) saveToLocalStorage(gameState)
  },

  loadGame: () => {
    const saved = loadFromLocalStorage()
    if (!saved) return false
    set({ gameState: saved, isPlaying: true })
    return true
  },

  resetGame: () => {
    localStorage.removeItem(SAVE_KEY)
    set({ gameState: null, isPlaying: false, activePanel: 'map', seasonPlan: emptySeasonPlan() })
  },
}))

// ---------------------------------------------------------------------------
// LOCAL STORAGE
// ---------------------------------------------------------------------------

const SAVE_KEY = 'antebellum-save-v1'

function saveToLocalStorage(state: GameState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state))
  } catch (e) {
    console.warn('Could not save game:', e)
  }
}

function loadFromLocalStorage(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as GameState
  } catch (e) {
    console.warn('Could not load save:', e)
    return null
  }
}

// ---------------------------------------------------------------------------
// INITIAL STATE BUILDER
// ---------------------------------------------------------------------------

function buildInitialGameState(params: NewGameParams): GameState {
  const { playerName, origin, startingCapital } = params
  const now = new Date().toISOString()

  const grantTile = buildGrantTile(origin)
  const cabin1    = buildCabin('cabin-1')
  const cabin2    = buildCabin('cabin-2')
  const usedStartingNames = new Set<string>()
  const worker1   = buildStartingWorker('worker-1', usedStartingNames)
  usedStartingNames.add(worker1.name)
  const worker2   = buildStartingWorker('worker-2', usedStartingNames)

  cabin1.occupants = [worker1.id]
  cabin2.occupants = [worker2.id]

  // Count cleared starting tiles to size the factor advance correctly.
  // All starting tiles are pre-cleared upland; uncleared tiles need labour first.
  const clearedStartingTiles = [grantTile].filter(t => t.isCleared).length
  const { cashOnHand, factorAdvance, personalNote } = getStartingFinances(startingCapital, clearedStartingTiles)

  return {
    version:         typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.5.0',
    createdAt:       now,
    lastSavedAt:     now,
    playerName,
    origin,
    startingCapital,
    currentYear:     1,
    currentSeason:   Season.Spring,
    tiles:           [grantTile],
    workers:         [worker1, worker2],
    cabins:          [cabin1, cabin2],
    family:          [buildOwner(playerName)],
    blanketsOnHand:  4,
    cornOnHand:      8,
    clearedMaterialOnHand: 0,
    seedInventory:   {},
    ownerHouseLevel:         0,
    compostFacilityBuilt:    false,
    coverCropSeedStockOwned: false,
    conditionsIndex: 75,
    enslavedUsedThisYear: false,
    yearlyRevenue: 0,
    storage: {
      capacity:             STORAGE_CAPACITY_SMOKEHOUSE,  // basic smokehouse present from game start
      inventory:            {},
      seasonsStored:        {},
      hasCooperAssigned:    false,
      hasCarpenterAssigned: false,
    },
    market: {
      prices: {
        [CropType.Tobacco]:     12,
        [CropType.Rice]:        10,
        [CropType.Indigo]:      7,
        [CropType.Corn]:        2,
      },
      priceHistory: [],
    },
    finances: {
      // Borrowed amounts (factor advance, personal note) are cash the
      // player receives AND debt they owe — both sides of the loan
      // must be recorded. Previously only the debt side was tracked,
      // leaving the player with a liability but no corresponding asset.
      cashOnHand: cashOnHand + factorAdvance + personalNote,
      factorAdvanceDebt: factorAdvance,
      mortgageDebt:      0,
      personalNoteDebt:  personalNote,
      factor: {
        id:                 'factor-1',
        name:               'Thomas Heyward & Co.',
        city:               'Charleston',
        relationshipScore:  50,
        advanceOutstanding: factorAdvance,
        creditLimit:        800,
      },
      queuedSales: [],
    },
    useSimplifiedSoilModel: true,
    eventLog:  [],
    trophies:  [],
    transactionLog: buildStartingTransactions(startingCapital, cashOnHand, factorAdvance, personalNote),
    debugLog:  [],
  }
}

/**
 * Builds the initial transaction log entries showing the player's
 * starting financial position — own cash plus any borrowed amount,
 * with the loan obligation noted separately.
 */
function buildStartingTransactions(
  capital: StartingCapital,
  ownCash: number,
  factorAdvance: number,
  personalNote: number
): Transaction[] {
  const transactions: Transaction[] = []
  let running = 0

  running += ownCash
  transactions.push(recordTransaction({
    description:   `Starting capital (${capital})`,
    amount:        ownCash,
    newCashOnHand: running,
    season:        Season.Spring,
    year:          1,
  }))

  if (factorAdvance > 0) {
    running += factorAdvance
    transactions.push(recordTransaction({
      description:   `Factor advance received — $${factorAdvance} owed back with interest`,
      amount:        factorAdvance,
      newCashOnHand: running,
      season:        Season.Spring,
      year:          1,
    }))
  }

  if (personalNote > 0) {
    running += personalNote
    transactions.push(recordTransaction({
      description:   `Personal note received — $${personalNote} owed back with interest`,
      amount:        personalNote,
      newCashOnHand: running,
      season:        Season.Spring,
      year:          1,
    }))
  }

  return transactions
}


function buildGrantTile(origin: Origin) {
  const configs: Record<Origin, { isCleared: boolean; terrain: TerrainType }> = {
    [Origin.VeteranWarrant]:        { isCleared: false, terrain: TerrainType.Forest },
    [Origin.PlanterSon]:            { isCleared: true,  terrain: TerrainType.Upland },
    [Origin.LotteryWinner]:         { isCleared: false, terrain: TerrainType.Forest },
    [Origin.ImmigrantEntrepreneur]: { isCleared: false, terrain: TerrainType.Upland },
  }
  const config = configs[origin]
  return {
    id:                        'tile-001',
    terrain:                   config.terrain,
    isCleared:                 config.isCleared,
    isWaterAdjacent:           false,
    soil: {
      organicMatter:     config.terrain === TerrainType.Forest ? 70 : 60,
      nitrogen:          45,
      soilFauna:         config.terrain === TerrainType.Forest ? 75 : 65,
      moistureRetention: 55,
    },
    currentCrop:               null,
    seasonsInGround:           0,
    hasStumpRot:               false,
    stumpRotSeasonsLeft:       0,
    clearingProgressRemaining: config.isCleared ? 0 : LAND_CLEARING_COST[config.terrain],
    history: [],
  }
}

function buildOwner(name: string): FamilyMember {
  return {
    id:           'owner',
    name,
    role:         FamilyMemberRole.Owner,
    age:          null,
    laborUnits:   1,
    assignedTask: null,
  }
}

function buildCabin(id: string) {
  return {
    id,
    condition:  CabinCondition.Good,  // freshly built — new plantation, new construction
    capacity:   4 as const,
    occupants:  [] as string[],
    receivedMaintenanceThisSeason: false,
  }
}

// Historically grounded 17th-century Carolina names.
// Drawn from colonial records, court documents, and plantation inventories
// of the period. Intentionally varied — enslaved, indentured, and free
// workers are all drawn from the same pool; the labor type record carries
// the legal distinction, not the name.
// "Toby" excluded deliberately.
const WORKER_NAMES = [
  // Enslaved and free Black names documented in colonial Carolina records
  'Solomon', 'Phoebe', 'Caesar', 'Dinah', 'Elias', 'Ruth', 'Cuffee', 'Flora',
  'Mingo', 'Bess', 'Quash', 'Nanny', 'Prince', 'Violet', 'London', 'Grace',
  'Sampson', 'Venus', 'Scipio', 'Dorcas', 'Nero', 'Hagar', 'Pompey', 'Sukey',
  'Bristol', 'Phillis', 'July', 'Jenny', 'Cudjoe', 'Sybil',
  // White indentured and free wage names from the same period
  'Thomas', 'Hannah', 'William', 'Mary', 'James', 'Elizabeth', 'John', 'Sarah',
  'Robert', 'Margaret', 'Edward', 'Anne', 'Henry', 'Alice', 'Richard', 'Jane',
  'Patrick', 'Bridget', 'Michael', 'Catherine', 'Cornelius', 'Agnes',
  'Heinrich', 'Greta', 'Pieter', 'Annetje',
]

// Short labels used in transaction log descriptions (hire/release).
// Full descriptive labels for the planner UI live in SeasonPlanner.tsx.
const HIRE_LABOR_SHORT_LABELS: Record<LaborType, string> = {
  [LaborType.EnslavedPurchased]: 'Enslaved, Purchased',
  [LaborType.EnslavedHiredOut]:  'Enslaved, Hired-Out',
  [LaborType.IndenturedBlack]:   'Indentured, Black',
  [LaborType.IndenturedWhite]:   'Indentured, White',
  [LaborType.FreeWage]:          'Free Wage',
}

function buildStartingWorker(id: string, usedNames: Set<string> = new Set()) {
  const availableNames = WORKER_NAMES.filter(n => !usedNames.has(n))
  const namePool = availableNames.length > 0 ? availableNames : WORKER_NAMES
  const name = namePool[Math.floor(Math.random() * namePool.length)]
  return {
    id,
    name,
    age:                      Math.floor(Math.random() * 20) + 20,
    laborType:                LaborType.EnslavedHiredOut,
    skill:                    WorkerSkill.Field,
    health:                   HealthLevel.Healthy,
    assignedTask:             null,
    individualScore:          75,
    contractSeasonsRemaining: null,
    wagePerSeason:            null,
  }
}

/**
 * Calculate the factor advance for the FinancedEntry path.
 *
 * Historically, factors advanced 50-70% of the estimated Year 1 crop value.
 * We size against actual starting cleared tiles so the advance is always
 * serviceable by a first harvest — a factor would not advance more than
 * the crop can cover, since an insolvent planter is a bad debtor.
 *
 * Formula: clearedTiles × baseYieldPerTile × tobaccoStartPrice × advanceRate
 */
function computeFactorAdvance(clearedTileCount: number): number {
  const TOBACCO_START_PRICE = 12  // matches market.prices[Tobacco] at game start
  const baseYield = CROP_BASE_YIELD_PER_TILE[CropType.Tobacco] ?? 24
  // Apply a realistic soil/weather modifier (0.55) — average starting forest soil
  // gives ~52% composite, so theoretical max yield is never actually achieved.
  // The factor advances against what the operation can realistically produce.
  const REALISTIC_YIELD_MODIFIER = 0.55
  const estimated = clearedTileCount * baseYield * REALISTIC_YIELD_MODIFIER * TOBACCO_START_PRICE * FACTOR_ADVANCE_RATE
  return Math.max(0, Math.round(estimated / 10) * 10)
}

function getStartingFinances(capital: StartingCapital, clearedTileCount: number = 2) {
  const factorAdvance = computeFactorAdvance(clearedTileCount)
  switch (capital) {
    case StartingCapital.CashBuyer:
      return { cashOnHand: 1000, factorAdvance: 0,             personalNote: 0   }
    case StartingCapital.FinancedEntry:
      return { cashOnHand: 300,  factorAdvance,                personalNote: 0   }
    case StartingCapital.FamilyLoan:
      return { cashOnHand: 500,  factorAdvance: 0,             personalNote: 400 }
  }
}
