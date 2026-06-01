/**
 * labor.ts
 *
 * All labor-related calculations for the game engine.
 *
 * Handles:
 *   - Computing effective productivity for a worker (health + cabin condition)
 *   - Applying seasonal health changes (from food, housing, weather, workload)
 *   - Computing the Conditions Index for enslaved workers
 *   - Checking whether upkeep requirements are met
 *   - Determining resistance event probabilities
 *
 * Nothing in this file touches the UI.
 * Input: current workers, cabins, supplies. Output: updated workers + events.
 */

import {
  Worker,
  Cabin,
  HealthLevel,
  LaborType,
  CabinCondition,
  GameEvent,
  Season,
} from './types'

import {
  HEALTH_PRODUCTIVITY,
  CABIN_CONDITION_PRODUCTIVITY,
  CABIN_CONDITION_DISEASE_RISK,
  OVERCROWDING_DISEASE_RISK_PER_EXTRA,
  OVERCROWDING_PRODUCTIVITY_PER_EXTRA,
  DISEASE_SPREAD_BASE_CHANCE,
  CABIN_CAPACITY,
} from './constants'

// ---------------------------------------------------------------------------
// PRODUCTIVITY
// ---------------------------------------------------------------------------

/**
 * Returns the effective productivity multiplier for a single worker.
 *
 * This combines their individual health level with the condition of
 * the cabin they live in. Both factors affect output.
 *
 * Example: a Weak worker (0.60) in a Poor cabin (0.80) = 0.48 effective output.
 */
export function getWorkerProductivity(worker: Worker, cabin: Cabin | null): number {
  const healthMultiplier = HEALTH_PRODUCTIVITY[worker.health]

  // If the worker has no assigned cabin (shouldn't happen in normal play),
  // use a penalty as if they're in a Damaged cabin
  const cabinMultiplier = cabin
    ? CABIN_CONDITION_PRODUCTIVITY[cabin.condition]
    : CABIN_CONDITION_PRODUCTIVITY[CabinCondition.Damaged]

  // Overcrowding penalty — applied per extra worker above cabin capacity
  const overcrowding = Math.max(0, cabin ? cabin.occupants.length - CABIN_CAPACITY : 0)
  const overcrowdingPenalty = overcrowding * OVERCROWDING_PRODUCTIVITY_PER_EXTRA

  return Math.max(0, healthMultiplier * cabinMultiplier - overcrowdingPenalty)
}

/**
 * Returns the total productive labor-seasons available this season.
 *
 * Each healthy worker with a task assigned contributes their effective
 * productivity toward that task. This total drives how much clearing,
 * planting, and harvesting gets done.
 */
export function getTotalLaborOutput(
  workers: Worker[],
  getCabinForWorker: (workerId: string) => Cabin | null
): number {
  return workers
    .filter(w => w.assignedTask !== null && w.assignedTask.type !== 'Rest')
    .reduce((total, worker) => {
      const cabin = getCabinForWorker(worker.id)
      return total + getWorkerProductivity(worker, cabin)
    }, 0)
}

// ---------------------------------------------------------------------------
// HEALTH UPDATES
// ---------------------------------------------------------------------------

/**
 * Result of applying seasonal health changes to all workers.
 */
export interface LaborHealthResult {
  updatedWorkers: Worker[]
  events: Omit<GameEvent, 'id' | 'season' | 'year'>[]
}

/**
 * Applies one season's worth of health changes to all workers.
 *
 * Health is affected by:
 *   - Food (corn provision): missing food = health decline
 *   - Blankets: missing blankets in cold seasons = health decline
 *   - Cabin condition: poor housing degrades health
 *   - Overcrowding: spreads disease
 *   - Workload: overworked workers decline; resting workers recover
 *   - Weather: storms can expose and harm workers
 *
 * Returns updated workers and any events triggered (illness outbreak, etc.)
 */
