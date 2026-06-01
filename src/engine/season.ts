/**
 * season.ts
 *
 * The core turn engine — the heart of the game.
 *
 * resolveSeasonEnd() takes the current GameState and returns a new GameState
 * representing the end of the current season. It is a pure function:
 * same input always produces the same output (aside from random events).
 *
 * Order of resolution each season:
 *   1. Draw weather event
 *   2. Update all tile soil values (one O(n) pass)
 *   3. Compute harvests for tiles with crops ready
 *   4. Apply spoilage to storage
 *   5. Process queued sales through factor
 *   6. Apply labor health changes
 *   7. Pay labor and housing upkeep
 *   8. Draw and resolve labor/economic events
 *   9. Update Conditions Index
 *   10. Check achievements
 *   11. Advance to next season/year
 *
 * This function never mutates its input — it always returns a fresh object.
 * This makes the game state easy to save, load, and debug.
 */

import {
  GameState,
  GameEvent,
  Season,
  WeatherEvent,
  CropType,
  LaborType,
  HealthLevel,
} from './types'

import {
  WEATHER_WEIGHTS,
  WEATHER_YIELD_MODIFIER,
  CROP_BASE_YIELD_PER_TILE,
  FINANCE_RATES,
} from './constants'

import { applySeasonalSoilUpdate, getSoilHint } from './soil'
import {
  applySeasonalHealthChanges,
  computeConditionsIndex,
  getResistanceProbability,
  checkUpkeepRequirements,
} from './labor'
import { generateSeasonalPrices, processQueuedSales, applySpoilage } from './market'
import { checkAchievements } from './achievements'

// ---------------------------------------------------------------------------
// MAIN SEASON RESOLVER
// ---------------------------------------------------------------------------

/**
 * Resolves the end of the current season and returns the next game state.
 *
 * This is the only function the UI ever needs to call to advance the game.
 * Everything else in the engine exists to support this function.
 */
