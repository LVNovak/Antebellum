/**
 * soil.ts
 *
 * The soil food web engine.
 *
 * This file handles all soil health calculations:
 *   - Applying crop draw-down each season
 *   - Applying restoration from fallow and cover crops
 *   - Computing the composite yield modifier for a tile
 *   - Generating the qualitative hint the player sees (never raw numbers)
 *
 * The four soil values (OM, N, SF, MR) are internal engine data.
 * The player sees only qualitative language that sharpens over time.
 * See GDD Section 7.2 and 13.3.
 *
 * Performance: all soil updates are a single O(n) pass over all tiles.
 * No recursion. Safe for 20-50 tiles on any modern device.
 */

import {
  SoilHealth,
  Tile,
  CropType,
  WeatherEvent,
} from './types'

import {
  SOIL_DRAW_DOWN,
  SOIL_YIELD_WEIGHTS,
  SOIL_SINGLE_VALUE_WARNING_THRESHOLD,
  SOIL_EXHAUSTION_THRESHOLD,
  STUMP_ROT_SOIL_FAUNA_PENALTY,
  MANURE_APPLICATION_BOOST,
} from './constants'

// ---------------------------------------------------------------------------
// YIELD CALCULATION
// ---------------------------------------------------------------------------

/**
 * Computes the composite yield modifier for a tile.
 *
 * This number (0.0 to 1.0) is multiplied against the crop's base yield
 * to get the actual units harvested.
 *
 * Formula: weighted average of the four normalized soil values.
 * Soil Fauna acts as a multiplier on Organic Matter conversion.
 * Moisture Retention gates Nitrogen effectiveness.
 *
 * Example: a tile with all four values at 80 returns roughly 0.80,
 * meaning 80% of the maximum possible yield for that crop.
 */
export function computeYieldModifier(soil: SoilHealth): number {
  // Normalize each value to 0-1 range
  const om = soil.organicMatter     / 100
  const n  = soil.nitrogen          / 100
  const sf = soil.soilFauna         / 100
  const mr = soil.moistureRetention / 100

  // Soil Fauna multiplies how much OM is actually available to plants.
  // Low SF = OM is there but can't be converted.
  const effectiveOM = om * (0.5 + 0.5 * sf)  // SF provides 0-50% bonus to OM

  // Moisture Retention gates Nitrogen mobility.
  // Dry soil locks nitrogen even when it's present.
  const effectiveN = n * (0.4 + 0.6 * mr)  // MR provides 0-60% bonus to N

  // Weighted average using the formula from the GDD
  const modifier =
    effectiveOM * SOIL_YIELD_WEIGHTS.organicMatter     +
    effectiveN  * SOIL_YIELD_WEIGHTS.nitrogen          +
    sf          * SOIL_YIELD_WEIGHTS.soilFauna         +
    mr          * SOIL_YIELD_WEIGHTS.moistureRetention

  // Clamp to 0-1 just in case of floating point overshoot
  return Math.max(0, Math.min(1, modifier))
}

// ---------------------------------------------------------------------------
// SEASONAL SOIL UPDATE
// ---------------------------------------------------------------------------

/**
 * Applies one season's worth of soil changes to a tile.
 *
 * Call this once per tile during the season resolution pass.
 * Returns a new SoilHealth object — does not mutate the original.
 *
 * Applies:
 *   1. Crop draw-down (or restoration if fallow/cover crop)
 *   2. Stump rot penalty if active
 *   3. Weather effects on soil
 *   4. Manure application if used this season
 *
 * All values are clamped to 0-100 after each update.
 */
export function applySeasonalSoilUpdate(
  tile: Tile,
  weather: WeatherEvent,
  manureApplied: boolean
): SoilHealth {
  const soil = { ...tile.soil }  // copy — don't mutate the original

  // Step 1: Apply crop draw-down (or fallow/cover restoration)
  if (tile.currentCrop !== null) {
    const drawDown = SOIL_DRAW_DOWN[tile.currentCrop]
    soil.organicMatter     += drawDown.organicMatter
    soil.nitrogen          += drawDown.nitrogen
    soil.soilFauna         += drawDown.soilFauna
    soil.moistureRetention += drawDown.moistureRetention
  }

  // Step 2: Stump rot — suppresses SF for 1-2 seasons after clearing
  if (tile.hasStumpRot) {
    soil.soilFauna += STUMP_ROT_SOIL_FAUNA_PENALTY
  }

  // Step 3: Weather effects on soil
  soil.moistureRetention += WEATHER_SOIL_EFFECTS[weather].moistureRetention
  soil.organicMatter     += WEATHER_SOIL_EFFECTS[weather].organicMatter
  soil.nitrogen          += WEATHER_SOIL_EFFECTS[weather].nitrogen
  soil.soilFauna         += WEATHER_SOIL_EFFECTS[weather].soilFauna

  // Step 4: Manure application from compost facility improvement
  if (manureApplied) {
    soil.organicMatter     += MANURE_APPLICATION_BOOST.organicMatter
    soil.nitrogen          += MANURE_APPLICATION_BOOST.nitrogen
    soil.soilFauna         += MANURE_APPLICATION_BOOST.soilFauna
    soil.moistureRetention += MANURE_APPLICATION_BOOST.moistureRetention
  }

  // Clamp all values to valid range 0-100
  return clampSoil(soil)
}

