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
  HealthLevel,
  CabinCondition,
  TerrainType,
} from '@engine/types'
import { resolveSeasonEnd } from '@engine/season'
import {
  STORAGE_CAPACITY_NONE,
  STORAGE_CAPACITY_SMOKEHOUSE,
  SMOKEHOUSE_BUILD_COST_MIN,
} from '@engine/constants'

// ---------------------------------------------------------------------------
// SEASON PLAN
// Labor allocation the player sets before ending a season.
// Keys are task identifiers; values are worker counts allocated.
// ---------------------------------------------------------------------------

export interface SeasonPlan {
  // tileId -> action -> workers allocated
  tileAllocations: Record<string, TileAction>
  // workers allocated to cabin repair (spread across all cabins)
  cabinRepairWorkers: number
  // workers allocated to storage management
  storageWorkers: number
  // remaining workers rest automatically
}

export type TileAction =
  | { type: 'Clear';   workers: number }
  | { type: 'Plant';   workers: number; crop: CropType }
  | { type: 'Tend';    workers: number }
  | { type: 'Harvest'; workers: number }
  | { type: 'Idle' }

// ---------------------------------------------------------------------------
// STORE SHAPE
// ---------------------------------------------------------------------------

interface GameStore {
  gameState:            GameState | null
  isPlaying:            boolean
  activePanel:          'map' | 'roster' | 'ledger' | 'market' | 'trophies'
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
  confirmPlanAndAdvance:  () => void

  // Supply and build actions
  buySupplies:            (corn: number, blankets: number) => void
  buildSmokehouse:        () => void
  queueSale:              (crop: CropType, quantity: number, minPrice: number | null) => void
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
  return { tileAllocations: {}, cabinRepairWorkers: 0, storageWorkers: 0 }
}

/**
 * Counts total workers allocated in a plan.
 */
export function countAllocatedWorkers(plan: SeasonPlan): number {
  const tileTotal = Object.values(plan.tileAllocations).reduce((sum, action) => {
    if (action.type === 'Idle') return sum
    return sum + action.workers
  }, 0)
  return tileTotal + plan.cabinRepairWorkers + plan.storageWorkers
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
  for (let i = 0; i < plan.cabinRepairWorkers; i++) {
    const cabinId = 'cabin-1' // Phase 1: single cabin target
    assignments.push({ type: 'RepairCabin', cabinId })
  }

  // Storage
  for (let i = 0; i < plan.storageWorkers; i++) {
    assignments.push({ type: 'ManageStorage' })
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
function applyPlanToTiles(state: GameState, plan: SeasonPlan): GameState['tiles'] {
  return state.tiles.map(tile => {
    const action = plan.tileAllocations[tile.id]
    if (!action || action.type !== 'Plant') return tile
    return { ...tile, currentCrop: action.crop }
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

  // ── Confirm plan and advance season ──────────────────────────────────────
  confirmPlanAndAdvance: () => {
    const { gameState, seasonPlan } = get()
    if (!gameState) return

    // Apply plan to workers and tiles before resolving the season
    const withAssignments: GameState = {
      ...gameState,
      workers: applyPlanToWorkers(gameState, seasonPlan),
      tiles:   applyPlanToTiles(gameState, seasonPlan),
    }

    const eventCountBefore = withAssignments.eventLog.length
    const nextState        = resolveSeasonEnd(withAssignments)
    const newEvents        = nextState.eventLog.slice(eventCountBefore)

    set({
      gameState:            nextState,
      showingSeasonPlanner: false,
      showingSeasonSummary: true,
      lastSeasonEvents:     newEvents,
      seasonPlan:           emptySeasonPlan(), // reset plan for next season
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

    if (gameState.finances.cashOnHand < totalCost) return  // can't afford

    const updated: GameState = {
      ...gameState,
      blanketsOnHand: gameState.blanketsOnHand + blankets,
      cornOnHand:     gameState.cornOnHand + corn,
      finances: {
        ...gameState.finances,
        cashOnHand: gameState.finances.cashOnHand - totalCost,
      },
    }
    set({ gameState: updated })
    saveToLocalStorage(updated)
  },

  // ── Build smokehouse ──────────────────────────────────────────────────────
  buildSmokehouse: () => {
    const { gameState } = get()
    if (!gameState) return
    if (gameState.storage.capacity >= STORAGE_CAPACITY_SMOKEHOUSE) return // already built
    if (gameState.finances.cashOnHand < SMOKEHOUSE_BUILD_COST_MIN) return

    const updated: GameState = {
      ...gameState,
      storage: { ...gameState.storage, capacity: STORAGE_CAPACITY_SMOKEHOUSE },
      finances: {
        ...gameState.finances,
        cashOnHand: gameState.finances.cashOnHand - SMOKEHOUSE_BUILD_COST_MIN,
      },
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

  // ── Dismiss season summary ────────────────────────────────────────────────
  dismissSeasonSummary: () => set({ showingSeasonSummary: false }),

  // ── UI nav ────────────────────────────────────────────────────────────────
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
  const worker1   = buildStartingWorker('worker-1')
  const worker2   = buildStartingWorker('worker-2')

  cabin1.occupants = [worker1.id]
  cabin2.occupants = [worker2.id]

  const { cashOnHand, factorAdvance, personalNote } = getStartingFinances(startingCapital)

  return {
    version:         '0.1.0',
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
    blanketsOnHand:  4,
    // Starting provisions: 8 units ≈ 4 seasons of food for 2 workers,
    // giving the player one year before corn becomes critical.
    cornOnHand:      8,
    conditionsIndex: 75,
    storage: {
      capacity:             STORAGE_CAPACITY_NONE,
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
      cashOnHand,
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
  }
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
    hasStumpRot:               false,
    stumpRotSeasonsLeft:       0,
    clearingProgressRemaining: config.isCleared ? 0 : 3,
  }
}

function buildCabin(id: string) {
  return {
    id,
    condition:  CabinCondition.Fair,
    capacity:   4 as const,
    occupants:  [] as string[],
    receivedMaintenanceThisSeason: false,
  }
}

const WORKER_NAMES = ['Solomon', 'Phoebe', 'Caesar', 'Dinah', 'Tom', 'Hannah', 'Elias', 'Ruth']

function buildStartingWorker(id: string) {
  const name = WORKER_NAMES[Math.floor(Math.random() * WORKER_NAMES.length)]
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

function getStartingFinances(capital: StartingCapital) {
  switch (capital) {
    case StartingCapital.CashBuyer:
      return { cashOnHand: 1000, factorAdvance: 0,   personalNote: 0   }
    case StartingCapital.FinancedEntry:
      return { cashOnHand: 300,  factorAdvance: 750, personalNote: 0   }
    case StartingCapital.FamilyLoan:
      return { cashOnHand: 500,  factorAdvance: 0,   personalNote: 400 }
  }
}