export function resolveSeasonEnd(state: GameState): GameState {
  // Work on a deep copy so we never mutate the input
  let next = deepCopyState(state)
  const events: GameEvent[] = []
  const season = state.currentSeason
  const year   = state.currentYear
  const seasonsPlayed = (year - 1) * 4 + seasonIndex(season)

  // ── Step 1: Draw weather ──────────────────────────────────────────────────
  const weather = drawWeatherEvent(season)
  events.push(buildWeatherEvent(weather, season, year))

  // ── Step 2: Update soil on all cleared tiles ──────────────────────────────
  next.tiles = next.tiles.map(tile => {
    if (!tile.isCleared) return tile  // uncleared tiles don't change

    const updatedSoil = applySeasonalSoilUpdate(
      tile,
      weather,
      false  // manure not implemented in Phase 1
    )

    // Check soil for qualitative hints
    const hint = getSoilHint(updatedSoil, tile.currentCrop, seasonsPlayed)
    if (hint) {
      events.push({
        id:          generateId(),
        season,
        year,
        category:   'Soil',
        title:      'Field Observation',
        description: hint,
        effects:     [],
      })
    }

    // Tick down stump rot countdown
    const stumpRotSeasonsLeft = Math.max(0, tile.stumpRotSeasonsLeft - 1)
    const hasStumpRot = stumpRotSeasonsLeft > 0

    return {
      ...tile,
      soil:              updatedSoil,
      hasStumpRot,
      stumpRotSeasonsLeft,
    }
  })

  // ── Step 3: Compute harvests ──────────────────────────────────────────────
  // In Autumn, planted crops are harvested (if not destroyed by early frost)
  let harvestedCorn = 0
  if (season === Season.Autumn) {
    const frostDestroyed = weather === WeatherEvent.EarlyFrost

    for (const tile of next.tiles) {
      if (!tile.isCleared || !tile.currentCrop) continue
      if (tile.currentCrop === CropType.Fallow || tile.currentCrop === CropType.CoverCrop) continue

      if (frostDestroyed) {
        // Early frost destroys all unharvested crops
        events.push({
          id: generateId(), season, year,
          category: 'Weather',
          title: 'Early Frost — Crops Destroyed',
          description: 'An early frost destroyed the unharvested crop on one of your fields.',
          effects: ['Harvest lost on this tile'],
        })
        continue
      }

      const baseYield = CROP_BASE_YIELD_PER_TILE[tile.currentCrop] ?? 0
      if (baseYield === 0) continue

      // Soil and weather both affect final yield
      const soilModifier    = computeYieldModifierFromSoil(tile.soil)
      const weatherModifier = WEATHER_YIELD_MODIFIER[weather]

      // Rice is destroyed by drought entirely
      const isRiceDestroyedByDrought =
        tile.currentCrop === CropType.Rice && weather === WeatherEvent.Drought
      if (isRiceDestroyedByDrought) continue

      const yield_ = Math.floor(baseYield * soilModifier * weatherModifier)
      if (yield_ <= 0) continue

      // Corn goes directly to provisions; everything else goes to storage
      if (tile.currentCrop === CropType.Corn) {
        harvestedCorn += yield_
      } else {
        // Add to storage if capacity allows
        const currentStored = getTotalStoredUnits(next.storage)
        const spaceAvailable = next.storage.capacity - currentStored
        const toStore = Math.min(yield_, spaceAvailable)

        if (toStore > 0) {
          next.storage.inventory[tile.currentCrop] =
            (next.storage.inventory[tile.currentCrop] ?? 0) + toStore
        }

        if (toStore < yield_) {
          events.push({
            id: generateId(), season, year,
            category: 'Economic',
            title: 'Storage Full — Crop Lost',
            description: `Storage was full at harvest. ${yield_ - toStore} units of ${tile.currentCrop} were lost.`,
            effects: [`${yield_ - toStore} units of ${tile.currentCrop} spoiled at harvest`],
          })
        }
      }
    }
  }

  // Add harvested corn to provisions
  // (In Phase 1 corn is tracked simply; Phase 2 will add full inventory)
  const cornFromHarvest = harvestedCorn

  // ── Step 4: Apply storage spoilage ───────────────────────────────────────
  const { updatedStorage, spoilageReport } = applySpoilage(next.storage)
  next.storage = updatedStorage

  if (spoilageReport.length > 0) {
    const spoilageDesc = spoilageReport
      .map(s => `${s.amountLost} units of ${s.crop}`)
      .join(', ')
    events.push({
      id: generateId(), season, year,
      category: 'Economic',
      title: 'Crop Spoilage',
      description: `Spoilage in storage this season: ${spoilageDesc}.`,
      effects: spoilageReport.map(s => `${s.amountLost} units of ${s.crop} lost`),
    })
  }

  // ── Step 5: Process queued sales ──────────────────────────────────────────
  const commissionRate = FINANCE_RATES.factorCommission.min +
    Math.random() * (FINANCE_RATES.factorCommission.max - FINANCE_RATES.factorCommission.min)

  const saleResult = processQueuedSales({
    sales:          next.finances.queuedSales,
    storage:        next.storage,
    market:         next.market,
    factor:         next.finances.factor,
    commissionRate,
  })

  next.storage            = saleResult.updatedStorage
  next.finances.factor    = saleResult.updatedFactor
  next.finances.cashOnHand += saleResult.revenue
  next.finances.queuedSales = []  // clear executed/rejected sales

  if (saleResult.salesExecuted.length > 0) {
    const saleDesc = saleResult.salesExecuted
      .map(s => `${s.quantity} units of ${s.crop} for $${s.netRevenue.toFixed(0)} net`)
      .join('; ')
    events.push({
      id: generateId(), season, year,
      category: 'Economic',
      title: 'Factor Sale Complete',
      description: `Your factor executed ${saleResult.salesExecuted.length} sale(s): ${saleDesc}. Commission: $${saleResult.factorCommission.toFixed(0)}.`,
      effects: [`Revenue received: $${saleResult.revenue.toFixed(0)}`],
    })
  }

  // ── Step 6: Labor health changes ──────────────────────────────────────────
  const healthResult = applySeasonalHealthChanges({
    workers:           next.workers,
    cabins:            next.cabins,
    cornAvailable:     cornFromHarvest,
    blanketsAvailable: next.blanketsOnHand,
    season,
    weatherWasStorm:   weather === WeatherEvent.Storm,
  })

  next.workers = healthResult.updatedWorkers
  for (const e of healthResult.events) {
    events.push({ ...e, id: generateId(), season, year })
  }

  // ── Step 7: Pay upkeep ────────────────────────────────────────────────────
  const upkeepCheck = checkUpkeepRequirements({
    workerCount:    next.workers.length,
    cornOnHand:     cornFromHarvest,
    cashOnHand:     next.finances.cashOnHand,
    blanketsOnHand: next.blanketsOnHand,
  })

  const cashUpkeep = next.workers.length * 1  // $1 clothing per worker
  next.finances.cashOnHand -= cashUpkeep

  if (!upkeepCheck.canMeetCorn) {
    events.push({
      id: generateId(), season, year,
      category: 'Labor',
      title: 'Corn Shortage',
      description: `You are ${upkeepCheck.cornShortfall} units of corn short of feeding your workforce. Worker health will decline.`,
      effects: ['Labor health declining this season'],
    })
  }

  if (!upkeepCheck.canMeetCash) {
    events.push({
      id: generateId(), season, year,
      category: 'Economic',
      title: 'Cash Shortfall',
      description: `You cannot cover full labor clothing costs. $${upkeepCheck.cashShortfall.toFixed(0)} short.`,
      effects: ['Conditions Index declining'],
    })
  }

  // Apply interest on outstanding debts
  const factorInterestRate = FINANCE_RATES.factorAdvancePerSeason.min
  const mortgageInterestRate = FINANCE_RATES.landMortgagePerYear.min / 4  // quarterly
  const noteInterestRate = FINANCE_RATES.personalNotePerYear.min / 4

  next.finances.factorAdvanceDebt *= (1 + factorInterestRate)
  next.finances.mortgageDebt      *= (1 + mortgageInterestRate)
  next.finances.personalNoteDebt  *= (1 + noteInterestRate)

  // Check for foreclosure
  const totalDebt   = next.finances.factorAdvanceDebt + next.finances.mortgageDebt + next.finances.personalNoteDebt
  const totalAssets = next.finances.cashOnHand + estimateAssetValue(next)
  if (totalDebt > totalAssets * 1.5) {
    events.push({
      id: generateId(), season, year,
      category: 'Economic',
      title: 'Foreclosure Warning',
      description: 'Your debts have exceeded your total assets. The bank is watching closely. One more difficult season may trigger foreclosure.',
      effects: ['Foreclosure risk: high'],
    })
  }

  // ── Step 8: Labor and resistance events ───────────────────────────────────
  next.conditionsIndex = computeConditionsIndex(next.workers)
  const resistanceChance = getResistanceProbability(next.conditionsIndex)

  if (Math.random() < resistanceChance) {
    const resistanceType = Math.random() < 0.6 ? 'slowdown' : 'escape'
    if (resistanceType === 'slowdown') {
      events.push({
        id: generateId(), season, year,
        category: 'Labor',
        title: 'Work Slowdown',
        description: 'Workers slowed their pace this season. Productivity was reduced.',
        effects: ['Labor output reduced approximately 20% this season'],
      })
    } else {
      events.push({
        id: generateId(), season, year,
        category: 'Labor',
        title: 'Escape Attempt',
        description: 'One of your workers attempted to flee. The incident has unsettled the plantation.',
        effects: ['Conditions Index declining', 'Productivity reduced this season'],
      })
      // Escape attempt worsens Conditions Index
      next.conditionsIndex = Math.max(0, next.conditionsIndex - 10)
    }
  }

  // ── Step 9: Generate new market prices for next season ────────────────────
  next.market = generateSeasonalPrices(next.market, next.finances.factor.relationshipScore)

  // ── Step 10: Check achievements ───────────────────────────────────────────
  const newTrophies = checkAchievements(next)
  for (const trophy of newTrophies) {
    next.trophies.push(trophy)
    events.push({
      id: generateId(), season, year,
      category: 'Economic',
      title: `Trophy Earned: ${trophy.name}`,
      description: trophy.condition,
      effects: [],
    })
  }

  // ── Step 11: Advance time ─────────────────────────────────────────────────
  const { nextSeason, nextYear } = advanceSeason(season, year)
  next.currentSeason = nextSeason
  next.currentYear   = nextYear
  next.lastSavedAt   = new Date().toISOString()

  // Add all events to the log
  next.eventLog = [...next.eventLog, ...events]

  return next
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/**
 * Randomly draws a weather event for the current season.
 * Uses the weighted probability table from constants.ts.
 */
function drawWeatherEvent(season: Season): WeatherEvent {
  const weights = WEATHER_WEIGHTS[season]
  const entries = Object.entries(weights) as [WeatherEvent, number][]
  const total   = entries.reduce((sum, [, w]) => sum + w, 0)
  let roll      = Math.random() * total

  for (const [event, weight] of entries) {
    roll -= weight
    if (roll <= 0) return event
  }

  return WeatherEvent.Normal  // fallback
}

function buildWeatherEvent(weather: WeatherEvent, season: Season, year: number): GameEvent {
  const descriptions: Record<WeatherEvent, string> = {
    [WeatherEvent.Normal]:     'Weather was unremarkable this season.',
    [WeatherEvent.Drought]:    'A serious drought gripped the region. Crops suffered significant losses.',
    [WeatherEvent.HeavyRain]:  'Heavy rains fell throughout the season. Some crop loss but soil moisture improved.',
    [WeatherEvent.Storm]:      'A severe storm struck. Housing may have been damaged and crops were affected.',
    [WeatherEvent.EarlyFrost]: 'An early frost swept through in Autumn. Unharvested crops were destroyed.',
  }

  return {
    id:          generateId(),
    season,
    year,
    category:   'Weather',
    title:      `Weather: ${weather}`,
    description: descriptions[weather],
    effects:     [],
  }
}

function advanceSeason(season: Season, year: number): { nextSeason: Season; nextYear: number } {
  switch (season) {
    case Season.Spring: return { nextSeason: Season.Summer, nextYear: year }
    case Season.Summer: return { nextSeason: Season.Autumn, nextYear: year }
    case Season.Autumn: return { nextSeason: Season.Winter, nextYear: year }
    case Season.Winter: return { nextSeason: Season.Spring, nextYear: year + 1 }
  }
}

function seasonIndex(season: Season): number {
  return { Spring: 1, Summer: 2, Autumn: 3, Winter: 4 }[season]
}

function getTotalStoredUnits(storage: { inventory: Partial<Record<CropType, number>> }): number {
  return Object.values(storage.inventory).reduce((sum, qty) => sum + (qty ?? 0), 0)
}

function estimateAssetValue(state: GameState): number {
  // Simplified asset estimate for Phase 1
  // Phase 2 will add worker and land market values
  const storedCropValue = Object.entries(state.storage.inventory)
    .reduce((sum, [crop, qty]) => {
      const price = state.market.prices[crop as CropType] ?? 0
      return sum + (qty ?? 0) * price
    }, 0)
  return storedCropValue + (state.tiles.filter(t => t.isCleared).length * 50)
}

// Simplified yield modifier for the season resolver
// The full version is in soil.ts — this avoids a circular import in Phase 1
function computeYieldModifierFromSoil(soil: { organicMatter: number; nitrogen: number; soilFauna: number; moistureRetention: number }): number {
  const om = soil.organicMatter     / 100
  const n  = soil.nitrogen          / 100
  const sf = soil.soilFauna         / 100
  const mr = soil.moistureRetention / 100
  const effectiveOM = om * (0.5 + 0.5 * sf)
  const effectiveN  = n  * (0.4 + 0.6 * mr)
  return Math.max(0, Math.min(1,
    effectiveOM * 0.30 + effectiveN * 0.35 + sf * 0.20 + mr * 0.15
  ))
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * Deep copies game state for safe mutation.
 * Uses JSON serialization — safe because GameState contains only
 * plain objects, arrays, strings, and numbers.
 */
function deepCopyState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state))
}
