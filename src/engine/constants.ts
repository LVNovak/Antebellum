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

import { CabinCondition, CropType, HealthLevel, LaborType, Season, WeatherEvent, TerrainType } from './types'

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
  corn:     1,      // units of corn per worker per season (purchased enslaved + indentured only)
  clothing: 1,      // dollars per worker per season (all types)
  blankets: 0.125,  // blankets per worker per season (1 every 2 years; purchased enslaved + indentured only)
                    // GDD v0.5 correction: historical records show blankets issued every 1-3 years not annually
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

/**
 * One-time acquisition cost by labor type — the price to add a worker
 * to the roster.
 *
 * Grounded in historical indentured servant pricing: outfitting and
 * transport cost £6-10, but servants were resold/indentured for
 * £40-60 depending on skill and remaining contract term — roughly
 * 75-130% of a median Chesapeake worker's annual income at the time.
 * Source: delanceyplace.com / Perkins, "The Economy of Colonial America"
 *
 * Converting at $1 ≈ 1 shilling (20 shillings = £1):
 *   £6-10  → $120-200  (transport/outfitting cost — the floor)
 *   £40-60 → $800-1200 (resale/indenture price — the ceiling)
 *
 * Enslaved purchase sits at the high end of this range and beyond,
 * reflecting that purchase conveys permanent ownership with no
 * contract expiration — historically the most expensive acquisition
 * but the cheapest ongoing cost (see LABOR_SEASONAL_COST above).
 *
 * Hired-out enslaved and rental-based indenture have no acquisition
 * cost — only the seasonal rental fee in LABOR_SEASONAL_COST.
 */
/**
 * One-time acquisition cost by labor type.
 *
 * Revised to match 17th-century Carolina price records:
 * - Enslaved (purchased): £16–£25 sterling in 1670s-1690s Carolina.
 *   At 20 shillings/£ and $1 ≈ 1 shilling, that's roughly $320-$500.
 *   Prices rose through the 18th century to £60-£80 — the original
 *   $900-$1,400 reflected those later, higher prices. Corrected here.
 *   Source: Statista / Colonial slave price records 1638-1775.
 * - Indentured: transport + contract fee typically £4-£8 sterling
 *   ($80-$160 at our conversion rate).
 * - Hired-out enslaved and free wage: no acquisition cost; seasonal fee only.
 */
export const LABOR_ACQUISITION_COST: Record<LaborType, { min: number; max: number }> = {
  [LaborType.EnslavedPurchased]: { min: 300, max: 500  },  // £15-£25 sterling; 17th-century Carolina
  [LaborType.EnslavedHiredOut]:  { min: 0,   max: 0    },  // no purchase — seasonal rental only
  [LaborType.IndenturedBlack]:   { min: 80,  max: 160  },  // £4-£8 contract/transport fee
  [LaborType.IndenturedWhite]:   { min: 80,  max: 160  },  // £4-£8 contract/transport fee
  [LaborType.FreeWage]:          { min: 0,   max: 0    },  // hiring cost only
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
  // Depletion values halved from GDD v0.4 following playtesting —
  // original values caused field exhaustion in ~1.5 years vs. historical
  // 3-5 years. See GDD v0.5 Section 18 deviation log.
  [CropType.Tobacco]:     { organicMatter: -2,  nitrogen: -4,  soilFauna: -2,  moistureRetention: -1  },
  [CropType.Rice]:        { organicMatter: -2,  nitrogen: -3,  soilFauna: +1,  moistureRetention:  0  },  // wetland irrigated
  [CropType.Corn]:        { organicMatter: -1,  nitrogen: -2,  soilFauna: -1,  moistureRetention: -0.5 },
  [CropType.Cowpeas]:     { organicMatter: -1,  nitrogen: +8,  soilFauna: +2,  moistureRetention: +1  },  // nitrogen fixer
  [CropType.SweetPotato]: { organicMatter: -1,  nitrogen: -1,  soilFauna: +1,  moistureRetention: +1  },
  [CropType.Indigo]:      { organicMatter: -1,  nitrogen: -2,  soilFauna: -1,  moistureRetention: -0.5 },
  // Restoration values scaled up so rotation is viable — fallow N was +1
  // vs tobacco N draw of -8, requiring 8 fallow seasons per tobacco season.
  // Now proportional: fallow restores ~1 season of tobacco damage per season.
  [CropType.CoverCrop]:   { organicMatter: +6,  nitrogen: +8,  soilFauna: +6,  moistureRetention: +4  },
  [CropType.Fallow]:      { organicMatter: +3,  nitrogen: +4,  soilFauna: +4,  moistureRetention: +3  },
}

