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
  DebugEntry,
  TileHistoryEntry,
} from './types'

import {
  WEATHER_WEIGHTS,
  WEATHER_YIELD_MODIFIER,
  CROP_BASE_YIELD_PER_TILE,
  FINANCE_RATES,
  LABOR_UNITS_PER_WORKER_PER_SEASON,
  CLEARED_MATERIAL_YIELD,
  TEND_MITIGATION_PER_WORKER,
  TEND_MAX_MITIGATION,
  LABOR_UPKEEP,
  LABOR_SEASONAL_COST,
} from './constants'

import { applySeasonalSoilUpdate, getSoilHint } from './soil'
import { recordTransaction } from './transactions'
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

  // ── Step 2: Land clearing progress ────────────────────────────────────────
  // Tiles with workers assigned to ClearLand make progress toward being cleared.
  // Each assigned worker contributes 1 labor-season toward clearingProgressRemaining.
  const clearingWorkersByTile = countWorkersByTask(next.workers, 'ClearLand')

  next.tiles = next.tiles.map(tile => {
    if (tile.isCleared) return tile

    const workersAssigned = clearingWorkersByTile.get(tile.id) ?? 0
    if (workersAssigned === 0) return tile

    // Each worker contributes LABOR_UNITS_PER_WORKER_PER_SEASON toward
    // the tile's clearing pool (see constants.ts to retune pacing).
    const progressThisSeason = workersAssigned * LABOR_UNITS_PER_WORKER_PER_SEASON
    const newRemaining = Math.max(0, tile.clearingProgressRemaining - progressThisSeason)
    const justCleared  = newRemaining === 0

    if (justCleared) {
      const materialYield = CLEARED_MATERIAL_YIELD[tile.terrain]
      next.clearedMaterialOnHand += materialYield

      events.push({
        id: generateId(), season, year,
        category: 'Economic',
        title: 'Land Cleared',
        description: materialYield > 0
          ? `A ${tile.terrain.toLowerCase()} parcel has been fully cleared and is ready to plant. ${materialYield} unit(s) of cleared material were collected and can be composted onto a field.`
          : `A ${tile.terrain.toLowerCase()} parcel has been fully cleared and is ready to plant.`,
        effects: ['Tile available for planting next season'],
      })
    }

    return {
      ...tile,
      clearingProgressRemaining: newRemaining,
      isCleared: justCleared,
      // Newly cleared forest/swamp tiles get stump rot
      hasStumpRot: justCleared && tile.terrain !== 'Upland',
      stumpRotSeasonsLeft: justCleared && tile.terrain !== 'Upland' ? 2 : tile.stumpRotSeasonsLeft,
    }
  })

  // ── Step 3: Update soil on all cleared tiles ──────────────────────────────
  // Tending mitigates the soil-damage portion of severe weather (drought's
  // MR loss, storm's SF dip) — see TEND_MITIGATION_PER_WORKER in constants.ts.
  const tendingWorkersByTile = countWorkersByTask(next.workers, 'TendCrop')

  next.tiles = next.tiles.map(tile => {
    if (!tile.isCleared) return tile  // uncleared tiles don't change

    const tendingWorkers = tendingWorkersByTile.get(tile.id) ?? 0
    const tendingMitigation = weather === WeatherEvent.Normal
      ? 0
      : Math.min(TEND_MAX_MITIGATION, tendingWorkers * TEND_MITIGATION_PER_WORKER)

    const updatedSoil = applySeasonalSoilUpdate(
      tile,
      weather,
      false,  // manure not implemented in Phase 1
      tendingMitigation
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

  // ── Step 4: Compute harvests ──────────────────────────────────────────────
  let harvestedCorn = 0
  const harvestingWorkersByTile = countWorkersByTask(next.workers, 'HarvestCrop')
  const frostDestroyed = season === Season.Autumn && weather === WeatherEvent.EarlyFrost

  // Collect debug data for each tile this season
  const debugTileData: DebugEntry['tiles'] = []

  for (const tile of next.tiles) {
    const soilBefore = { ...tile.soil }

    if (!tile.isCleared || !tile.currentCrop) {
      debugTileData.push({
        id: tile.id, terrain: tile.terrain, isCleared: tile.isCleared,
        crop: tile.currentCrop,
        soilBefore: snapSoil(soilBefore),
        soilAfter:  snapSoil(tile.soil),
        workersClearing:   clearingWorkersByTile.get(tile.id) ?? 0,
        workersPlanting:   0,
        workersTending:    tendingWorkersByTile.get(tile.id) ?? 0,
        workersHarvesting: harvestingWorkersByTile.get(tile.id) ?? 0,
        yieldProduced: 0,
      })
      continue
    }
    if (tile.currentCrop === CropType.Fallow || tile.currentCrop === CropType.CoverCrop) {
      debugTileData.push({
        id: tile.id, terrain: tile.terrain, isCleared: tile.isCleared,
        crop: tile.currentCrop,
        soilBefore: snapSoil(soilBefore),
        soilAfter:  snapSoil(tile.soil),
        workersClearing: 0, workersPlanting: 0,
        workersTending:  tendingWorkersByTile.get(tile.id) ?? 0,
        workersHarvesting: 0,
        yieldProduced: 0,
      })
      continue
    }

    let yieldProduced = 0

    if (frostDestroyed) {
      events.push({
        id: generateId(), season, year,
        category: 'Weather',
        title: 'Early Frost — Crops Destroyed',
        description: 'An early frost destroyed the unharvested crop on one of your fields.',
        effects: ['Harvest lost on this tile'],
      })
    } else {
      const workersHarvesting = harvestingWorkersByTile.get(tile.id) ?? 0
      if (workersHarvesting > 0) {
        const baseYield = CROP_BASE_YIELD_PER_TILE[tile.currentCrop] ?? 0
        if (baseYield > 0) {
          const soilModifier = computeYieldModifierFromSoil(tile.soil)
          const baseWeatherModifier = WEATHER_YIELD_MODIFIER[weather]
          const tendingWorkers = tendingWorkersByTile.get(tile.id) ?? 0
          const tendingMitigation = weather === WeatherEvent.Normal
            ? 0
            : Math.min(TEND_MAX_MITIGATION, tendingWorkers * TEND_MITIGATION_PER_WORKER)
          const weatherModifier = Math.min(1.0, baseWeatherModifier + tendingMitigation)

          const isRiceDestroyedByDrought = tile.currentCrop === CropType.Rice && weather === WeatherEvent.Drought

          if (!isRiceDestroyedByDrought) {
            yieldProduced = Math.floor(baseYield * soilModifier * weatherModifier)

            if (yieldProduced > 0) {
              if (tile.currentCrop === CropType.Corn || tile.currentCrop === CropType.SweetPotato) {
                harvestedCorn += yieldProduced
              } else {
                const currentStored = getTotalStoredUnits(next.storage)
                const spaceAvailable = next.storage.capacity - currentStored
                const toStore = Math.min(yieldProduced, spaceAvailable)

                if (toStore > 0) {
                  next.storage.inventory[tile.currentCrop] =
                    (next.storage.inventory[tile.currentCrop] ?? 0) + toStore
                }
                if (toStore < yieldProduced) {
                  events.push({
                    id: generateId(), season, year,
                    category: 'Economic',
                    title: 'Storage Full — Crop Lost',
                    description: `Storage was full at harvest. ${yieldProduced - toStore} units of ${tile.currentCrop} were lost.`,
                    effects: [`${yieldProduced - toStore} units of ${tile.currentCrop} spoiled at harvest`],
                  })
                }
              }

              // Phase 1 seed model: harvesting perpetuates seed stock for this crop
              // (farmer always saves seed from harvest — no quantity tracking yet)
              if (!next.seedInventory) next.seedInventory = {}
              next.seedInventory[tile.currentCrop] = 1
            }
          }
        }
        // Harvested tile becomes empty
        tile.currentCrop = null
      }
    }

    // Record tile history entry
    const historyEntry: TileHistoryEntry = {
      season, year,
      crop:          tile.currentCrop ?? (yieldProduced > 0 ? null : tile.currentCrop),
      yieldProduced,
      soilComposite: Math.round(computeYieldModifierFromSoil(tile.soil) * 100),
    }
    tile.history = [...(tile.history ?? []), historyEntry]

    debugTileData.push({
      id: tile.id, terrain: tile.terrain, isCleared: tile.isCleared,
      crop: tile.currentCrop,
      soilBefore: snapSoil(soilBefore),
      soilAfter:  snapSoil(tile.soil),
      workersClearing: 0, workersPlanting: 0,
      workersTending:  tendingWorkersByTile.get(tile.id) ?? 0,
      workersHarvesting: harvestingWorkersByTile.get(tile.id) ?? 0,
      yieldProduced,
    })
  }

  next.cornOnHand = (next.cornOnHand ?? 0) + harvestedCorn

  // ── Step 5: Apply storage spoilage ───────────────────────────────────────
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

  // ── Step 6: Process queued sales ──────────────────────────────────────────
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

    next.transactionLog.push(recordTransaction({
      description:   `Factor sale: ${saleDesc} (commission $${saleResult.factorCommission.toFixed(0)})`,
      amount:        saleResult.revenue,
      newCashOnHand: next.finances.cashOnHand,
      season, year,
    }))
  }

  // ── Step 7: Labor health changes ──────────────────────────────────────────
  const healthResult = applySeasonalHealthChanges({
    workers:           next.workers,
    cabins:            next.cabins,
    cornAvailable:     next.cornOnHand,
    blanketsAvailable: next.blanketsOnHand,
    season,
    weatherWasStorm:   weather === WeatherEvent.Storm,
    provisionWorkerCount: next.workers.filter(w =>
      w.laborType === LaborType.EnslavedPurchased ||
      w.laborType === LaborType.IndenturedBlack ||
      w.laborType === LaborType.IndenturedWhite
    ).length,
  })

  next.workers = healthResult.updatedWorkers
  for (const e of healthResult.events) {
    events.push({ ...e, id: generateId(), season, year })
  }

  // ── Step 8: Pay upkeep ────────────────────────────────────────────────────
  // Provisions (corn, blankets) only apply to workers whose upkeep is the
  // planter's direct responsibility: purchased enslaved and indentured.
  // Hired-out enslaved and free wage workers provision themselves — their
  // cost is captured in the rental/wage fee below.
  const PROVISION_TYPES = new Set([
    LaborType.EnslavedPurchased,
    LaborType.IndenturedBlack,
    LaborType.IndenturedWhite,
  ])
  const RENTAL_TYPES = new Set([
    LaborType.EnslavedHiredOut,
    LaborType.FreeWage,
  ])

  const provisionWorkers = next.workers.filter(w => PROVISION_TYPES.has(w.laborType))
  const rentalWorkers    = next.workers.filter(w => RENTAL_TYPES.has(w.laborType))

  // Clothing ($1/season) applies to ALL workers
  const clothingUpkeep = next.workers.length * LABOR_UPKEEP.clothing
  next.finances.cashOnHand -= clothingUpkeep
  if (clothingUpkeep > 0) {
    next.transactionLog.push(recordTransaction({
      description:   `Worker clothing allowance (${next.workers.length} × $${LABOR_UPKEEP.clothing})`,
      amount:        -clothingUpkeep,
      newCashOnHand: next.finances.cashOnHand,
      season, year,
    }))
  }

  // Corn provisions — purchased enslaved and indentured only
  const cornNeeded  = provisionWorkers.length * LABOR_UPKEEP.corn
  const cornConsumed = Math.min(next.cornOnHand, cornNeeded)
  next.cornOnHand  -= cornConsumed
  const cornShortfall = Math.max(0, cornNeeded - cornConsumed)

  // Blanket provisions — purchased enslaved and indentured only
  const blanketsNeeded   = provisionWorkers.length * LABOR_UPKEEP.blankets
  const blanketsConsumed = Math.min(next.blanketsOnHand, blanketsNeeded)
  next.blanketsOnHand   -= blanketsConsumed

  if (cornShortfall > 0) {
    events.push({
      id: generateId(), season, year,
      category: 'Labor',
      title: 'Corn Shortage',
      description: `You are ${cornShortfall.toFixed(0)} unit(s) of corn short of feeding your workforce. Worker health will decline.`,
      effects: ['Labor health declining this season'],
    })
  }

  // Rental and wage fees — hired-out enslaved and free wage workers
  let totalRentalCost = 0
  for (const worker of rentalWorkers) {
    const fee = LABOR_SEASONAL_COST[worker.laborType].min
    totalRentalCost += fee
  }
  if (totalRentalCost > 0) {
    next.finances.cashOnHand -= totalRentalCost
    next.transactionLog.push(recordTransaction({
      description:   `Labor rental/wage fees (${rentalWorkers.length} worker${rentalWorkers.length !== 1 ? 's' : ''})`,
      amount:        -totalRentalCost,
      newCashOnHand: next.finances.cashOnHand,
      season, year,
    }))
  }

  // Housing upkeep — $6/cabin/season (Phase 1 simplification; GDD v0.5 Section 6.3)
  const cabinUpkeep = next.cabins.length * 6
  next.finances.cashOnHand -= cabinUpkeep
  if (cabinUpkeep > 0) {
    next.transactionLog.push(recordTransaction({
      description:   `Cabin upkeep (${next.cabins.length} cabin${next.cabins.length !== 1 ? 's' : ''} × $6)`,
      amount:        -cabinUpkeep,
      newCashOnHand: next.finances.cashOnHand,
      season, year,
    }))
  }

  // Cabin condition decay — cabins degrade without active repair
  // Workers assigned RepairCabin task prevent decay on that cabin
  const repairingWorkers = next.workers.filter(w => w.assignedTask?.type === 'RepairCabin')
  next.cabins = next.cabins.map(cabin => {
    const isBeingRepaired = repairingWorkers.some(
      w => w.assignedTask?.type === 'RepairCabin' && (w.assignedTask as { cabinId: string }).cabinId === cabin.id
    )
    if (isBeingRepaired) return cabin  // repair prevents decay this season

    // Storm degrades by one tier immediately
    // Neglect (no repair) degrades after 3 seasons — tracked via receivedMaintenanceThisSeason flag
    if (weather === WeatherEvent.Storm && cabin.condition !== 'Damaged') {
      return { ...cabin, condition: degradeCabinCondition(cabin.condition) }
    }

    // Seasonal neglect: without any upkeep work, Fair degrades slowly
    // We use a simple probabilistic model: 33% chance of decay per neglected season
    if (!cabin.receivedMaintenanceThisSeason && Math.random() < 0.33) {
      return { ...cabin, condition: degradeCabinCondition(cabin.condition) }
    }

    return { ...cabin, receivedMaintenanceThisSeason: false }
  })

  // Cash upkeep shortfall check
  if (next.finances.cashOnHand < 0) {
    events.push({
      id: generateId(), season, year,
      category: 'Economic',
      title: 'Cash Shortfall',
      description: 'Upkeep costs exceeded available cash this season. Debt is growing.',
      effects: ['Conditions Index may decline'],
    })
  }

  // Apply interest on outstanding debts
  const factorInterestRate   = FINANCE_RATES.factorAdvancePerSeason.min
  const mortgageInterestRate = FINANCE_RATES.landMortgagePerYear.min / 4
  const noteInterestRate     = FINANCE_RATES.personalNotePerYear.min / 4

  const factorInterestAccrued   = next.finances.factorAdvanceDebt * factorInterestRate
  const mortgageInterestAccrued = next.finances.mortgageDebt * mortgageInterestRate
  const noteInterestAccrued     = next.finances.personalNoteDebt * noteInterestRate

  next.finances.factorAdvanceDebt *= (1 + factorInterestRate)
  next.finances.mortgageDebt      *= (1 + mortgageInterestRate)
  next.finances.personalNoteDebt  *= (1 + noteInterestRate)

  const totalInterestAccrued = factorInterestAccrued + mortgageInterestAccrued + noteInterestAccrued
  if (totalInterestAccrued > 0.01) {
    next.transactionLog.push(recordTransaction({
      description:   `Interest accrued on outstanding debt (+$${totalInterestAccrued.toFixed(2)} owed)`,
      amount:        0,
      newCashOnHand: next.finances.cashOnHand,
      season, year,
    }))
  }

  // Check for foreclosure (grace period: first 4 seasons)
  const FORECLOSURE_GRACE_PERIOD_SEASONS = 4
  const pastGracePeriod = seasonsPlayed > FORECLOSURE_GRACE_PERIOD_SEASONS
  const totalDebt   = next.finances.factorAdvanceDebt + next.finances.mortgageDebt + next.finances.personalNoteDebt
  const totalAssets = next.finances.cashOnHand + estimateAssetValue(next)
  if (pastGracePeriod && totalDebt > totalAssets * 1.5) {
    events.push({
      id: generateId(), season, year,
      category: 'Economic',
      title: 'Foreclosure Warning',
      description: 'Your debts have exceeded your total assets. The bank is watching closely. One more difficult season may trigger foreclosure.',
      effects: ['Foreclosure risk: high'],
    })
  }

  // ── Step 9: Labor and resistance events ───────────────────────────────────
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

  // ── Step 10: Generate new market prices for next season ────────────────────
  next.market = generateSeasonalPrices(next.market, next.finances.factor.relationshipScore)

  // ── Step 11: Check achievements ───────────────────────────────────────────
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

  // ── Step 12: Advance time ─────────────────────────────────────────────────
  const { nextSeason, nextYear } = advanceSeason(season, year)
  next.currentSeason = nextSeason
  next.currentYear   = nextYear
  next.lastSavedAt   = new Date().toISOString()

  // Add all events to the log
  next.eventLog = [...next.eventLog, ...events]

  // ── Debug log entry ───────────────────────────────────────────────────────
  const debugEntry: DebugEntry = {
    season, year,
    weather: weather as string,
    tiles: debugTileData,
    workers: next.workers.map(w => ({
      id: w.id, name: w.name, type: w.laborType, health: w.health,
      task: w.assignedTask?.type ?? 'Unassigned',
    })),
    finances: {
      cashStart:      state.finances.cashOnHand,
      cashEnd:        next.finances.cashOnHand,
      debtTotal:      next.finances.factorAdvanceDebt + next.finances.mortgageDebt + next.finances.personalNoteDebt,
      salesRevenue:   saleResult.revenue,
      upkeepClothing: clothingUpkeep,
      upkeepRental:   totalRentalCost,
      upkeepInterest: totalInterestAccrued,
    },
    events: events.map(e => `[${e.category}] ${e.title}: ${e.description}`),
  }
  next.debugLog = [...(next.debugLog ?? []), debugEntry]

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

/**
 * Counts how many workers are assigned to a given task type, grouped by tileId.
 *
 * Used to determine how much progress a tile makes this season for tasks
 * like clearing or harvesting — each assigned worker contributes one
 * labor-season toward the task.
 *
 * Only considers tasks that include a tileId (ClearLand, HarvestCrop, etc.)
 */
function countWorkersByTask(
  workers: GameState['workers'],
  taskType: 'ClearLand' | 'HarvestCrop' | 'TendCrop'
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const worker of workers) {
    const task = worker.assignedTask
    if (!task || task.type !== taskType) continue
    if (!('tileId' in task)) continue
    counts.set(task.tileId, (counts.get(task.tileId) ?? 0) + 1)
  }
  return counts
}

function estimateAssetValue(state: GameState): number {
  const storedCropValue = Object.entries(state.storage.inventory)
    .reduce((sum, [crop, qty]) => {
      const price = state.market.prices[crop as CropType] ?? 0
      return sum + (qty ?? 0) * price
    }, 0)

  const landValue = state.tiles.reduce((sum, tile) => {
    return sum + (tile.isCleared ? 100 : 40)
  }, 0)

  const laborValue = state.workers.reduce((sum, worker) => {
    if (worker.laborType === 'EnslavedPurchased') return sum + 500
    if (worker.laborType === 'IndenturedBlack' || worker.laborType === 'IndenturedWhite') return sum + 75
    return sum
  }, 0)

  const provisionsValue = state.cornOnHand * 2

  return storedCropValue + landValue + laborValue + provisionsValue
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

function degradeCabinCondition(condition: string): string {
  const progression: Record<string, string> = {
    'Good':    'Fair',
    'Fair':    'Poor',
    'Poor':    'Damaged',
    'Damaged': 'Damaged',
  }
  return progression[condition] ?? condition
}

function snapSoil(soil: { organicMatter: number; nitrogen: number; soilFauna: number; moistureRetention: number }): { om: number; n: number; sf: number; mr: number; composite: number } {
  return {
    om: Math.round(soil.organicMatter),
    n:  Math.round(soil.nitrogen),
    sf: Math.round(soil.soilFauna),
    mr: Math.round(soil.moistureRetention),
    composite: Math.round(computeYieldModifierFromSoil(soil) * 100),
  }
}

/**
 * Deep copies game state for safe mutation.
 * Uses JSON serialization — safe because GameState contains only
 * plain objects, arrays, strings, and numbers.
 */
function deepCopyState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state))
}