/**
 * Weather effects on soil values per season.
 * These are additive — applied on top of the crop draw-down.
 */
const WEATHER_SOIL_EFFECTS: Record<WeatherEvent, Partial<SoilHealth> & SoilHealth> = {
  [WeatherEvent.Normal]:     { organicMatter:  0, nitrogen:  0, soilFauna:  0, moistureRetention:  0 },
  [WeatherEvent.Drought]:    { organicMatter:  0, nitrogen:  0, soilFauna: -2, moistureRetention: -20 },
  [WeatherEvent.HeavyRain]:  { organicMatter: +2, nitrogen: -3, soilFauna:  0, moistureRetention:  +5 },  // N leaches out
  [WeatherEvent.Storm]:      { organicMatter: +2, nitrogen: -1, soilFauna: -3, moistureRetention:  +3 },  // riverside OM boost; SF dip
  [WeatherEvent.EarlyFrost]: { organicMatter:  0, nitrogen: +2, soilFauna: -1, moistureRetention:   0 },  // N preserved (crop didn't consume it)
}

// ---------------------------------------------------------------------------
// SOIL STATUS CHECKS
// ---------------------------------------------------------------------------

/**
 * Returns true if the tile's soil is exhausted.
 * An exhausted tile produces near-zero yield until rehabilitated.
 * Rehabilitation takes 2-3 seasons of fallow or cover cropping.
 */
export function isSoilExhausted(soil: SoilHealth): boolean {
  return (
    soil.organicMatter     < SOIL_EXHAUSTION_THRESHOLD &&
    soil.nitrogen          < SOIL_EXHAUSTION_THRESHOLD &&
    soil.soilFauna         < SOIL_EXHAUSTION_THRESHOLD &&
    soil.moistureRetention < SOIL_EXHAUSTION_THRESHOLD
  )
}

/**
 * Returns true if any single soil value has hit a critical low.
 * Used to trigger a qualitative warning hint to the player.
 */
export function hasCriticalSoilDeficiency(soil: SoilHealth): boolean {
  return (
    soil.organicMatter     < SOIL_SINGLE_VALUE_WARNING_THRESHOLD ||
    soil.nitrogen          < SOIL_SINGLE_VALUE_WARNING_THRESHOLD ||
    soil.soilFauna         < SOIL_SINGLE_VALUE_WARNING_THRESHOLD ||
    soil.moistureRetention < SOIL_SINGLE_VALUE_WARNING_THRESHOLD
  )
}

/**
 * Returns which specific values are critically low.
 * Used to pick the right qualitative hint for the player.
 */
export function getCriticalDeficiencies(soil: SoilHealth): string[] {
  const deficiencies: string[] = []
  if (soil.organicMatter     < SOIL_SINGLE_VALUE_WARNING_THRESHOLD) deficiencies.push('organic matter')
  if (soil.nitrogen          < SOIL_SINGLE_VALUE_WARNING_THRESHOLD) deficiencies.push('nitrogen')
  if (soil.soilFauna         < SOIL_SINGLE_VALUE_WARNING_THRESHOLD) deficiencies.push('soil life')
  if (soil.moistureRetention < SOIL_SINGLE_VALUE_WARNING_THRESHOLD) deficiencies.push('moisture')
  return deficiencies
}

// ---------------------------------------------------------------------------
// QUALITATIVE HINTS — the player-facing soil feedback system
// ---------------------------------------------------------------------------

/**
 * Returns a qualitative hint about a tile's soil health.
 * The language sharpens as the player gains experience (more seasons played).
 *
 * The player NEVER sees raw numbers — only this hint text.
 * See GDD Section 13.3.
 *
 * @param soil       - the tile's current soil values
 * @param crop       - what was planted (or null if fallow)
 * @param seasonsPlayed - total seasons the player has completed (affects hint clarity)
 */
