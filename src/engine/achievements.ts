/**
 * achievements.ts
 *
 * Trophy and achievement tracking.
 *
 * Achievements are earned through sustained play patterns — not triggered
 * by cutscenes or story moments. They are checked at the end of every season
 * and awarded silently. The trophy ledger is a record, not a reward screen.
 *
 * See GDD Section 12 for the full trophy list and design philosophy.
 */

import { GameState, Trophy, Season, LaborType } from './types'
import { ACHIEVEMENT_THRESHOLDS } from './constants'
import { computeConditionsIndex } from './labor'

// ---------------------------------------------------------------------------
// MAIN CHECK FUNCTION
// ---------------------------------------------------------------------------

/**
 * Checks all achievement conditions against the current game state.
 * Returns any trophies earned this season that haven't been earned before.
 *
 * Called once per season at the end of resolveSeasonEnd().
 */
export function checkAchievements(state: GameState): Trophy[] {
  const newTrophies: Trophy[] = []
  const alreadyEarned = new Set(state.trophies.map(t => t.id))

  for (const checker of ACHIEVEMENT_CHECKERS) {
    if (alreadyEarned.has(checker.id)) continue  // already earned; skip

    if (checker.check(state)) {
      newTrophies.push({
        id:             checker.id,
        name:           checker.name,
        condition:      checker.conditionText,
        earnedOnYear:   state.currentYear,
        earnedOnSeason: state.currentSeason,
      })
    }
  }

  return newTrophies
}

// ---------------------------------------------------------------------------
// ACHIEVEMENT DEFINITIONS
// ---------------------------------------------------------------------------

/**
 * Each achievement is defined by:
 *   - id: unique string key
 *   - name: display name shown in the trophy ledger
 *   - conditionText: plain-English description of how it was earned
 *   - check: function that returns true when the condition is met
 */
interface AchievementChecker {
  id:            string
  name:          string
  conditionText: string
  check:         (state: GameState) => boolean
}

