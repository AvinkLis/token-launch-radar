// The palass token launch radar: one sealed DefiLlama snapshot in, one ranked
// board of pre-token protocols out.
//
// What "implied value" means here: what a protocol's token would be worth if it
// launched today at the valuation the market already pays for the TVL of
// comparable protocols that DO trade. It is not a prediction that a token will
// ever exist; it prices the record the snapshot carries, nothing else.
//
// Every figure comes from the snapshot's own bytes:
//
//   calibration  Protocols that already trade (market cap and TVL both recorded)
//                reveal how the market prices TVL: ratio = mcap / TVL. A
//                pre-token protocol is priced at the median ratio of its own
//                category (five or more samples), else the global median.
//   size         Large markets price TVL thinner than small ones, inside their
//                own category too. Each trading protocol's residual (its ratio
//                over its own category's multiple) strips the category effect
//                out; the median residual of the protocol's TVL band is its
//                size factor, clamped to [0.40, 1.60]; a band with fewer than
//                eight samples moves nothing.
//   growth       The seven-day TVL change, clamped to [-50, +100] percent,
//                scaled by 0.6: a protocol that grew 50% in a week is priced
//                30% above its base, one that shrank 50% is priced 30% below.
//   maturity     The longer a protocol has run with no token, the longer the
//                record behind the launch: 0.75 on day one, rising linearly to
//                1.20 at four years. An unrecorded listing date borrows the
//                median age of the board's own candidates.
//   implied      = TVL x category multiple x size x growth x maturity,
//                rounded to whole dollars, at least one dollar.
//
// The screen (which pre-token protocols may be ranked) re-applies the house's
// published watchlist rule uniformly at every size, from the fields the
// snapshot carries: no token recorded; the category is not a bridge, staking
// or exchange category; the name carries no version marker, no whole word
// "wrapped", "staked" or "staking", and does not open with an exchange's name.
// The house's watchlist is always carried whole: it is the floor, and this
// board is the same screen with the floor taken away.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated on the dashboard so a reader can re-run them. */
export interface ModelConstants {
  category_min_samples: number;
  band_min_samples: number;
  size_clamp_low: number;
  size_clamp_high: number;
  growth_weight: number;
  growth_floor_pct: number;
  growth_cap_pct: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
}

export const MODEL: ModelConstants = {
  category_min_samples: 5,
  band_min_samples: 8,
  size_clamp_low: 0.4,
  size_clamp_high: 1.6,
  growth_weight: 0.6,
  growth_floor_pct: -50,
  growth_cap_pct: 100,
  maturity_floor: 0.75,
  maturity_range: 0.45,
  maturity_days: 1460,
};

/** The model's version label: the dashboard names it and the board carries it. */
export const MODEL_VERSION = 'palass-radar-1';

/** How many already-trading protocols the dashboard's calibration view carries. */
export const LIVE_ROWS = 24;

const DAY_MS = 86_400_000;

/** Why a snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list: the middle value, or the mean of the two middle ones. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from `listedAt` to the snapshot's `asOf`, clamped at zero; null when a date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

// ------------------------------------------------------------ the screen

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word that marks a wrapped or staked product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** An exchange's own product opens with the exchange's name. */
const EXCHANGE_LED = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** Categories that are plumbing for tokens that already trade, or the exchange itself. */
const PLUMBING_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a pre-token protocol passes the radar's screen: not a wrapped, staked, bridged or versioned product of one that trades. */
export function passesScreen(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PLUMBING_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || WRAPPED_WORD.test(p.name) || EXCHANGE_LED.test(p.name)) return false;
  return true;
}

// ------------------------------------------------------------ calibration

/** One category's revealed price of TVL: how many trading protocols, and their median mcap/TVL. */
export interface CategoryCalibration {
  category: string;
  samples: number;
  median_ratio: number;
}

/** One TVL band's revealed price of TVL, against the global median. */
export interface BandCalibration {
  band: string;
  samples: number;
  median_ratio: number;
}

