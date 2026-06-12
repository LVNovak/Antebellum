/**
 * types.ts
 *
 * The complete data model for Antebellum.
 *
 * Every piece of game state is described here as a TypeScript type or enum.
 * If you want to understand what the game tracks and why, this is the place to start.
 *
 * Rule: nothing in this file contains logic — only shapes of data.
 * Logic lives in the engine files (soil.ts, labor.ts, season.ts, etc.)
 */

// ---------------------------------------------------------------------------
// ENUMS — fixed sets of named values
// ---------------------------------------------------------------------------

/**
 * The four seasons that make up one game year.
 * Each season is one player turn.
 */
export enum Season {
  Spring = 'Spring',
  Summer = 'Summer',
  Autumn = 'Autumn',
  Winter = 'Winter',
}

/**
 * The five labor categories available in colonial Carolina.
 * Each has different costs, legal status, and gameplay implications.
 * See GDD Section 5 for full detail.
 */
export enum LaborType {
  EnslavedPurchased = 'EnslavedPurchased',
  EnslavedHiredOut  = 'EnslavedHiredOut',
  IndenturedBlack   = 'IndenturedBlack',
  IndenturedWhite   = 'IndenturedWhite',
  FreeWage          = 'FreeWage',
}

/**
 * Individual worker health states.
 * Each level has a defined productivity multiplier (see constants.ts).
 * Health degrades from mistreatment and improves from good conditions.
 */
export enum HealthLevel {
  Healthy  = 'Healthy',   // 100% productivity
  Tired    = 'Tired',     // 85% productivity
  Weak     = 'Weak',      // 60% productivity
  Sick     = 'Sick',      // 30% productivity
  VerySick = 'VerySick',  // 15% productivity — risk of death
}

/**
 * Cabin condition states.
 * Condition affects labor health and disease risk.
 * Degrades without seasonal maintenance investment.
 */
export enum CabinCondition {
  Good    = 'Good',     // +10% productivity, low disease risk
  Fair    = 'Fair',     // baseline — starting state
  Poor    = 'Poor',     // -20% productivity, high disease risk
  Damaged = 'Damaged',  // -40% productivity, very high disease risk
}

/**
 * Terrain types for land tiles.
 * Revealed when land is cleared. Affects which crops can be grown.
 */
export enum TerrainType {
  Forest  = 'Forest',   // most common; must be cleared
  Swamp   = 'Swamp',    // required for rice; expensive to clear and drain
  Upland  = 'Upland',   // open/meadow land; rarer, premium price
}

/**
 * Crops available in 17th-century colonial Carolina.
 * Cotton and sugar cane are excluded — not historically dominant in this period.
 * See GDD Section 7.1 for full crop detail.
 */
export enum CropType {
  Tobacco      = 'Tobacco',
  Rice         = 'Rice',
  Corn         = 'Corn',
  Cowpeas      = 'Cowpeas',
  SweetPotato  = 'SweetPotato',
  Indigo       = 'Indigo',
  CoverCrop    = 'CoverCrop',  // planted during fallow to restore soil
  Fallow       = 'Fallow',     // bare fallow — no crop, some soil recovery
}

/**
 * Skill specializations a worker can have.
 * Skilled workers unlock storage bonuses and other improvements.
 */
export enum WorkerSkill {
  Field    = 'Field',     // general field labor — most common
  Cooper   = 'Cooper',    // barrel-making; reduces storage spoilage
  Carpenter = 'Carpenter', // construction; improves cabin and storage condition
  Domestic = 'Domestic',  // household labor
}

/**
 * Weather events drawn each season.
 * Affects crops, housing condition, labor health, and soil values.
 */
export enum WeatherEvent {
  Normal    = 'Normal',
  Drought   = 'Drought',
  HeavyRain = 'HeavyRain',
  Storm     = 'Storm',
  EarlyFrost = 'EarlyFrost',  // Autumn only — destroys unharvested crops
}

/**
 * The player's starting origin story.
 * Determines land grant size, starting cash, and starting debt.
 * See GDD Section 3.1.
 */
export enum Origin {
  VeteranWarrant   = 'VeteranWarrant',   // 160 acres, low cash, no debt
  PlanterSon       = 'PlanterSon',       // 80 acres, moderate cash, no debt
  LotteryWinner    = 'LotteryWinner',    // 40 acres, no cash, no debt
  ImmigrantEntrepreneur = 'ImmigrantEntrepreneur', // 40 acres, high cash, small debt
}

/**
 * Starting capital configuration chosen at game start.
 * See GDD Section 4.1.
 */
export enum StartingCapital {
  CashBuyer    = 'CashBuyer',    // $800-$1200 cash, no credit
  FinancedEntry = 'FinancedEntry', // $200-$400 cash + factor advance
  FamilyLoan   = 'FamilyLoan',   // $400-$600 cash + personal note
}

