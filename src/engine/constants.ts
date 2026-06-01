/**
 * constants.ts
 *
 * Every tunable number in the game lives here.
 *
 * This is intentional. If the game feels too easy, too hard, or unbalanced,
 * this is the first file to look at. You should never need to dig through
 * engine logic to change a number.
 *
 * Organization:
 *   - HEALTH: productivity multipliers per health level
 *   - HOUSING: capacity, upkeep costs, condition effects
 *   - LABOR: upkeep costs per worker per season
 *   - SOIL: draw-down table, yield formula weights
 *   - CROPS: base yield, export value, labor requirement
 *   - FINANCE: interest rates, starting capital ranges
 *   - MARKET: price ranges, volatility
 *   - STORAGE: capacity, spoilage rates
 *   - EVENTS: probability weights
 *   - ACHIEVEMENTS: threshold values
 */

import { CabinCondition, CropType, HealthLevel, LaborType, Season, WeatherEvent } from './types'

// ---------------------------------------------------------------------------
// HEALTH
// ---------------------------------------------------------------------------

/**
 * How much of a worker's full output they produce at each health level.
 * A Sick worker produces 30% of what a Healthy worker produces.
 */
export const HEALTH_PRODUCTIVITY: Record<HealthLevel, number> = {
  [HealthLevel.Healthy]:  1.00,
  [HealthLevel.Tired]:    0.85,
  [HealthLevel.Weak]:     0.60,
  [HealthLevel.Sick]:     0.30,
  [HealthLevel.VerySick]: 0.15,
}

/**
 * Probability that disease spreads from a Sick worker to a cabin-mate
 * per season. Rises with overcrowding and poor cabin condition.
 */
export const DISEASE_SPREAD_BASE_CHANCE = 0.10  // 10% base per season

// ---------------------------------------------------------------------------
// HOUSING
// ---------------------------------------------------------------------------

export const CABIN_CAPACITY = 4  // workers per cabin — fixed game constant

export const CABIN_UPKEEP_PER_SEASON = {
  timber: 1,
  nails:  1,
  cash:   3,
}

/**
 * Productivity modifier applied to all workers in a cabin, by condition.
 */
export const CABIN_CONDITION_PRODUCTIVITY: Record<CabinCondition, number> = {
  [CabinCondition.Good]:    1.10,
  [CabinCondition.Fair]:    1.00,
  [CabinCondition.Poor]:    0.80,
  [CabinCondition.Damaged]: 0.60,
}

/**
 * Disease risk multiplier by cabin condition.
 * Applied to base disease spread chance.
 */
export const CABIN_CONDITION_DISEASE_RISK: Record<CabinCondition, number> = {
  [CabinCondition.Good]:    0.50,  // half the base risk
  [CabinCondition.Fair]:    1.00,  // baseline
  [CabinCondition.Poor]:    2.00,  // double
  [CabinCondition.Damaged]: 4.00,  // four times
}

// Overcrowding penalties — applied per extra worker above CABIN_CAPACITY
export const OVERCROWDING_DISEASE_RISK_PER_EXTRA = 0.20  // +20% per extra
export const OVERCROWDING_STRESS_PER_EXTRA        = 0.10  // +10% stress (feeds Conditions Index)
export const OVERCROWDING_PRODUCTIVITY_PER_EXTRA  = 0.05  // -5% productivity per extra

// Cost to build a new cabin
export const CABIN_BUILD_COST_MIN = 200
export const CABIN_BUILD_COST_MAX = 400

// Cost to upgrade a cabin one condition tier (e.g. Poor → Fair, Fair → Good)
export const CABIN_UPGRADE_COST_MIN = 200
export const CABIN_UPGRADE_COST_MAX = 800

// ---------------------------------------------------------------------------
// LABOR UPKEEP — per worker per season
// ---------------------------------------------------------------------------

export const LABOR_UPKEEP = {
  corn:     1,     // units of corn per worker per season
  clothing: 1,     // dollars per worker per season
  blankets: 0.25,  // blankets per worker per season (1 per year)
}

/**
 * Seasonal cost by labor type.
 * Enslaved (purchased) only incurs subsistence provision.
 * Free wage labor costs far more — historically 3-5x.
 */