/**
 * Stump rot effects — applied for 1-2 seasons after clearing forested
 * or swamp land (Upland clearing is minimal and doesn't trigger this).
 *
 * Refined model (previously a single Soil Fauna penalty only):
 *
 * - Organic Matter: SLIGHT INCREASE. Decomposing slash, leaf litter,
 *   and root fragments left behind by clearing add organic material
 *   to the soil as they break down.
 * - Nitrogen: SLIGHT DECREASE. Soil microbes consuming the fresh,
 *   carbon-heavy woody debris temporarily draw down available
 *   nitrogen to fuel their own growth — a well-documented effect
 *   called "nitrogen immobilization."
 * - Soil Fauna: DECREASE (the original effect, retained). Removing
 *   the tree canopy and root network disrupts the soil structure
 *   and microbial/fungal habitat that had developed under forest
 *   cover. This is the dominant effect and the reason stump rot is
 *   net-negative for yield even though OM ticks up slightly.
 * - Moisture Retention: unaffected by stump rot itself (canopy loss's
 *   moisture effect is handled separately by terrain/weather).
 *
 * Net effect: a newly cleared tile is NOT simply "bad soil" — it has
 * decent raw organic material, but that material isn't yet accessible
 * to crops because the soil biology that processes it has been
 * disrupted. This resolves over STUMP_ROT_DURATION seasons as the
 * microbial community re-establishes.
 */
export const STUMP_ROT_EFFECTS = {
  organicMatter: +3,
  nitrogen:      -2,
  soilFauna:     -12,
}
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
// LAND CLEARING
// ---------------------------------------------------------------------------

/**
 * Total labor-units required to fully clear each terrain type.
 * Matches GDD Section 3.3 land clearing cost table.
 *
 * "Labor-units" is a pool that drains over time — see
 * LABOR_UNITS_PER_WORKER_PER_SEASON for the drain rate.
 */
export const LAND_CLEARING_COST: Record<TerrainType, number> = {
  [TerrainType.Upland]: 1,   // open/meadow — minimal clearing needed
  [TerrainType.Forest]: 3,   // most common starting land
  [TerrainType.Swamp]:  8,   // requires drainage; highest cost
}

/**
 * Cleared material (slash, stumps, brush) generated when a tile finishes
 * clearing — a one-time yield, separate from the ongoing stump rot effect.
 *
 * Each unit of cleared material can be applied to a tile as compost via
 * the "Compost cleared material" planner action, consuming one unit and
 * applying MANURE_APPLICATION_BOOST to the chosen tile.
 *
 * Upland (open meadow) produces none — there's no significant woody
 * material to clear. Forest produces a moderate amount; Swamp produces
 * the most, reflecting the larger biomass of wetland vegetation.
 *
 * This connects land-clearing to the existing manure/compost mechanic
 * (previously only reachable via the compost facility purchase) without
 * introducing a separate timber economy — selling cleared material for
 * cash is deferred to Phase 2+.
 */
export const CLEARED_MATERIAL_YIELD: Record<TerrainType, number> = {
  [TerrainType.Upland]: 0,
  [TerrainType.Forest]: 2,
  [TerrainType.Swamp]:  3,
}

/**
 * How many labor-units of clearing progress ONE worker contributes
 * per season.
 *
 * This is the single dial that controls clearing speed without
 * changing the season/turn structure. At 1.0, a Forest tile (3 units)
 * takes 3 worker-seasons total — e.g. 1 worker for 3 seasons, or 3
 * workers in 1 season. At 1.5, the same tile takes only 2 worker-seasons.
 *
 * Set to 1.5 based on playtesting: a single worker clears a Forest
 * tile in 2 seasons, which feels purposeful without being tedious.
 * Raise this further if clearing should feel faster; lower it if
 * clearing should remain a longer-term investment.
 */
export const LABOR_UNITS_PER_WORKER_PER_SEASON = 1.5

