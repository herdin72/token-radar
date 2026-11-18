// radar-2: a token-launch radar scored only from the sealed snapshot.
//
// The board ranks pre-token protocols (the snapshot records no token for
// them) by an implied launch value. Every watchlist slug is ranked, and
// the radar adds early pre-token protocols below the watchlist floor, by
// TVL. Protocols whose token already trades are never ranked; the biggest
// of them are listed separately with their market caps, which are facts,
// not model output.
//
// The value model (radar-2) is one function of four snapshot figures:
//
//   base      = tvl_usd * 0.42
//   growthPct = clamp(change_7d ?? 0, -45, 90)
//   growth    = 1 + growthPct / 100 * 0.85
//   maturity  = 0.72 + 0.38 * (1 - exp(-ageDays / 540))
//               ageDays unknown -> 240 days (maturity 0.856)
//   breadth   = 1 + 0.05 * min(max(chains - 1, 0), 4)
//   implied   = round(base * growth * maturity * breadth)
//
// Why these shapes: TVL is the size of the business a token would claim
// a share of; the 7-day change rewards momentum but is clamped so one hot
// week cannot dominate; maturity rises fast in a protocol's first year
// and then flattens, because a protocol that has run for years with no
// token has a longer track record to price, while a brand-new one is
// mostly promise; breadth rewards protocols live on several chains, up
// to four extra chains, because a multi-chain footprint is harder to
// copy than a single-chain deployment. No protocol name is ever
// special-cased: the same arithmetic scores every row.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** radar-2 constants, printed on the dashboard so a reader can check them. */
export interface Radar2Constants {
  base_multiple: number;
  growth_weight: number;
  growth_low: number;
  growth_high: number;
  maturity_base: number;
  maturity_span: number;
  maturity_halflife_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra: number;
}

export const MODEL: Radar2Constants = {
  base_multiple: 0.42,
  growth_weight: 0.85,
  growth_low: -45,
  growth_high: 90,
  maturity_base: 0.72,
  maturity_span: 0.38,
  maturity_halflife_days: 540,
  unknown_age_days: 240,
  breadth_per_chain: 0.05,
  breadth_max_extra: 4,
};

export const MODEL_VERSION = 'radar-2';

/** Early pre-token rows below the watchlist floor, taken by TVL. */
export const EARLY_ROWS = 180;
/** Live-token protocols shown apart from the ranking, by market cap. */
export const LIVE_ROWS = 24;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    chain_count: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: Radar2Constants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to the snapshot date; null when unlisted or unparsable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

export interface Scored {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
}