export function getSoilHint(
  soil: SoilHealth,
  crop: CropType | null,
  seasonsPlayed: number
): string | null {
  const yieldModifier  = computeYieldModifier(soil)
  const exhausted      = isSoilExhausted(soil)
  const hasDeficiency  = hasCriticalSoilDeficiency(soil)
  const deficiencies   = getCriticalDeficiencies(soil)

  // No hint needed for healthy soil
  if (!exhausted && !hasDeficiency && yieldModifier > 0.70) return null

  if (exhausted) {
    return EXHAUSTION_HINTS[getExperienceStage(seasonsPlayed)]
  }

  if (hasDeficiency) {
    return getDeficiencyHint(deficiencies, crop, seasonsPlayed)
  }

  // Moderate decline — low yield but not yet critical
  if (yieldModifier < 0.50) {
    return DECLINE_HINTS[getExperienceStage(seasonsPlayed)]
  }

  return null
}

/**
 * Maps seasons played to an experience stage.
 * Controls which tier of hint language the player sees.
 */
function getExperienceStage(seasonsPlayed: number): 'early' | 'mid' | 'late' {
  if (seasonsPlayed <= 4)  return 'early'
  if (seasonsPlayed <= 10) return 'mid'
  return 'late'
}

type ExperienceStage = 'early' | 'mid' | 'late'

const EXHAUSTION_HINTS: Record<ExperienceStage, string> = {
  early: 'This field produced almost nothing this season.',
  mid:   'The old-timers say this ground is worn out. It needs a long rest.',
  late:  'This parcel is exhausted. Two or three seasons of cover crops are the only remedy.',
}

const DECLINE_HINTS: Record<ExperienceStage, string> = {
  early: 'Yields here have been disappointing.',
  mid:   'This field is tiring. You\'ve worked it hard.',
  late:  'Yields are declining steadily. Rotation or fallow before next season would help.',
}

function getDeficiencyHint(
  deficiencies: string[],
  crop: CropType | null,
  seasonsPlayed: number
): string {
  const stage = getExperienceStage(seasonsPlayed)
  const primaryDeficiency = deficiencies[0]  // report the worst one

  if (stage === 'early') {
    return 'Something seems wrong with this field — it isn\'t producing well.'
  }

  if (stage === 'mid') {
    if (primaryDeficiency === 'nitrogen') {
      return 'The soil here is worn thin. Some planters say cowpeas bring it back.'
    }
    if (primaryDeficiency === 'moisture') {
      return 'This ground bakes dry quickly. It needs careful tending in dry seasons.'
    }
    if (primaryDeficiency === 'soil life') {
      return 'The earth here feels dead underfoot. It hasn\'t rested in a long time.'
    }
    return 'This field is struggling. It may need a season without a crop.'
  }

  // Late stage — specific and predictive
  if (primaryDeficiency === 'nitrogen') {
    const cropName = crop ? crop.toLowerCase() : 'this crop'
    return `${cropName} has stripped the nitrogen from this parcel. Cowpeas or legumes next season will begin to restore it.`
  }
  if (primaryDeficiency === 'moisture') {
    return 'Moisture retention here is critically low. Drought will hit this parcel much harder than average.'
  }
  if (primaryDeficiency === 'soil life') {
    return 'The microbial life in this soil is nearly gone. Even with good organic matter present, nutrients can\'t reach the roots. Rest this field.'
  }
  if (primaryDeficiency === 'organic matter') {
    return 'This soil has almost no organic material left. Without it, nothing else works. Manure and fallow — that\'s what it needs.'
  }

  return 'This parcel is in serious decline across multiple dimensions. It needs extended rehabilitation.'
}

// ---------------------------------------------------------------------------
// UTILITIES
// ---------------------------------------------------------------------------

/**
 * Clamps all four soil values to the valid range 0-100.
 * Call this after every update to prevent values from going out of bounds.
 */
function clampSoil(soil: SoilHealth): SoilHealth {
  return {
    organicMatter:     Math.max(0, Math.min(100, Math.round(soil.organicMatter))),
    nitrogen:          Math.max(0, Math.min(100, Math.round(soil.nitrogen))),
    soilFauna:         Math.max(0, Math.min(100, Math.round(soil.soilFauna))),
    moistureRetention: Math.max(0, Math.min(100, Math.round(soil.moistureRetention))),
  }
}

/**
 * Returns a composite 0-100 soil health score for UI display (color coding).
 * The player sees a color (green/yellow/red/grey) derived from this number,
 * but never the number itself.
 */
export function getCompositeScore(soil: SoilHealth): number {
  return Math.round(computeYieldModifier(soil) * 100)
}

/**
 * Returns the color category for a tile based on its composite soil score.
 * Maps to the CSS color tokens in tailwind.config.js.
 */
export function getSoilColorCategory(soil: SoilHealth): 'good' | 'fair' | 'poor' | 'exhausted' {
  if (isSoilExhausted(soil)) return 'exhausted'
  const score = getCompositeScore(soil)
  if (score >= 70) return 'good'
  if (score >= 45) return 'fair'
  return 'poor'
}