/**
 * Cost to purchase one additional tile (~2-3 acres) from the land market.
 *
 * Grounded in historical land patent pricing: 100-acre patents sold for
 * up to 3 pounds (60 shillings) in Virginia in the 1700s. Scaling down to
 * a ~2.5-acre tile and adjusting for the practical value of a ready
 * addition to an existing plantation cluster.
 * Source: virginiaplaces.org, "How Colonists Acquired Title to Land in Virginia"
 */
export const LAND_PARCEL_COST: Record<TerrainType, number> = {
  [TerrainType.Upland]: 60,
  [TerrainType.Forest]: 40,
  [TerrainType.Swamp]:  80,
}

// Water-adjacent parcels carry a price premium (GDD Section 3.2) but
// reduce shipping costs and are required for rice.
export const WATER_ADJACENT_PRICE_PREMIUM = 20

// ---------------------------------------------------------------------------
// CROPS — production values
// ---------------------------------------------------------------------------

/**
 * SCALE DEFINITION (grounded in historical research):
 *
 * One game tile represents approximately 2-3 acres of farmland.
 * This matches the documented late-17th-century rate at which a single
 * field worker could tend a tobacco crop plus provisions (roughly
 * 1.5-2 acres of tobacco, or up to ~3 acres of less labor-intensive crops).
 *
 * Source: Encyclopedia Virginia / Herndon, "Tobacco in Colonial Virginia" —
 * one worker tended ~1.5-2 acres of tobacco yielding 1,500-2,000 lbs/year,
 * plus 6-7 barrels of corn for provisioning.
 *
 * Practical implication: CROP_LABOR_TO_PLANT and CROP_LABOR_TO_HARVEST
 * below are calibrated so that ONE worker can fully tend ONE tile of
 * tobacco across a season (plant + tend + harvest), matching the
 * historical 1-worker-per-tile ratio for the primary cash crop.
 * Rice, being "very high" labor per the GDD, requires more workers per
 * tile — reflecting the much larger labor demands of wetland cultivation.
 */

/**
 * Labor-seasons required to plant one tile of each crop.
 */
export const CROP_LABOR_TO_PLANT: Record<CropType, number> = {
  [CropType.Tobacco]:     1,
  [CropType.Rice]:        2,
  [CropType.Corn]:        1,
  [CropType.Cowpeas]:     1,
  [CropType.SweetPotato]: 1,
  [CropType.Indigo]:      1,
  [CropType.CoverCrop]:   1,
  [CropType.Fallow]:      0,  // no labor needed — just leave the field
}

/**
 * Labor-seasons required to harvest one tile of each crop.
 */
export const CROP_LABOR_TO_HARVEST: Record<CropType, number> = {
  [CropType.Tobacco]:     1,
  [CropType.Rice]:        2,
  [CropType.Corn]:        1,
  [CropType.Cowpeas]:     1,
  [CropType.SweetPotato]: 1,
  [CropType.Indigo]:      1,
  [CropType.CoverCrop]:   0,  // not harvested — plowed back in
  [CropType.Fallow]:      0,
}

/**
 * Base yield per tile at full soil health (composite modifier = 1.0).
 * Actual yield = floor(base * soilModifier * weatherModifier).
 *
 * Scaled up 3x from GDD v0.4 to make unit economics viable at realistic
 * soil health levels. At good soil (modifier ~0.75), tobacco yields
 * 24 * 0.75 = 18 units ~ $216 gross before commission. With 4 workers
 * on hire-out at $240/year this leaves a meaningful margin.
 * At poor soil (modifier ~0.25) yield drops to 6 units = $72 gross,
 * below the annual labor cost — creating the economic crisis that
 * forces rotation.
 */
export const CROP_BASE_YIELD_PER_TILE: Record<CropType, number> = {
  [CropType.Tobacco]:     24,
  [CropType.Rice]:        30,
  [CropType.Corn]:        18,
  [CropType.Cowpeas]:     10,
  [CropType.SweetPotato]: 12,
  [CropType.Indigo]:      18,
  [CropType.CoverCrop]:   0,
  [CropType.Fallow]:      0,
}

/**
 * Seed economy — Phase 1 simple model.
 *
 * SEED_PURCHASE_COST: one-time cost to acquire seed stock for a crop.
 * After first purchase, seeds are perpetuated by harvest (Phase 1:
 * having seeds is a boolean flag; Phase 2 will track quantities).
 *
 * Cover crop seed stock is a one-time infrastructure purchase that
 * permanently unlocks cover cropping. Priced separately in the
 * infrastructure table.
 */
