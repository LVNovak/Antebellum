/**
 * market.ts
 *
 * Commodity market simulation.
 *
 * Handles:
 *   - Generating market prices each season with realistic fluctuation
 *   - Processing queued sales through the factor
 *   - Applying spoilage to stored crops
 *   - Computing factor commission and relationship effects
 *
 * The market is not a real-time auction — it's a seasonal snapshot.
 * Prices are set at the start of each season and hold until the next turn.
 * See GDD Section 9.
 */

import {
  CropType,
  MarketPrices,
  QueuedSale,
  Factor,
  Storage,
} from './types'

import {
  MARKET_BASE_PRICE,
  MARKET_VOLATILITY,
  FACTOR_RELATIONSHIP_PRICE_BONUS_MAX,
  SPOILAGE_RATE_PER_SEASON,
  COOPER_SPOILAGE_REDUCTION,
} from './constants'

// ---------------------------------------------------------------------------
// PRICE GENERATION
// ---------------------------------------------------------------------------

/**
 * Generates new market prices for the coming season.
 *
 * Prices fluctuate around the base price using the volatility range
 * defined in constants.ts. The factor relationship can shift prices up.
 * Random demand shocks occasionally push prices far outside normal range.
 *
 * Returns a new MarketPrices object — does not mutate the original.
 */
export function generateSeasonalPrices(
  previousPrices: MarketPrices,
  factorRelationship: number  // 0-100
): MarketPrices {
  const newPrices: Partial<Record<CropType, number>> = {}

  for (const crop of SELLABLE_CROPS) {
    const base       = MARKET_BASE_PRICE[crop] ?? 0
    const volatility = MARKET_VOLATILITY[crop]  ?? 0.10

    // Random fluctuation within volatility range
    const fluctuation = (Math.random() * 2 - 1) * volatility  // -vol to +vol
    let price = base * (1 + fluctuation)

    // Demand shock — rare event that pushes price well outside normal range
    if (Math.random() < DEMAND_SHOCK_PROBABILITY) {
      const shockMagnitude = Math.random() * 0.40 + 0.10  // 10-50% shock
      const shockDirection = Math.random() < 0.5 ? 1 : -1
      price = price * (1 + shockMagnitude * shockDirection)
    }

    // Factor relationship bonus — better relationship = better price access
    const relationshipBonus = (factorRelationship / 100) * FACTOR_RELATIONSHIP_PRICE_BONUS_MAX
    price = price * (1 + relationshipBonus)

    // Price can't go below a floor (market won't accept below cost)
    newPrices[crop] = Math.max(PRICE_FLOOR, Math.round(price * 100) / 100)
  }

  // Keep last 4 seasons of history for the price trend display
  const updatedHistory = [
    ...previousPrices.priceHistory.slice(-3),  // keep last 3
    previousPrices.prices,                      // add the prices that just ended
  ]

  return {
    prices: newPrices,
    priceHistory: updatedHistory,
  }
}

// Crops that can actually be sold on the market
const SELLABLE_CROPS: CropType[] = [
  CropType.Tobacco,
  CropType.Rice,
  CropType.Indigo,
  CropType.Corn,
  CropType.Cowpeas,
  CropType.SweetPotato,
]

// Probability of a demand shock any given season (per crop)
const DEMAND_SHOCK_PROBABILITY = 0.08  // 8% chance per season per crop

// Minimum price — market won't pay below this regardless of conditions
const PRICE_FLOOR = 0.50

// ---------------------------------------------------------------------------
// SALE PROCESSING
// ---------------------------------------------------------------------------

/**
 * Result of processing all queued sales this season.
 */
export interface SaleResult {
  revenue:          number       // total cash received
  factorCommission: number       // commission taken by factor
  salesExecuted:    ExecutedSale[]
  salesRejected:    RejectedSale[]
  updatedStorage:   Storage
  updatedFactor:    Factor
}

export interface ExecutedSale {
  crop:          CropType
  quantity:      number
  pricePerUnit:  number
  grossRevenue:  number
  commission:    number
  netRevenue:    number
}

export interface RejectedSale {
  saleId: string
  reason: string
}

/**
 * Processes all queued sales through the factor.
 *
 * For each queued sale:
 *   1. Check if the factor will execute it (credit relationship, min price)
 *   2. Check if the inventory has enough of that crop
 *   3. Apply commission
 *   4. Remove sold crop from storage
 *
 * Returns revenue, updated storage, and a log of what happened.
 */