/** radar-2's one scoring function: the same arithmetic for every protocol. */
export function impliedValue(p: SnapshotProtocol, asOf: string, model: Radar2Constants): Scored {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = Math.min(model.growth_high, Math.max(model.growth_low, asNumber(p.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageUsed = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_base + model.maturity_span * (1 - Math.exp(-Math.max(ageUsed, 0) / model.maturity_halflife_days));
  const extraChains = Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_extra);
  const breadthMult = 1 + model.breadth_per_chain * extraChains;
  const implied = Math.max(1, Math.round(p.tvl_usd * model.base_multiple * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** A protocol records no token when all three token fields are null. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/**
 * Whether a pre-token protocol may join the early radar: not an exchange,
 * not a bridge / liquid-staking wrapper, not a versioned pool of another
 * protocol, and not named as a wrapped or staked product. These are
 * generic rules over the snapshot's own fields, applied to every row.
 * Watchlist rows are always ranked regardless of this test.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

function slugOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Build the ranked board: watchlist first, then the early radar by TVL. */
export function buildBoard(snapshot: Snapshot, model: Radar2Constants = MODEL): BoardRow[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || slugOrder(a.slug, b.slug))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, s: impliedValue(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || slugOrder(a.p.slug, b.p.slug));
  return scored.map((entry, i) => {
    const { p, s } = entry;
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token' as const,
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        base_multiple: model.base_multiple,
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        breadth_multiplier: round4(s.breadthMult),
        chain_count: p.chains.length,
        age_days: s.age,
      },
      farm_steps: farmSteps(p, s.age).map(stepText),
    };
  });
}

/** One farm step as a single string carrying its action, cost and time. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and re-check the protocol's own page.`;
  return s;
}

function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Farming capital tier, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 400;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 120;
  return 60;
}

/** Minimum hold: younger protocols need a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 120) return 90;
  if (age < 365) return 60;
  return 45;
}

/** The core on-chain action for the protocol's category. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC on ${name} (${chain}) and leave the loan position untouched.`;
  if (c.includes('dex') || c.includes('yield aggregator') || c.includes('leveraged farm')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and leave the LP position open.`;
  if (c.includes('yield')) return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and hold the vault shares.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Post $${capital} of USDC as collateral on ${name} (${chain}) and open a single small hedged trade.`;
  if (c.includes('bridge')) return `Move $${capital} of USDC through ${name} onto ${chain}, then use the funds inside its app once.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} through ${name} on ${chain} and keep the staking receipt in the same wallet.`;
  if (c.includes('stable')) return `Mint or hold $${capital} of the stable asset issued through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Buy $${capital} of ${name}'s tokenised yield asset on ${chain} and hold it in the farming wallet.`;
  if (c.includes('prediction')) return `Fund ${name} with $${capital} and settle one prediction-market position on ${chain}.`;
  if (c.includes('risk') || c.includes('curator') || c.includes('allocator') || c.includes('capital')) return `Allocate $${capital} to a ${name} vault on ${chain} and keep the allocation for the full hold period.`;
  if (c.includes('insurance')) return `Purchase $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('payment')) return `Route $${capital} of payments through ${name} on ${chain} across at least two separate weeks.`;
  return `Put $${capital} of USDC to work in ${name} on ${chain} and keep the position open.`;
}

/**
 * Six farm steps for a protocol, derived from its category, chains, TVL
 * and age — never from a hand-written list of names. Each step states
 * what it costs and how long it takes.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 200 ? 9 : 5;
  return [
    {
      text: `Set up a dedicated farming wallet, fund it with exactly $${capital} plus gas, and store its seed phrase offline on paper.`,
      cost: `about $3 of gas for the first transfer`,
      time: '10 minutes',
    },
    {
      text: coreAction(p, capital, chain),
      cost: `$${capital} of capital plus about $${gas} of gas`,
      time: '20 minutes to set up',
    },
    {
      text: `Return once a week and do one real action — a deposit, a swap, a borrow or a vote — so the wallet shows a pattern, not a single deposit.`,
      cost: 'about $2 of gas per week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the full position untouched for at least ${hold} days, covering more than one monthly snapshot window.`,
      cost: `the $${capital} stays locked in the position`,
      time: `${hold} days`,
    },
    {
      text: `Track the protocol's own points or rewards page weekly, and only ever claim through a link published by the protocol itself.`,
      cost: 'free to check; never pay a fee to claim',
      time: '5 minutes a week',
    },
    {
      text: `Log the wallet address, every transaction hash and the dates in a farm journal, then unwind in one transaction when you exit.`,
      cost: `about $${gas} of gas to unwind`,
      time: '10 minutes',
    },
  ];
}

/** Live-token protocols, by market cap — shown apart, never ranked. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || slugOrder(a.slug, b.slug))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: Radar2Constants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** Parse and validate the snapshot file's text. */
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
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json protocol ${i} lacks a slug, a name or a TVL`);
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** First reason a board would fail the gate, or null when it is valid. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `board misses ${missing.length} watchlist slug(s): ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `board holds only ${board.length} rows, fewer than 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share implied value $${board[0]!.implied_value_usd}`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** data.js: the dashboard's whole dataset as one script, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