export const SEED_PURCHASE_COST: Partial<Record<CropType, number>> = {
  [CropType.Tobacco]:     15,   // small but meaningful first-season cost
  [CropType.Corn]:        8,
  [CropType.Cowpeas]:     6,
  [CropType.SweetPotato]: 8,
  [CropType.Indigo]:      12,
  [CropType.Rice]:        20,   // specialty seed; expensive
  // CoverCrop handled by COVER_CROP_SEED_STOCK_COST (infrastructure purchase)
}

// Cover crop seed stock — one-time infrastructure purchase
export const COVER_CROP_SEED_STOCK_COST = 120  // midpoint of GDD $80-200 range

// Compost facility — low-cost designated composting area
export const COMPOST_FACILITY_COST = 75  // midpoint of GDD $50-100 range



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
 *
 * Pricing is anchored to historical commodity values, converted to
 * game dollars at an approximate rate of $1 ≈ 1 shilling.
 *
 * Tobacco: historically ranged from under 1 pence/lb (price crashes) to
 * 2-3 shillings/lb in profitable early years, generally settling around
 * 1-3 pence/lb through most of the colonial period. A game "unit" is
 * ~100 lbs, so at ~2 pence/lb that's roughly $1.65/unit at the low end —
 * but tobacco was THE high-value export, so we set the base at $12/unit
 * to reflect its role as the primary cash crop and to keep gameplay
 * rewarding. The high MARKET_VOLATILITY below reflects the documented
 * extreme price swings (3 shillings/lb down to under 1 penny/lb).
 * Source: Access Genealogy, "Tobacco Production, Trend of Prices, and Exports"
 *
 * Rice: Charleston wholesale prices ran 12-20 shillings/cwt (100 lbs) in
 * 1701-1707, rising to 30-60+ shillings/cwt by the 1720s-30s. At ~15
 * shillings/cwt early, that's about $0.15/lb, or ~$15/unit (100 lb unit).
 * We set the base slightly below this at $10/unit to represent the
 * earlier, lower end of the period range.
 * Source: Historical Statistics of the United States, Table Eg299
 *
 * Corn: a subsistence crop, not a major export — kept low to reflect its
 * role as provisioning rather than cash income.
 *
 * Indigo and Cowpeas/Sweet Potato: indigo becomes commercially significant
 * later in the period; kept moderate. Cowpeas/sweet potatoes are
 * subsistence crops with minimal market value, per GDD Section 7.1.
 */
export const MARKET_BASE_PRICE: Partial<Record<CropType, number>> = {
  [CropType.Tobacco]:     12,   // primary cash crop — high value, volatile
  [CropType.Rice]:        10,   // Charleston wholesale ~12-20 sh/cwt early period
  [CropType.Indigo]:      7,
  [CropType.Corn]:        2,    // subsistence crop; mainly for provisioning
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
export const STORAGE_CAPACITY_SMOKEHOUSE   = 300   // handles ~10-tile harvest at good soil
export const STORAGE_CAPACITY_STOREHOUSE   = 600   // handles large multi-crop operations

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

/**
 * Tending mitigation — how much a worker assigned to "Tend" reduces
 * the weather penalty on that tile this season.
 *
 * Per GDD Section 2 (Cultivation phase): "Manage labor conditions,
 * respond to weather/disease events, irrigate or treat fields." Tending
 * represents active intervention — irrigating during drought, propping
 * up storm-damaged plants, clearing standing water after heavy rain.
 *
 * Each tending worker closes part of the gap between the weather's
 * yield modifier and 1.0 (no penalty). E.g. if Drought yield modifier
 * is 0.45 and one worker tends with a 0.15 mitigation-per-worker rate,
 * the effective modifier becomes 0.45 + 0.15 = 0.60 for that tile.
 *
 * Capped at TEND_MAX_MITIGATION total regardless of how many workers
 * are assigned — tending helps, but can't fully cancel severe weather
 * (a drought is still a drought even with extra hands).
 *
 * Has no effect on Normal weather (nothing to mitigate) or EarlyFrost
 * (frost destroys the crop outright; tending can't prevent that).
 */
export const TEND_MITIGATION_PER_WORKER = 0.15
export const TEND_MAX_MITIGATION        = 0.35  // up to ~3 workers' worth of benefit

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