export function applySeasonalHealthChanges(params: {
  workers:          Worker[]
  cabins:           Cabin[]
  cornAvailable:    number     // total corn units available this season
  blanketsAvailable: number
  season:           Season
  weatherWasStorm:  boolean
}): LaborHealthResult {
  const { workers, cabins, cornAvailable, blanketsAvailable, season, weatherWasStorm } = params

  // Figure out how much provision each worker actually gets
  const cornPerWorker     = workers.length > 0 ? cornAvailable     / workers.length : 0
  const blanketsPerWorker = workers.length > 0 ? blanketsAvailable / workers.length : 0
  const isColdSeason      = season === Season.Winter || season === Season.Autumn

  // Map cabins by id for quick lookup — used by getWorkerProductivity callers
  const _cabinById = new Map(cabins.map(c => [c.id, c]))  // available for Phase 2 expansion
  void _cabinById

  const updatedWorkers: Worker[] = []
  const events: Omit<GameEvent, 'id' | 'season' | 'year'>[] = []
  let illnessOutbreakTriggered = false

  for (const worker of workers) {
    let health = worker.health

    // --- Factors that worsen health ---

    const isHungry  = cornPerWorker < 1.0
    const isCold    = isColdSeason && blanketsPerWorker < 0.25
    const isResting = worker.assignedTask?.type === 'Rest'

    // Find which cabin this worker is in
    const cabin = cabins.find(c => c.occupants.includes(worker.id)) ?? null

    const isOvercrowded = cabin !== null &&
      cabin.occupants.length > CABIN_CAPACITY

    const hasBadHousing = cabin === null ||
      cabin.condition === CabinCondition.Poor ||
      cabin.condition === CabinCondition.Damaged

    // Check for storm exposure — workers without adequate shelter take a hit
    const isStormExposed = weatherWasStorm && hasBadHousing

    // Count how many negative factors apply
    const stressFactors = [isHungry, isCold, isOvercrowded, hasBadHousing, isStormExposed]
      .filter(Boolean).length

    if (stressFactors >= 3) {
      // Multiple stressors: health declines one full level
      health = declineHealth(health)
    } else if (stressFactors >= 1) {
      // Single stressor: health declines probabilistically
      const declineChance = stressFactors * 0.25  // 25% per stressor
      if (Math.random() < declineChance) {
        health = declineHealth(health)
      }
    }

    // --- Disease spread check ---
    if (cabin && health === HealthLevel.Sick || health === HealthLevel.VerySick) {
      const cabinConditionRiskMultiplier = cabin
        ? CABIN_CONDITION_DISEASE_RISK[cabin.condition]
        : CABIN_CONDITION_DISEASE_RISK[CabinCondition.Damaged]

      const overcrowding = cabin ? Math.max(0, cabin.occupants.length - CABIN_CAPACITY) : 0
      const overcrowdingRisk = overcrowding * OVERCROWDING_DISEASE_RISK_PER_EXTRA

      const spreadChance = DISEASE_SPREAD_BASE_CHANCE * cabinConditionRiskMultiplier + overcrowdingRisk

      if (Math.random() < spreadChance && !illnessOutbreakTriggered) {
        illnessOutbreakTriggered = true
        events.push({
          category: 'Labor',
          title: 'Illness Outbreak',
          description: 'Sickness is spreading through the quarters. Several workers have fallen ill.',
          effects: ['Labor productivity reduced this season', 'Provisioning costs may spike'],
        })
      }
    }

    // --- Factors that improve health ---

    const wellFed      = cornPerWorker >= 1.0
    const wellCovered  = !isColdSeason || blanketsPerWorker >= 0.25
    const goodHousing  = cabin !== null &&
      (cabin.condition === CabinCondition.Good || cabin.condition === CabinCondition.Fair)
    const lightWorkload = isResting

    const recoveryFactors = [wellFed, wellCovered, goodHousing, lightWorkload]
      .filter(Boolean).length

    if (stressFactors === 0 && recoveryFactors >= 3) {
      // Good conditions: health improves one level
      health = improveHealth(health)
    } else if (stressFactors === 0 && recoveryFactors >= 2) {
      // Adequate conditions: health improves probabilistically
      if (Math.random() < 0.40) {
        health = improveHealth(health)
      }
    }

    updatedWorkers.push({ ...worker, health })
  }

  return { updatedWorkers, events }
}

// ---------------------------------------------------------------------------
// CONDITIONS INDEX
// ---------------------------------------------------------------------------

/**
 * Computes the aggregate Conditions Index for all enslaved workers.
 *
 * The Conditions Index (0-100) reflects the overall welfare of the
 * enslaved labor force. It's derived from each worker's individualScore,
 * which is updated by cabin quality, food provision, workload, and events.
 *
 * Low Conditions Index triggers resistance events and productivity penalties.
 * See GDD Section 5.5.
 */