export const LABOR_SEASONAL_COST: Record<LaborType, { min: number; max: number }> = {
  [LaborType.EnslavedPurchased]: { min: 5,   max: 10  },  // provision only
  [LaborType.EnslavedHiredOut]:  { min: 15,  max: 25  },  // rental + provision
  [LaborType.IndenturedBlack]:   { min: 10,  max: 20  },  // contract terms vary
  [LaborType.IndenturedWhite]:   { min: 10,  max: 20  },  // contract terms vary
  [LaborType.FreeWage]:          { min: 35,  max: 55  },  // market wages; 3-5x enslaved
}

// ---------------------------------------------------------------------------
// SOIL — food web engine
// ---------------------------------------------------------------------------

/**
 * Weights used in the composite yield formula.
 * Must sum to 1.0.
 *
 * Yield modifier = (OM * 0.30) + (N * 0.35) + (SF * 0.20) + (MR * 0.15)
 * (all values normalized to 0–1 before weighting)
 */
export const SOIL_YIELD_WEIGHTS = {
  organicMatter:     0.30,
  nitrogen:          0.35,
  soilFauna:         0.20,
  moistureRetention: 0.15,
}

/**
 * How each crop or action changes the four soil values per season.
 * Negative = depletion. Positive = restoration.
 *
 * Source: GDD Section 7.2.2
 */
export const SOIL_DRAW_DOWN: Record<CropType, {
  organicMatter: number
  nitrogen:      number
  soilFauna:     number
  moistureRetention: number
}> = {
  [CropType.Tobacco]:     { organicMatter: -5, nitrogen: -8, soilFauna: -4, moistureRetention: -3 },
  [CropType.Rice]:        { organicMatter: -2, nitrogen: -3, soilFauna: +1, moistureRetention:  0 },  // wetland irrigated
  [CropType.Corn]:        { organicMatter: -3, nitrogen: -5, soilFauna: -2, moistureRetention: -1 },
  [CropType.Cowpeas]:     { organicMatter: -1, nitrogen: +8, soilFauna: +2, moistureRetention: +1 },  // nitrogen fixer
  [CropType.SweetPotato]: { organicMatter: -2, nitrogen: -3, soilFauna: +1, moistureRetention: +1 },
  [CropType.Indigo]:      { organicMatter: -3, nitrogen: -5, soilFauna: -2, moistureRetention: -1 },
  [CropType.CoverCrop]:   { organicMatter: +4, nitrogen: +5, soilFauna: +4, moistureRetention: +3 },  // best restoration
  [CropType.Fallow]:      { organicMatter: +2, nitrogen: +1, soilFauna: +3, moistureRetention: +2 },  // bare fallow
}

// Stump rot effect — applied for 1-2 seasons after clearing forested land
export const STUMP_ROT_SOIL_FAUNA_PENALTY = -12  // suppresses SF while rot is active
export const STUMP_ROT_DURATION_MIN = 1
export const STUMP_ROT_DURATION_MAX = 2

// Manure application — one-time boost from the compost facility improvement
export const MANURE_APPLICATION_BOOST = {
  organicMatter:     +8,
  nitrogen:          +4,
  soilFauna:         +6,
  moistureRetention: +3,
}

// Warning thresholds — triggers a qualitative hint event
export const SOIL_SINGLE_VALUE_WARNING_THRESHOLD = 10   // any single value below this
export const SOIL_EXHAUSTION_THRESHOLD           = 20   // all four values below this

// Starting soil values for a new tile — varies by terrain
export const STARTING_SOIL_BY_TERRAIN = {
  Upland:  { organicMatter: 60, nitrogen: 55, soilFauna: 65, moistureRetention: 50 },
  Forest:  { organicMatter: 70, nitrogen: 45, soilFauna: 75, moistureRetention: 60 },
  Swamp:   { organicMatter: 80, nitrogen: 40, soilFauna: 70, moistureRetention: 90 },
}

// ---------------------------------------------------------------------------
// CROPS — production values
// ---------------------------------------------------------------------------

/**
 * Labor-seasons required to plant one tile of each crop.
 */