/** One TVL band's size effect: the median residual (ratio over own category multiple) of its trading protocols. */
export interface BandResidual {
  band: string;
  samples: number;
  median_residual: number;
}

/** What the trading half of the snapshot reveals about the price of TVL. */
export interface Calibration {
  sample_size: number;
  global_median: number;
  by_category: CategoryCalibration[];
  by_band: BandCalibration[];
  by_band_residual: BandResidual[];
}

/** The TVL band a figure falls in; the bands are the watchlist floor and ten times it. */
export function tvlBand(tvl: number, floor: number): string {
  if (tvl < floor) return 'under-floor';
  if (tvl < floor * 10) return 'floor-to-10x';
  return 'over-10x';
}

/** The calibration set: protocols whose token already trades, with a market cap and a TVL to price it against. */
function calibrationSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/** The market's revealed price of TVL, by category and by size, out of the snapshot's trading protocols. */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const set = calibrationSet(snapshot);
  const ratios = set.map((p) => p.mcap_usd! / p.tvl_usd);
  const global = ratios.length > 0 ? median(ratios) : 0;

  const catGroups = new Map<string, number[]>();
  for (const p of set) {
    const key = p.category ?? '(uncategorised)';
    const list = catGroups.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    catGroups.set(key, list);
  }
  const by_category = [...catGroups.entries()]
    .map(([category, list]) => ({ category, samples: list.length, median_ratio: round4(median(list)) }))
    .sort((a, b) => b.samples - a.samples || (a.category < b.category ? -1 : 1));

  const bandGroups = new Map<string, number[]>();
  for (const p of set) {
    const key = tvlBand(p.tvl_usd, snapshot.floor_usd);
    const list = bandGroups.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    bandGroups.set(key, list);
  }
  const by_band = ['under-floor', 'floor-to-10x', 'over-10x']
    .filter((band) => bandGroups.has(band))
    .map((band) => ({ band, samples: bandGroups.get(band)!.length, median_ratio: round4(median(bandGroups.get(band)!)) }));

  // The size effect with the category effect stripped out: a trading protocol's
  // residual is its own ratio over the multiple its category already explains.
  const catMedian = new Map(by_category.map((c) => [c.category, c]));
  const baseFor = (p: SnapshotProtocol): number => {
    const own = catMedian.get(p.category ?? '(uncategorised)');
    return own !== undefined && own.samples >= model.category_min_samples ? own.median_ratio : round4(global);
  };
  const residualGroups = new Map<string, number[]>();
  for (const p of set) {
    const base = baseFor(p);
    if (base <= 0) continue;
    const key = tvlBand(p.tvl_usd, snapshot.floor_usd);
    const list = residualGroups.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd / base);
    residualGroups.set(key, list);
  }
  const by_band_residual = ['under-floor', 'floor-to-10x', 'over-10x']
    .filter((band) => residualGroups.has(band))
    .map((band) => ({ band, samples: residualGroups.get(band)!.length, median_residual: round4(median(residualGroups.get(band)!)) }));

  return { sample_size: set.length, global_median: round4(global), by_category, by_band, by_band_residual };
}

/** The multiple one protocol is priced at, and where it came from: its category's median, or the global one. */
function multipleFor(p: SnapshotProtocol, calibration: Calibration, model: ModelConstants): { multiple: number; source: 'category' | 'global'; samples: number } {
  const own = calibration.by_category.find((c) => c.category === (p.category ?? '(uncategorised)'));
  if (own !== undefined && own.samples >= model.category_min_samples) {
    return { multiple: own.median_ratio, source: 'category', samples: own.samples };
  }
  return { multiple: calibration.global_median, source: 'global', samples: calibration.sample_size };
}

/** The size factor one protocol gets: its TVL band's median residual, clamped; a thin band moves nothing. */
function sizeFactorFor(p: SnapshotProtocol, snapshot: Snapshot, calibration: Calibration, model: ModelConstants): number {
  const band = calibration.by_band_residual.find((b) => b.band === tvlBand(p.tvl_usd, snapshot.floor_usd));
  if (band === undefined || band.samples < model.band_min_samples) return 1;
  return round4(Math.min(model.size_clamp_high, Math.max(model.size_clamp_low, band.median_residual)));
}

