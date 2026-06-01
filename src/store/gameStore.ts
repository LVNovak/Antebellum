/**
 * gameStore.ts
 *
 * The global state store for the game, built with Zustand.
 *
 * This is the bridge between the game engine (pure logic) and the UI (React).
 * The UI reads state from this store and calls actions to change it.
 * The store calls engine functions to compute new state, then saves the result.
 *
 * Think of it as three layers:
 *   Engine (logic) → Store (state + actions) → UI (display)
 *
 * The engine never knows about the UI.
 * The UI never contains game logic.
 * The store is the only place they connect.
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
import { STORAGE_CAPACITY_NONE } from '@engine/constants'

// ---------------------------------------------------------------------------
// STORE SHAPE
// ---------------------------------------------------------------------------

/**
 * Everything the UI can read or do.
 */
interface GameStore {
  // The complete game state (null = no game started yet)
  gameState: GameState | null

  // Whether a game is currently in progress
  isPlaying: boolean

  // UI state — which main panel is currently shown
  activePanel: 'map' | 'roster' | 'ledger' | 'market' | 'summary' | 'trophies'

  // Whether the season summary overlay is showing
  showingSeasonSummary: boolean

  // The events from the most recently resolved season (shown in summary)
  lastSeasonEvents: GameState['eventLog']

  // Actions the UI can call
  startNewGame:       (params: NewGameParams) => void
  advanceSeason:      () => void
  setActivePanel:     (panel: GameStore['activePanel']) => void
  dismissSeasonSummary: () => void
  saveGame:           () => void
  loadGame:           () => boolean
  resetGame:          () => void
}

interface NewGameParams {
  playerName:      string
  origin:          Origin
  startingCapital: StartingCapital
}

// ---------------------------------------------------------------------------
// STORE IMPLEMENTATION
// ---------------------------------------------------------------------------