export function processQueuedSales(params: {
  sales:          QueuedSale[]
  storage:        Storage
  market:         MarketPrices
  factor:         Factor
  commissionRate: number  // 0.025 to 0.05
}): SaleResult {
  const { sales, storage, market, factor, commissionRate } = params

  let totalRevenue    = 0
  let totalCommission = 0
  let factor          = params.factor  // local mutable copy
  const salesExecuted: ExecutedSale[] = []
  const salesRejected: RejectedSale[] = []

  // Work on a copy of storage inventory so we can update it
  const updatedInventory = { ...storage.inventory }

  for (const sale of sales) {
    // Check: does the factor have enough credit standing to execute?
    if (factor.relationshipScore < 20 && factor.advanceOutstanding > factor.creditLimit) {
      salesRejected.push({
        saleId: sale.id,
        reason: 'Factor declined — outstanding advance exceeds credit limit and relationship is poor.',
      })
      continue
    }

    // Check: is there enough in storage?
    const available = updatedInventory[sale.crop] ?? 0
    if (available < sale.quantity) {
      salesRejected.push({
        saleId: sale.id,
        reason: `Only ${available} units of ${sale.crop} in storage; ${sale.quantity} requested.`,
      })
      continue
    }

    // Check: does current price meet the player's minimum floor?
    const currentPrice = market.prices[sale.crop] ?? 0
    if (sale.minPriceFloor !== null && currentPrice < sale.minPriceFloor) {
      salesRejected.push({
        saleId: sale.id,
        reason: `Current price ($${currentPrice.toFixed(2)}) is below your minimum floor ($${sale.minPriceFloor.toFixed(2)}). Factor will hold.`,
      })
      continue
    }

    // Execute the sale
    const grossRevenue = currentPrice * sale.quantity
    const commission   = grossRevenue * commissionRate
    const netRevenue   = grossRevenue - commission

    totalRevenue    += netRevenue
    totalCommission += commission

    // Deduct from storage
    updatedInventory[sale.crop] = available - sale.quantity

    salesExecuted.push({
      crop:         sale.crop,
      quantity:     sale.quantity,
      pricePerUnit: currentPrice,
      grossRevenue,
      commission,
      netRevenue,
    })

    // Successful sale improves factor relationship slightly
    factor = {
      ...factor,
      relationshipScore: Math.min(100, factor.relationshipScore + 1),
    }
  }

  return {
    revenue:          totalRevenue,
    factorCommission: totalCommission,
    salesExecuted,
    salesRejected,
    updatedStorage: { ...storage, inventory: updatedInventory },
    updatedFactor:  factor,
  }
}

// ---------------------------------------------------------------------------
// SPOILAGE
// ---------------------------------------------------------------------------

/**
 * Applies spoilage to all stored crops for one season.
 *
 * Spoilage is a fixed percentage of stored quantity per season,
 * modified by:
 *   - Whether a Cooper is assigned (reduces spoilage by 40%)
 *   - Storage condition (poor condition increases spoilage — Phase 2)
 *
 * Returns updated storage and a description of what spoiled.
 */
export function applySpoilage(storage: Storage): {
  updatedStorage: Storage
  spoilageReport: { crop: CropType; amountLost: number }[]
} {
  const updatedInventory   = { ...storage.inventory }
  const updatedSeasonsStored = { ...storage.seasonsStored }
  const spoilageReport: { crop: CropType; amountLost: number }[] = []

  for (const [cropKey, quantity] of Object.entries(updatedInventory)) {
    const crop = cropKey as CropType
    if (!quantity || quantity <= 0) continue

    const baseRate = SPOILAGE_RATE_PER_SEASON[crop] ?? 0
    if (baseRate === 0) continue  // cover crops and fallow don't spoil

    // Cooper reduces spoilage significantly
    const effectiveRate = storage.hasCooperAssigned
      ? baseRate * (1 - COOPER_SPOILAGE_REDUCTION)
      : baseRate

    const amountLost = Math.floor(quantity * effectiveRate)

    if (amountLost > 0) {
      updatedInventory[crop] = quantity - amountLost
      spoilageReport.push({ crop, amountLost })
    }

    // Increment how long this crop has been stored
    updatedSeasonsStored[crop] = (updatedSeasonsStored[crop] ?? 0) + 1
  }

  return {
    updatedStorage: {
      ...storage,
      inventory: updatedInventory,
      seasonsStored: updatedSeasonsStored,
    },
    spoilageReport,
  }
}

// ---------------------------------------------------------------------------
// FACTOR RELATIONSHIP
// ---------------------------------------------------------------------------

/**
 * Applies a relationship penalty when the player defaults on a debt
 * or switches factors. Called from the season resolver when a debt
 * payment is missed.
 */
export function applyFactorRelationshipPenalty(
  factor: Factor,
  reason: 'default' | 'switch'
): Factor {
  const penalty = reason === 'default' ? 15 : 10
  return {
    ...factor,
    relationshipScore: Math.max(0, factor.relationshipScore - penalty),
  }
}

/**
 * Returns a plain-language description of the factor relationship quality.
 * Used in the Market view UI.
 */
export function getFactorRelationshipLabel(score: number): string {
  if (score >= 80) return 'Excellent — your factor is a trusted partner'
  if (score >= 60) return 'Good — your factor works reliably with you'
  if (score >= 40) return 'Fair — standard terms, no special treatment'
  if (score >= 20) return 'Strained — your factor is cautious about credit'
  return 'Poor — your factor may decline sales or advances'
}