// ------------------------------------------------------------ implied value

/** One protocol priced: the implied value and every factor that produced it. */
export interface Priced {
  implied: number;
  multiple: number;
  multiple_source: 'category' | 'global';
  calibration_samples: number;
  size_factor: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  age_days: number | null;
}

/** Price one pre-token protocol from the snapshot's figures and the calibration set's revealed multiples. */
export function impliedValue(p: SnapshotProtocol, snapshot: Snapshot, calibration: Calibration, model: ModelConstants, defaultAge: number): Priced {
  const age = ageDays(snapshot.as_of, p.listed_at);
  const { multiple, source, samples } = multipleFor(p, calibration, model);
  const size = sizeFactorFor(p, snapshot, calibration, model);
  const growthPct = Math.min(model.growth_cap_pct, Math.max(model.growth_floor_pct, finite(p.change_7d, 0)));
  const growthMult = round4(1 + (growthPct / 100) * model.growth_weight);
  const ageForModel = age ?? defaultAge;
  const maturityMult = round4(model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * size * growthMult * maturityMult));
  return {
    implied,
    multiple,
    multiple_source: source,
    calibration_samples: samples,
    size_factor: size,
    growth_pct: growthPct,
    growth_multiplier: growthMult,
    maturity_multiplier: maturityMult,
    age_days: age,
  };
}

// ------------------------------------------------------------ farm plans

/** A farm step before it is rendered: the action, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: its action, then its cost and time, held inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The chain a plan is worked on: the first the protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, in the plain ranges a farmer budgets with. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return 'about $6-15';
  if (chain === 'Solana') return 'about $0.05';
  if (chain === 'BSC') return 'under $0.50';
  if (['Arbitrum', 'Base', 'Optimism', 'Polygon', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Mode', 'Taiko'].includes(chain)) return 'under $1';
  return 'about $1-3';
}

/** How much capital one farm position carries, from the protocol's own TVL: deeper markets absorb more. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 20_000_000) return 75;
  return 50;
}

/** How long a position is held, from the protocol's age: a younger record needs the longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 35;
  return 30;
}

/** A category's way of being farmed: the opening position, the second qualifying action, the weekly one. */
interface Playbook {
  action: (name: string, chain: string, capital: number) => string;
  second: (name: string, chain: string) => string;
  weekly: string;
}