export const CROP_LABOR_TO_PLANT: Record<CropType, number> = {
  [CropType.Tobacco]:     2,
  [CropType.Rice]:        3,
  [CropType.Corn]:        1,
  [CropType.Cowpeas]:     1,
  [CropType.SweetPotato]: 1,
  [CropType.Indigo]:      2,
  [CropType.CoverCrop]:   1,
  [CropType.Fallow]:      0,  // no labor needed — just leave the field
}

/**
 * Labor-seasons required to harvest one tile of each crop.
 */
export const CROP_LABOR_TO_HARVEST: Record<CropType, number> = {
  [CropType.Tobacco]:     3,
  [CropType.Rice]:        4,
  [CropType.Corn]:        1,
  [CropType.Cowpeas]:     1,
  [CropType.SweetPotato]: 1,
  [CropType.Indigo]:      2,
  [CropType.CoverCrop]:   0,  // not harvested — plowed back in
  [CropType.Fallow]:      0,
}

/**
 * Base units produced per tile at 100% soil yield modifier.
 * Actual yield = base * soil yield modifier * weather modifier.
 */
export const CROP_BASE_YIELD_PER_TILE: Record<CropType, number> = {
  [CropType.Tobacco]:     8,
  [CropType.Rice]:        10,
  [CropType.Corn]:        6,
  [CropType.Cowpeas]:     4,
  [CropType.SweetPotato]: 5,
  [CropType.Indigo]:      6,
  [CropType.CoverCrop]:   0,
  [CropType.Fallow]:      0,
}

/**
 * Which crops can only be grown on water-adjacent tiles.
 */
export const CROP_REQUIRES_WATER: Record<CropType, boolean> = {
  [CropType.Tobacco]:     false,
  [CropType.Rice]:        true,
  [CropType.Corn]:        false,
  [CropType.Cowpeas]:     false,
  [CropType.SweetPotato]: false,
  [CropType.Indigo]:      false,
  [CropType.CoverCrop]:   false,
  [CropType.Fallow]:      false,
}

// ---------------------------------------------------------------------------
// FINANCE
// ---------------------------------------------------------------------------

// Interest rates — per annum unless noted
export const FINANCE_RATES = {
  factorAdvancePerSeason: { min: 0.08,  max: 0.12 },  // 8-12% per season
  landMortgagePerYear:    { min: 0.06,  max: 0.09 },  // 6-9% per annum
  personalNotePerYear:    { min: 0.12,  max: 0.18 },  // 12-18% per annum
  factorCommission:       { min: 0.025, max: 0.05 },  // 2.5-5% of sale value
}

// Starting cash and credit by capital choice
export const STARTING_CAPITAL = {
  CashBuyer: {
    cashMin: 800, cashMax: 1200,
    creditLine: 0,
  },
  FinancedEntry: {
    cashMin: 200, cashMax: 400,
    factorAdvanceMin: 600, factorAdvanceMax: 900,
  },
  FamilyLoan: {
    cashMin: 400, cashMax: 600,
    personalNoteMin: 300, personalNoteMax: 500,
  },
}

// ---------------------------------------------------------------------------
// MARKET — price ranges by crop
// ---------------------------------------------------------------------------

/**
 * Base market price per unit.
 * Actual price fluctuates each season around this base.
 */
export const MARKET_BASE_PRICE: Partial<Record<CropType, number>> = {
  [CropType.Tobacco]:     12,   // dollars per unit — high value, volatile
  [CropType.Rice]:        8,
  [CropType.Indigo]:      7,
  [CropType.Corn]:        2,    // low value; mainly for provisioning
  [CropType.Cowpeas]:     1,
  [CropType.SweetPotato]: 1,
}

/**
 * How much prices can swing from the base, as a fraction.
 * 0.20 means prices can go 20% above or below the base price.
 */
export const MARKET_VOLATILITY: Partial<Record<CropType, number>> = {
  [CropType.Tobacco]:     0.30,  // most volatile
  [CropType.Rice]:        0.20,
  [CropType.Indigo]:      0.25,
  [CropType.Corn]:        0.10,  // most stable
  [CropType.Cowpeas]:     0.10,
  [CropType.SweetPotato]: 0.10,
}