export const useGameStore = create<GameStore>((set, get) => ({
  gameState:            null,
  isPlaying:            false,
  activePanel:          'map',
  showingSeasonSummary: false,
  lastSeasonEvents:     [],

  // ── Start a new game ───────────────────────────────────────────────────
  startNewGame: (params) => {
    const initialState = buildInitialGameState(params)
    set({
      gameState:            initialState,
      isPlaying:            true,
      activePanel:          'map',
      showingSeasonSummary: false,
      lastSeasonEvents:     [],
    })
    saveToLocalStorage(initialState)
  },

  // ── Advance to the next season ─────────────────────────────────────────
  advanceSeason: () => {
    const { gameState } = get()
    if (!gameState) return

    const eventCountBefore = gameState.eventLog.length
    const nextState        = resolveSeasonEnd(gameState)
    const newEvents        = nextState.eventLog.slice(eventCountBefore)

    set({
      gameState:            nextState,
      showingSeasonSummary: true,
      lastSeasonEvents:     newEvents,
    })
    saveToLocalStorage(nextState)
  },

  // ── UI panel navigation ────────────────────────────────────────────────
  setActivePanel: (panel) => set({ activePanel: panel }),

  // ── Dismiss the end-of-season summary overlay ─────────────────────────
  dismissSeasonSummary: () => set({ showingSeasonSummary: false }),

  // ── Save to LocalStorage ───────────────────────────────────────────────
  saveGame: () => {
    const { gameState } = get()
    if (gameState) saveToLocalStorage(gameState)
  },

  // ── Load from LocalStorage ─────────────────────────────────────────────
  loadGame: () => {
    const saved = loadFromLocalStorage()
    if (!saved) return false
    set({ gameState: saved, isPlaying: true })
    return true
  },

  // ── Reset everything ───────────────────────────────────────────────────
  resetGame: () => {
    localStorage.removeItem(SAVE_KEY)
    set({ gameState: null, isPlaying: false, activePanel: 'map' })
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
    // LocalStorage can fail if the browser is in private mode or storage is full
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

/**
 * Builds a fresh GameState for a new game.
 *
 * Sets up the starting land grant, cabins, initial finances, and market
 * based on the player's chosen origin and capital configuration.
 */
function buildInitialGameState(params: NewGameParams): GameState {
  const { playerName, origin, startingCapital } = params
  const now = new Date().toISOString()

  // Starting tile — the land grant
  const grantTile = buildGrantTile(origin)

  // Starting cabins — all new planters start with 2 Fair cabins
  const cabin1 = buildCabin('cabin-1')
  const cabin2 = buildCabin('cabin-2')

  // Starting workers — Phase 1 starts with 2 hired-out enslaved workers
  const worker1 = buildStartingWorker('worker-1', cabin1.id)
  const worker2 = buildStartingWorker('worker-2', cabin2.id)

  cabin1.occupants = [worker1.id]
  cabin2.occupants = [worker2.id]

  // Starting finances
  const { cashOnHand, factorAdvance, personalNote } = getStartingFinances(startingCapital)

  return {
    version:        '0.1.0',
    createdAt:      now,
    lastSavedAt:    now,
    playerName,
    origin,
    startingCapital,
    currentYear:    1,
    currentSeason:  Season.Spring,
    tiles:          [grantTile],
    workers:        [worker1, worker2],
    cabins:         [cabin1, cabin2],
    blanketsOnHand: 4,  // enough for 2 workers for 1 year
    conditionsIndex: 75, // start in a reasonable state
    storage: {
      capacity:              STORAGE_CAPACITY_NONE,  // no storage until smokehouse is built
      inventory:             {},
      seasonsStored:         {},
      hasCooperAssigned:     false,
      hasCarpenterAssigned:  false,
    },
    market: {
      prices: {
        [CropType.Tobacco]:     12,
        [CropType.Rice]:        8,
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
        relationshipScore:  50,   // neutral starting relationship
        advanceOutstanding: factorAdvance,
        creditLimit:        800,
      },
      queuedSales: [],
    },
    useSimplifiedSoilModel: true,  // Phase 1 — simplified until Phase 2
    eventLog: [],
    trophies: [],
  }
}

// ── Land grant tile by origin ──────────────────────────────────────────────

function buildGrantTile(origin: Origin) {
  // Grant tiles vary by origin — see GDD Section 3.1
  const configs: Record<Origin, { isCleared: boolean; terrain: TerrainType }> = {
    [Origin.VeteranWarrant]:       { isCleared: false, terrain: TerrainType.Forest  },
    [Origin.PlanterSon]:           { isCleared: true,  terrain: TerrainType.Upland  },
    [Origin.LotteryWinner]:        { isCleared: false, terrain: TerrainType.Forest  },
    [Origin.ImmigrantEntrepreneur]:{ isCleared: false, terrain: TerrainType.Upland  },
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

// ── Cabin builder ──────────────────────────────────────────────────────────

function buildCabin(id: string) {
  return {
    id,
    condition:  CabinCondition.Fair,
    capacity:   4 as const,
    occupants:  [] as string[],
    receivedMaintenanceThisSeason: false,
  }
}

// ── Starting worker builder ────────────────────────────────────────────────

// Period-appropriate names for Phase 1 starting workers
// Phase 2 will have a full name generator by demographic
const STARTING_WORKER_NAMES = ['Solomon', 'Phoebe', 'Caesar', 'Dinah', 'Tom', 'Hannah']

function buildStartingWorker(id: string, cabinId: string) {
  const name = STARTING_WORKER_NAMES[Math.floor(Math.random() * STARTING_WORKER_NAMES.length)]
  return {
    id,
    name,
    age:                       Math.floor(Math.random() * 20) + 20,  // 20-40
    laborType:                 LaborType.EnslavedHiredOut,
    skill:                     WorkerSkill.Field,
    health:                    HealthLevel.Healthy,
    assignedTask:              null,
    individualScore:           75,
    contractSeasonsRemaining:  null,
    wagePerSeason:             null,
  }
}

// ── Starting finances by capital choice ───────────────────────────────────

function getStartingFinances(capital: StartingCapital): {
  cashOnHand:    number
  factorAdvance: number
  personalNote:  number
} {
  switch (capital) {
    case StartingCapital.CashBuyer:
      return { cashOnHand: 1000, factorAdvance: 0,   personalNote: 0   }
    case StartingCapital.FinancedEntry:
      return { cashOnHand: 300,  factorAdvance: 750, personalNote: 0   }
    case StartingCapital.FamilyLoan:
      return { cashOnHand: 500,  factorAdvance: 0,   personalNote: 400 }
  }
}