const ACHIEVEMENT_CHECKERS: AchievementChecker[] = [

  // ── The Planter ──────────────────────────────────────────────────────────
  {
    id:   'the-planter',
    name: 'The Planter',
    conditionText: `Survived ${ACHIEVEMENT_THRESHOLDS.survivorYears} consecutive years without foreclosure.`,
    check: (state) => {
      return state.currentYear > ACHIEVEMENT_THRESHOLDS.survivorYears
    },
  },

  // ── The Ruin ─────────────────────────────────────────────────────────────
  {
    id:   'the-ruin',
    name: 'The Ruin',
    conditionText: 'The plantation was lost to foreclosure.',
    check: (state) => {
      // Triggered when total debt exceeds total assets by a wide margin
      const totalDebt =
        state.finances.factorAdvanceDebt +
        state.finances.mortgageDebt +
        state.finances.personalNoteDebt
      return totalDebt > 0 && state.finances.cashOnHand < 0
    },
  },

  // ── Debt's End ───────────────────────────────────────────────────────────
  {
    id:   'debts-end',
    name: "Debt's End",
    conditionText: `Cleared all debt and operated cash-positive for ${ACHIEVEMENT_THRESHOLDS.debtFreeYears} consecutive years.`,
    check: (state) => {
      const isDebtFree =
        state.finances.factorAdvanceDebt <= 0 &&
        state.finances.mortgageDebt      <= 0 &&
        state.finances.personalNoteDebt  <= 0

      const isCashPositive = state.finances.cashOnHand > 0

      // We track consecutive debt-free years via a running counter in state
      // For Phase 1 this is a simplified check; Phase 2 adds the counter
      return isDebtFree && isCashPositive && state.currentYear >= ACHIEVEMENT_THRESHOLDS.debtFreeYears
    },
  },

  // ── The Freedman's Ledger ─────────────────────────────────────────────────
  {
    id:   'freedmans-ledger',
    name: "The Freedman's Ledger",
    conditionText: `Maintained a Conditions Index above ${ACHIEVEMENT_THRESHOLDS.conditionsIndexThreshold} for ${ACHIEVEMENT_THRESHOLDS.conditionsIndexYears} consecutive years.`,
    check: (state) => {
      // Requires sustained high conditions over many years
      // Phase 1: simplified — check current index and year threshold
      // Phase 2: track a running consecutive-years counter in GameState
      return (
        state.conditionsIndex >= ACHIEVEMENT_THRESHOLDS.conditionsIndexThreshold &&
        state.currentYear     >= ACHIEVEMENT_THRESHOLDS.conditionsIndexYears
      )
    },
  },

  // ── The Abolitionist Path ─────────────────────────────────────────────────
  {
    id:   'abolitionist-path',
    name: 'The Abolitionist Path',
    conditionText: `Operated exclusively on free and indentured labor for ${ACHIEVEMENT_THRESHOLDS.abolitionistYears} consecutive years while remaining solvent.`,
    check: (state) => {
      // No enslaved workers of any kind
      const hasEnslavedWorkers = state.workers.some(
        w => w.laborType === LaborType.EnslavedPurchased ||
             w.laborType === LaborType.EnslavedHiredOut
      )

      const isSolvent = state.finances.cashOnHand >= 0

      return (
        !hasEnslavedWorkers &&
        isSolvent &&
        state.currentYear >= ACHIEVEMENT_THRESHOLDS.abolitionistYears
      )
    },
  },

  // ── The Exhausted Earth ───────────────────────────────────────────────────
  {
    id:   'exhausted-earth',
    name: 'The Exhausted Earth',
    conditionText: 'Farmed a parcel until all four soil values reached zero.',
    check: (state) => {
      return state.tiles.some(tile =>
        tile.isCleared &&
        tile.soil.organicMatter     === 0 &&
        tile.soil.nitrogen          === 0 &&
        tile.soil.soilFauna         === 0 &&
        tile.soil.moistureRetention === 0
      )
    },
  },

  // ── The Rotation ─────────────────────────────────────────────────────────
  {
    id:   'the-rotation',
    name: 'The Rotation',
    conditionText: `Maintained all cleared parcels above ${ACHIEVEMENT_THRESHOLDS.rotationSoilThreshold} composite soil health for ${ACHIEVEMENT_THRESHOLDS.rotationYears} consecutive years.`,
    check: (state) => {
      // All cleared tiles must be above the threshold
      const clearedTiles = state.tiles.filter(t => t.isCleared)
      if (clearedTiles.length === 0) return false

      const allAboveThreshold = clearedTiles.every(tile => {
        const composite = computeCompositeSoilScore(tile.soil)
        return composite >= ACHIEVEMENT_THRESHOLDS.rotationSoilThreshold
      })

      return allAboveThreshold && state.currentYear >= ACHIEVEMENT_THRESHOLDS.rotationYears
    },
  },

  // ── The Cooper's Dozen ────────────────────────────────────────────────────
  {
    id:   'coopers-dozen',
    name: "The Cooper's Dozen",
    conditionText: 'Stored and sold 12 seasons of crops with zero spoilage loss.',
    check: (state) => {
      // Tracked via event log — count seasons with no spoilage events
      const spoilageEvents = state.eventLog.filter(
        e => e.category === 'Economic' && e.title === 'Crop Spoilage'
      )
      const totalSeasons = (state.currentYear - 1) * 4 + seasonToIndex(state.currentSeason)
      return totalSeasons >= 12 && spoilageEvents.length === 0
    },
  },

  // ── The Paternalist ───────────────────────────────────────────────────────
  {
    id:   'the-paternalist',
    name: 'The Paternalist',
    conditionText: 'Maintained high housing quality and a Conditions Index above 60 for 5 years with a large enslaved workforce.',
    check: (state) => {
      const enslavedCount = state.workers.filter(
        w => w.laborType === LaborType.EnslavedPurchased ||
             w.laborType === LaborType.EnslavedHiredOut
      ).length

      // "Large" means more than 10 enslaved workers
      if (enslavedCount < 10) return false

      // All cabins must be in Good or Fair condition
      const allCabinsGoodOrFair = state.cabins.every(
        c => c.condition === 'Good' || c.condition === 'Fair'
      )

      return (
        allCabinsGoodOrFair &&
        state.conditionsIndex >= 60 &&
        state.currentYear     >= 5
      )
    },
  },

]

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/**
 * Computes a 0-100 composite soil score from the four soil values.
 * Mirrors the logic in soil.ts without importing it (avoids circular deps).
 */
function computeCompositeSoilScore(soil: {
  organicMatter: number
  nitrogen: number
  soilFauna: number
  moistureRetention: number
}): number {
  const om = soil.organicMatter     / 100
  const n  = soil.nitrogen          / 100
  const sf = soil.soilFauna         / 100
  const mr = soil.moistureRetention / 100
  const effectiveOM = om * (0.5 + 0.5 * sf)
  const effectiveN  = n  * (0.4 + 0.6 * mr)
  return Math.round(
    (effectiveOM * 0.30 + effectiveN * 0.35 + sf * 0.20 + mr * 0.15) * 100
  )
}

function seasonToIndex(season: Season): number {
  return { Spring: 1, Summer: 2, Autumn: 3, Winter: 4 }[season]
}