// ---------------------------------------------------------------------------
// SOIL — the four-value food web model
// ---------------------------------------------------------------------------

/**
 * The four soil health values tracked per land tile.
 * These values are NEVER shown to the player directly.
 * They drive the qualitative hints the player sees (see GDD Section 13.3).
 *
 * All values are integers from 0 to 100.
 *
 * - OrganicMatter (OM): decomposed material; base fertility reservoir
 * - Nitrogen (N): available nitrogen for plant uptake
 * - SoilFauna (SF): earthworms and microbes that convert OM into nutrients
 * - MoistureRetention (MR): soil's ability to hold water between rains
 *
 * How they interact:
 * - SF multiplies how fast OM converts to usable nutrients
 * - MR gates how effective Nitrogen is (dry soil = locked nutrients)
 * - Composite yield = weighted average of all four (see constants.ts)
 */
export interface SoilHealth {
  organicMatter:      number  // 0–100
  nitrogen:           number  // 0–100
  soilFauna:          number  // 0–100
  moistureRetention:  number  // 0–100
}

// ---------------------------------------------------------------------------
// LAND TILES
// ---------------------------------------------------------------------------

/**
 * A single land tile on the plantation map.
 * The player's land is made up of 20–50 of these.
 */
export interface Tile {
  id:           string        // unique identifier, e.g. "tile-001"
  terrain:      TerrainType
  isCleared:    boolean       // must be true before the tile can be farmed
  isWaterAdjacent: boolean    // required for rice cultivation
  soil:         SoilHealth    // hidden from player; drives qualitative hints
  currentCrop:  CropType | null  // what's planted this season (null = unused)
  hasStumpRot:  boolean       // true for 1-2 seasons after clearing; suppresses SF
  stumpRotSeasonsLeft: number // countdown to stump rot clearing

  // How many labor-seasons remain to finish clearing this tile
  // 0 means fully cleared
  clearingProgressRemaining: number
}

// ---------------------------------------------------------------------------
// WORKERS
// ---------------------------------------------------------------------------

/**
 * A single named worker on the plantation.
 * All five labor types use this same structure.
 * Every worker is a named individual — not a unit or a number.
 */
export interface Worker {
  id:         string
  name:       string        // period-appropriate name for their background
  age:        number        // affects productivity and longevity
  laborType:  LaborType
  skill:      WorkerSkill
  health:     HealthLevel

  // Task the worker is assigned to this season
  // null means unassigned (resting — aids health recovery)
  assignedTask: WorkerTask | null

  // For enslaved workers: individual welfare score feeding into Conditions Index
  // For indentured workers: individual contract satisfaction
  // For free wage workers: not used (they quit if unhappy)
  individualScore: number   // 0–100

  // For indentured workers: seasons remaining on their contract
  // null for enslaved and free wage workers
  contractSeasonsRemaining: number | null

  // For free wage workers: their current wage per season
  // null for enslaved and indentured workers
  wagePerSeason: number | null
}

/**
 * What a worker can be assigned to do in a season.
 */
export type WorkerTask =
  | { type: 'ClearLand';    tileId: string }
  | { type: 'PlantCrop';    tileId: string; crop: CropType }
  | { type: 'TendCrop';     tileId: string }
  | { type: 'HarvestCrop';  tileId: string }
  | { type: 'RepairCabin';  cabinId: string }
  | { type: 'ManageStorage' }
  | { type: 'Rest' }        // intentional rest; aids health recovery

// ---------------------------------------------------------------------------
// HOUSING
// ---------------------------------------------------------------------------

/**
 * A single cabin on the plantation.
 * Cabins hold 4 workers each. Condition degrades without seasonal maintenance.
 * See GDD Section 6 for full detail.
 */
export interface Cabin {
  id:         string
  condition:  CabinCondition
  capacity:   4             // always 4 — this is a game constant
  occupants:  string[]      // worker IDs currently assigned to this cabin

  // Tracks whether this cabin received its seasonal maintenance this turn.
  // Cabins that miss maintenance degrade one condition tier.
  receivedMaintenanceThisSeason: boolean
}

// ---------------------------------------------------------------------------
// STORAGE
// ---------------------------------------------------------------------------

/**
 * The plantation's crop storage facility.
 * Crops sit here from harvest until the player queues a sale.
 * Spoilage runs every season until sold.
 * See GDD Section 8.
 */
export interface Storage {
  // How many units the storage can hold total
  // 0 = no storage built yet (crops rot in field)
  // 50 = smokehouse built
  // 80+ = storehouse upgrade
  capacity:     number

  // Current inventory by crop type (in units)
  inventory:    Partial<Record<CropType, number>>