export function computeConditionsIndex(workers: Worker[]): number {
  const enslaved = workers.filter(
    w => w.laborType === LaborType.EnslavedPurchased ||
         w.laborType === LaborType.EnslavedHiredOut
  )

  if (enslaved.length === 0) return 100  // no enslaved workers = no index to track

  const total = enslaved.reduce((sum, w) => sum + w.individualScore, 0)
  return Math.round(total / enslaved.length)
}

/**
 * Determines the probability of a resistance event this season.
 * Higher Conditions Index = lower probability.
 * Also affected by proximity to free states (simplified in Phase 1).
 */
export function getResistanceProbability(conditionsIndex: number): number {
  if (conditionsIndex >= 70) return 0.02  // 2% — rare even with good conditions
  if (conditionsIndex >= 50) return 0.10  // 10%
  if (conditionsIndex >= 30) return 0.25  // 25%
  return 0.45                              // 45% — very likely with poor conditions
}

/**
 * Returns whether the Conditions Index is low enough to trigger a warning.
 */
export function isConditionsIndexCritical(conditionsIndex: number): boolean {
  return conditionsIndex < 30
}

// ---------------------------------------------------------------------------
// UPKEEP VALIDATION
// ---------------------------------------------------------------------------

/**
 * Checks whether the plantation can meet its labor upkeep requirements.
 * Returns a breakdown of what's sufficient and what's short.
 */
export function checkUpkeepRequirements(params: {
  workerCount:   number
  cornOnHand:    number
  cashOnHand:    number
  blanketsOnHand: number
}): {
  canMeetCorn:     boolean
  canMeetCash:     boolean
  canMeetBlankets: boolean
  cornShortfall:   number
  cashShortfall:   number
  blanketShortfall: number
} {
  const { workerCount, cornOnHand, cashOnHand, blanketsOnHand } = params

  // From constants: 1 corn, $1 clothing, 0.25 blankets per worker per season
  const cornNeeded     = workerCount * 1
  const cashNeeded     = workerCount * 1
  const blanketsNeeded = workerCount * 0.25

  return {
    canMeetCorn:     cornOnHand     >= cornNeeded,
    canMeetCash:     cashOnHand     >= cashNeeded,
    canMeetBlankets: blanketsOnHand >= blanketsNeeded,
    cornShortfall:   Math.max(0, cornNeeded     - cornOnHand),
    cashShortfall:   Math.max(0, cashNeeded     - cashOnHand),
    blanketShortfall: Math.max(0, blanketsNeeded - blanketsOnHand),
  }
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/**
 * Moves a health level one step toward worse (e.g. Tired → Weak).
 * Does nothing if already at VerySick.
 */
function declineHealth(health: HealthLevel): HealthLevel {
  switch (health) {
    case HealthLevel.Healthy:  return HealthLevel.Tired
    case HealthLevel.Tired:    return HealthLevel.Weak
    case HealthLevel.Weak:     return HealthLevel.Sick
    case HealthLevel.Sick:     return HealthLevel.VerySick
    case HealthLevel.VerySick: return HealthLevel.VerySick  // floor
  }
}

/**
 * Moves a health level one step toward better (e.g. Sick → Weak).
 * Does nothing if already Healthy.
 */
function improveHealth(health: HealthLevel): HealthLevel {
  switch (health) {
    case HealthLevel.VerySick: return HealthLevel.Sick
    case HealthLevel.Sick:     return HealthLevel.Weak
    case HealthLevel.Weak:     return HealthLevel.Tired
    case HealthLevel.Tired:    return HealthLevel.Healthy
    case HealthLevel.Healthy:  return HealthLevel.Healthy  // ceiling
  }
}

/**
 * Returns the display label for a health level.
 * Used in the Labor Roster UI.
 */
export function getHealthLabel(health: HealthLevel): string {
  switch (health) {
    case HealthLevel.Healthy:  return 'Healthy'
    case HealthLevel.Tired:    return 'Tired'
    case HealthLevel.Weak:     return 'Weak'
    case HealthLevel.Sick:     return 'Sick'
    case HealthLevel.VerySick: return 'Very Sick'
  }
}

/**
 * Returns the Tailwind color class for a health level.
 * Maps to the health color tokens defined in tailwind.config.js.
 */
export function getHealthColorClass(health: HealthLevel): string {
  switch (health) {
    case HealthLevel.Healthy:  return 'text-health-healthy'
    case HealthLevel.Tired:    return 'text-health-tired'
    case HealthLevel.Weak:     return 'text-health-weak'
    case HealthLevel.Sick:     return 'text-health-sick'
    case HealthLevel.VerySick: return 'text-health-verySick'
  }
}