const PLAYBOOKS: { match: string[]; book: Playbook }[] = [
  {
    match: ['lend', 'cdp', 'collateral', 'uncollateralized'],
    book: {
      action: (name, chain, capital) => `Supply $${capital} of USDC as collateral to ${name} on ${chain} and leave the position open.`,
      second: (name) => `Borrow about a third of the supplied value against the collateral on ${name}, then repay it a week later, so the account shows both sides of the market.`,
      weekly: 'one small top-up, repayment or rate check through the protocol\'s own interface',
    },
  },
  {
    match: ['dex'],
    book: {
      action: (name, chain, capital) => `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the LP position open.`,
      second: (name) => `Make one swap through ${name}'s own interface so the wallet records trading volume as well as liquidity.`,
      weekly: 'one swap and one liquidity rebalance through the protocol\'s own interface',
    },
  },
  {
    match: ['derivative', 'perpetual'],
    book: {
      action: (name, chain, capital) => `Deposit $${capital} of USDC as margin on ${name} and open one small position hedged with an equal spot holding elsewhere.`,
      second: (name) => `Close and reopen the hedge once on ${name} so the account records more than a single trade.`,
      weekly: 'one hedged trade, kept small, through the protocol\'s own interface',
    },
  },
  {
    match: ['basis'],
    book: {
      action: (name, chain, capital) => `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the vault shares.`,
      second: (name) => `Add a second, smaller deposit to ${name} in a later week so the account is not a single-day entry.`,
      weekly: 'one balance check and a small top-up every second week',
    },
  },
  {
    match: ['rwa'],
    book: {
      action: (name, chain, capital) => `Mint $${capital} of ${name}'s yield asset on ${chain}, completing the platform's own eligibility check first if it asks for one.`,
      second: (name) => `Hold the minted asset in the same wallet and make one small second mint on ${name} in a later week.`,
      weekly: 'one balance check on the protocol\'s own page, and a top-up mint once a month',
    },
  },
  {
    match: ['prediction'],
    book: {
      action: (name, chain, capital) => `Fund $${capital} on ${name} and place one position in its most liquid market.`,
      second: (name) => `Settle the first position on ${name} and place a second one in a different market.`,
      weekly: 'one settled position a week, kept to the funded amount',
    },
  },
  {
    match: ['staking pool'],
    book: {
      action: (name, chain, capital) => `Stake $${capital} of ${chain}'s staking asset through ${name} and keep the staking receipt in the wallet.`,
      second: (name) => `Claim the staking rewards on ${name} once and restake them, so the account shows an active staker.`,
      weekly: 'one rewards claim or small additional stake',
    },
  },
  {
    match: ['stablecoin'],
    book: {
      action: (name, chain, capital) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the wallet.`,
      second: (name) => `Use the stable asset in one of ${name}'s own pools or partner markets, then return it to the wallet.`,
      weekly: 'one transfer or pool action through the protocol\'s own page',
    },
  },
  {
    match: ['curator', 'allocator'],
    book: {
      action: (name, chain, capital) => `Deposit $${capital} into one of ${name}'s curated vaults on ${chain} and keep the vault shares.`,
      second: (name) => `Move a small part of the position to a second ${name} vault, so the account follows the curator rather than one pool.`,
      weekly: 'one deposit, withdrawal or vault switch through the protocol\'s own interface',
    },
  },
  {
    match: ['yield'],
    book: {
      action: (name, chain, capital) => `Deposit $${capital} into ${name}'s main yield vault on ${chain} and keep the shares.`,
      second: (name) => `Claim the first yield payment on ${name} and redeposit it into the same vault.`,
      weekly: 'one claim or top-up through the protocol\'s own interface',
    },
  },
  {
    match: ['chain'],
    book: {
      action: (name, chain, capital) => `Bridge $${capital} of USDC to ${name}'s chain and make the first transactions from the fresh wallet there.`,
      second: (name) => `Use two native applications on the chain reached through ${name}, so the wallet is an active chain account and not a bridge-only one.`,
      weekly: 'two or three ordinary transactions on the chain each week',
    },
  },
  {
    match: ['insurance'],
    book: {
      action: (name, chain, capital) => `Buy $${capital} of cover from ${name} on ${chain} against a position you actually hold, and keep the policy.`,
      second: (name) => `Stake a small amount into ${name}'s underwriting pool if it offers one, so the account also supplies cover.`,
      weekly: 'one policy or pool check on the protocol\'s own page',
    },
  },
  {
    match: ['leveraged', 'farm'],
    book: {
      action: (name, chain, capital) => `Open a $${capital} leveraged farming position on ${name} on ${chain} at its lowest leverage setting and keep it open.`,
      second: (name) => `Rebalance the position on ${name} once, adding or repaying a small amount rather than closing it.`,
      weekly: 'one rebalance and a health-factor check through the protocol\'s own interface',
    },
  },
];

const GENERIC_PLAYBOOK: Playbook = {
  action: (name, chain, capital) => `Deposit $${capital} of USDC into ${name} on ${chain} through its own app and keep the position open.`,
  second: (name) => `Make one more qualifying action on ${name} in a later week, such as a second deposit, a withdrawal and redeposit, or a vote.`,
  weekly: 'one qualifying action through the protocol\'s own interface',
};