// Factor relationship bonus — at max relationship, price is this much higher
export const FACTOR_RELATIONSHIP_PRICE_BONUS_MAX = 0.15  // +15% at 100 relationship

// ---------------------------------------------------------------------------
// STORAGE
// ---------------------------------------------------------------------------

export const STORAGE_CAPACITY_NONE         = 0
export const STORAGE_CAPACITY_SMOKEHOUSE   = 50
export const STORAGE_CAPACITY_STOREHOUSE   = 80

export const SMOKEHOUSE_BUILD_COST_MIN     = 200
export const SMOKEHOUSE_BUILD_COST_MAX     = 500
export const STOREHOUSE_UPGRADE_COST_MIN   = 400
export const STOREHOUSE_UPGRADE_COST_MAX   = 800

/**
 * Fraction of stored crop lost to spoilage per season.
 * Cooper assignment reduces this; poor storage condition raises it.
 */
export const SPOILAGE_RATE_PER_SEASON: Partial<Record<CropType, number>> = {
  [CropType.Tobacco]:     0.08,   // moderate — cured tobacco holds well
  [CropType.Rice]:        0.15,   // high — moisture-sensitive
  [CropType.Corn]:        0.03,   // low — dried corn stores well
  [CropType.Indigo]:      0.08,   // moderate — processed cake is stable
}

// Cooper reduces spoilage by this fraction
export const COOPER_SPOILAGE_REDUCTION = 0.40  // 40% reduction

// ---------------------------------------------------------------------------
// EVENTS — probability weights per season
// ---------------------------------------------------------------------------

/**
 * Weather probabilities by season.
 * Values are relative weights — they don't need to sum to 1.
 * The engine normalizes them.
 */
export const WEATHER_WEIGHTS: Record<Season, Partial<Record<WeatherEvent, number>>> = {
  [Season.Spring]: {
    [WeatherEvent.Normal]:    60,
    [WeatherEvent.HeavyRain]: 25,
    [WeatherEvent.Storm]:     15,
  },
  [Season.Summer]: {
    [WeatherEvent.Normal]:    50,
    [WeatherEvent.Drought]:   30,
    [WeatherEvent.Storm]:     20,
  },
  [Season.Autumn]: {
    [WeatherEvent.Normal]:    55,
    [WeatherEvent.Storm]:     20,
    [WeatherEvent.EarlyFrost]: 15,
    [WeatherEvent.HeavyRain]: 10,
  },
  [Season.Winter]: {
    [WeatherEvent.Normal]:    80,
    [WeatherEvent.HeavyRain]: 20,
  },
}

/**
 * Yield multipliers applied to crops by weather event.
 * Note: Rice is destroyed by drought (0 yield).
 */
export const WEATHER_YIELD_MODIFIER: Record<WeatherEvent, number> = {
  [WeatherEvent.Normal]:     1.00,
  [WeatherEvent.Drought]:    0.45,   // -55% average; rice = 0
  [WeatherEvent.HeavyRain]:  0.88,   // -12% average
  [WeatherEvent.Storm]:      0.70,   // -30% average; tobacco hit hardest
  [WeatherEvent.EarlyFrost]: 0.00,   // 0% — destroys all unharvested crops
}

// ---------------------------------------------------------------------------
// ACHIEVEMENTS — threshold values
// ---------------------------------------------------------------------------

export const ACHIEVEMENT_THRESHOLDS = {
  // The Planter: survive this many years without foreclosure
  survivorYears: 5,

  // The Cotton King: top regional economic output for this many consecutive years
  // (Note: no cotton in Phase 1 — this achievement is Phase 2+)
  topOutputConsecutiveYears: 3,

  // The Freedman's Ledger: Conditions Index above this for this many consecutive years
  conditionsIndexThreshold:   70,
  conditionsIndexYears:       10,

  // The Abolitionist Path: operate on free/indentured only for this many years
  abolitionistYears: 5,

  // The Rotation: all parcels above this composite soil health for this many years
  rotationSoilThreshold: 60,
  rotationYears:          3,

  // Debt's End: cash-positive for this many consecutive years with no debt
  debtFreeYears: 3,
}