  // Tracks the age of each crop batch for spoilage calculation
  // Key: crop type. Value: seasons since harvest.
  seasonsStored: Partial<Record<CropType, number>>

  // Whether a Cooper is currently assigned to storage (reduces spoilage)
  hasCooperAssigned: boolean

  // Whether a Carpenter maintained storage this season (slows condition decay)
  hasCarpenterAssigned: boolean
}

// ---------------------------------------------------------------------------
// FACTOR & FINANCE
// ---------------------------------------------------------------------------

/**
 * The player's relationship with their cotton factor (commission merchant).
 * The factor is the player's link to the export market.
 * See GDD Section 4.3.
 */
export interface Factor {
  id:           string
  name:         string
  city:         string      // e.g. "Charleston", "Savannah"

  // Relationship quality affects price received and credit terms
  // Builds with consistent delivery; damaged by defaults or switching
  relationshipScore: number  // 0–100

  // Current credit advanced against future harvests
  // Must be repaid from harvest revenue
  advanceOutstanding: number

  // Maximum credit the factor will extend based on relationship
  creditLimit:  number
}

/**
 * A sale the player has queued for the factor to execute.
 */
export interface QueuedSale {
  id:           string
  crop:         CropType
  quantity:     number
  minPriceFloor: number | null  // factor won't sell below this if set
  queuedOnSeason: Season
  queuedOnYear:   number
}

/**
 * The plantation's complete financial picture.
 */
export interface Finances {
  cashOnHand:           number
  factorAdvanceDebt:    number   // short-term; repaid at harvest
  mortgageDebt:         number   // long-term; land mortgage
  personalNoteDebt:     number   // private lender; high interest
  factor:               Factor
  queuedSales:          QueuedSale[]
}

// ---------------------------------------------------------------------------
// MARKET
// ---------------------------------------------------------------------------

/**
 * Current commodity market prices.
 * Prices fluctuate each season based on demand, weather, and supply.
 * See GDD Section 9.3.
 */
export interface MarketPrices {
  // Price per unit for each sellable crop
  prices: Partial<Record<CropType, number>>

  // Last 4 seasons of prices — used to show the price trend in the UI
  priceHistory: Array<Partial<Record<CropType, number>>>
}

// ---------------------------------------------------------------------------
// EVENTS
// ---------------------------------------------------------------------------

/**
 * A single event that occurred during a season.
 * Events are logged and shown in the Season Summary and Event Log.
 */
export interface GameEvent {
  id:           string
  season:       Season
  year:         number
  category:     'Weather' | 'Economic' | 'Labor' | 'Soil'
  title:        string
  description:  string

  // The mechanical effect this event had (for display in summary)
  effects:      string[]
}

// ---------------------------------------------------------------------------
// ACHIEVEMENTS / TROPHIES
// ---------------------------------------------------------------------------

/**
 * A trophy earned through sustained play patterns.
 * Trophies are recorded silently — no cutscene, no fanfare.
 * The trophy ledger is a record, not a reward screen.
 * See GDD Section 12.
 */
export interface Trophy {
  id:         string
  name:       string
  condition:  string    // plain-language description of how it was earned
  earnedOnYear: number
  earnedOnSeason: Season
}

// ---------------------------------------------------------------------------
// GAME STATE — the complete save state
// ---------------------------------------------------------------------------

/**
 * The complete state of a game in progress.
 * This entire object is what gets saved to LocalStorage.
 *
 * If you want to understand what the game tracks at any moment,
 * this is the single source of truth.
 */
export interface GameState {
  // Metadata
  version:      string    // for handling save file compatibility
  createdAt:    string    // ISO date string
  lastSavedAt:  string

  // Player identity
  playerName:   string
  origin:       Origin
  startingCapital: StartingCapital

  // Time
  currentYear:  number    // starts at 1
  currentSeason: Season

  // The land
  tiles:        Tile[]

  // The people
  workers:      Worker[]
  cabins:       Cabin[]

  // Storage and market
  storage:      Storage
  market:       MarketPrices
  finances:     Finances

  // Blanket supply — tracked separately as a physical supply item
  blanketsOnHand: number  // each worker needs 0.25 per season (1 per year)

  // Corn provisions stockpile — accumulates from harvest and purchases,
  // depleted by worker upkeep each season (1 unit per worker per season)
  cornOnHand: number

  // Aggregate welfare index for enslaved workers (0–100)
  // Derived from individual worker scores each season
  conditionsIndex: number

  // History
  eventLog:     GameEvent[]
  trophies:     Trophy[]

  // Phase 1: simple soil model stand-in
  // Phase 2: replaced by the full four-value model already in Tile.soil
  useSimplifiedSoilModel: boolean
}