/** The playbook a category is farmed by, matched on the words DefiLlama's category carries. */
function playbookFor(category: string | null): Playbook {
  const c = (category ?? '').toLowerCase();
  for (const entry of PLAYBOOKS) {
    if (entry.match.some((word) => c.includes(word))) return entry.book;
  }
  return GENERIC_PLAYBOOK;
}

/** A protocol's farm plan: six steps, each an action with its cost and its time, derived from its own record. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const book = playbookFor(p.category);
  return [
    {
      text: `Open a fresh wallet for ${p.name} alone, keep its seed phrase offline, and fund it on ${chain} with the gas token plus the capital below.`,
      cost: `one transfer in, ${gas} of network fees`,
      time: '10 minutes',
    },
    {
      text: book.action(p.name, chain, capital),
      cost: `$${capital} of capital, ${gas} in network fees`,
      time: '15 minutes to set up',
    },
    {
      text: book.second(p.name, chain),
      cost: `${gas} in network fees, no new capital`,
      time: '10 minutes, a week after the first step',
    },
    {
      text: `Keep a weekly rhythm on ${p.name}: ${book.weekly}, on the same wallet every time so the record reads as one farmer.`,
      cost: `${gas} a week in network fees`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days, and check ${p.name}'s own points or rewards page weekly so a qualifying window or a snapshot is never missed.`,
      cost: 'the capital stays in the position; checking costs nothing',
      time: `${hold} days of holding`,
    },
    {
      text: `When a launch or a rewards claim opens, follow only the link on ${p.name}'s official page, and write the wallet, the dates and every transaction into a farm log before you withdraw anything.`,
      cost: 'never pay anyone to claim; a real claim costs network fees only',
      time: '15 minutes at the end',
    },
  ];
}

// ------------------------------------------------------------ the board

/** One row of board.json: a ranked pre-token protocol, its price, and its farm plan. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token';
  screen: 'watchlist' | 'extended';
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_source: 'category' | 'global';
    calibration_samples: number;
    size_factor: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
  };
  farm_steps: string[];
}

/** An already-trading protocol, for the dashboard's calibration view: the market's own value, never a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  ratio: number | null;
}

/** Everything the dashboard renders: the board, the calibration, the live set, and the model that priced them. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: ModelConstants;
  calibration: Calibration;
  watchlist_size: number;
  board_size: number;
  extended_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

/** The board: every watchlist protocol, plus every other pre-token protocol the screen passes, priced and ranked. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; calibration: Calibration } {
  const calibration = calibrate(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);

  // The age an unlisted protocol borrows: the median age of the screened candidates themselves.
  const screened = snapshot.protocols.filter((p) => watchlist.has(p.slug) || passesScreen(p));
  const knownAges = screened.map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null);
  const defaultAge = knownAges.length > 0 ? Math.round(median(knownAges)) : 365;

  const scored = screened.map((p) => ({ p, priced: impliedValue(p, snapshot, calibration, model, defaultAge) }));
  scored.sort((a, b) => b.priced.implied - a.priced.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.priced.age_days,
    token_status: 'pre-token' as const,
    screen: watchlist.has(s.p.slug) ? ('watchlist' as const) : ('extended' as const),
    implied_value_usd: s.priced.implied,
    model: {
      multiple: s.priced.multiple,
      multiple_source: s.priced.multiple_source,
      calibration_samples: s.priced.calibration_samples,
      size_factor: s.priced.size_factor,
      growth_pct: s.priced.growth_pct,
      growth_multiplier: s.priced.growth_multiplier,
      maturity_multiplier: s.priced.maturity_multiplier,
    },
    farm_steps: farmSteps(s.p, s.priced.age_days).map(stepText),
  }));
  return { board, calibration };
}

/** The trading protocols the dashboard's calibration view carries, by market cap. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      ratio: p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** The board, the calibration and the live set, as one dashboard dataset. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, calibration } = buildBoard(snapshot, model);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model,
    calibration,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    extended_size: board.filter((r) => r.screen === 'extended').length,
    rows: board,
    live: liveRows(snapshot),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const snapshotSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!snapshotSlugs.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board carries a slug twice';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the gate's 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
