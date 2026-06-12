export const DEFAULT_ELO = 1000;

const TIER_THRESHOLDS = [
  { elo: 2100, tier: 'goat' },
  { elo: 1800, tier: 'champion' },
  { elo: 1600, tier: 'elite' },
  { elo: 1400, tier: 'diamond' },
  { elo: 1250, tier: 'platinum' },
  { elo: 1100, tier: 'gold' },
  { elo: 900,  tier: 'silver' },
];

const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'elite', 'champion', 'goat'];

const BASE_ELO_CHANGE = 3;
const TIER_MULTIPLIER = 1.5;

export function tierFromElo(elo) {
  for (const t of TIER_THRESHOLDS) {
    if (elo >= t.elo) return t.tier;
  }
  return 'bronze';
}

export function tierOrder(tier) {
  return TIER_ORDER.indexOf(tier?.toLowerCase());
}

function tierDiffMultiplier(tierA, tierB) {
  const a = TIER_ORDER.indexOf(tierA);
  const b = TIER_ORDER.indexOf(tierB);
  if (a < 0 || b < 0) return 1;
  return Math.pow(TIER_MULTIPLIER, Math.abs(a - b));
}

export function computeLobbyAverageElo(players) {
  if (!players?.length) return DEFAULT_ELO;
  return players.reduce((sum, p) => sum + (p.elo ?? DEFAULT_ELO), 0) / players.length;
}

export function computeNewElos(players, ranking) {
  const sorted = [...players].sort((a, b) => (ranking[a.user_id] ?? 99) - (ranking[b.user_id] ?? 99));
  const n = sorted.length;
  if (n === 0) return [];

  const results = sorted.map((p, i) => {
    const myTier = p.rank_tier || tierFromElo(p.elo ?? DEFAULT_ELO);
    const opponents = sorted.filter((o) => o.user_id !== p.user_id);
    const didWin = i === 0;

    let totalDelta = 0;
    for (const o of opponents) {
      const oppTier = o.rank_tier || tierFromElo(o.elo ?? DEFAULT_ELO);
      const mult = tierDiffMultiplier(myTier, oppTier);
      totalDelta += didWin ? (BASE_ELO_CHANGE * mult) : -(BASE_ELO_CHANGE * mult);
    }

    const avgDelta = opponents.length > 0 ? totalDelta / opponents.length : (didWin ? BASE_ELO_CHANGE : -BASE_ELO_CHANGE);
    const elo = Math.max(0, Math.round((p.elo ?? DEFAULT_ELO) + avgDelta));

    return {
      user_id: p.user_id,
      newElo: elo,
      oldElo: p.elo ?? DEFAULT_ELO,
      delta: Math.round(avgDelta),
    };
  });

  console.log('[ELO] computeNewElos:', results.map(r => `${r.user_id}: ${r.oldElo}→${r.newElo} (${r.delta >= 0 ? '+' : ''}${r.delta})`).join(' | '));

  return results;
}

// ── Debug helpers (callable from browser console) ─────────

export function runEloTests() {
  const scenarios = [
    {
      name: 'Bronze beats Diamond (1v1) — big upset',
      players: [
        { user_id: 'bronze', elo: 800, rank_tier: 'bronze' },
        { user_id: 'diamond', elo: 1400, rank_tier: 'diamond' },
      ],
      ranking: { bronze: 1, diamond: 2 },
    },
    {
      name: 'Diamond beats Bronze (1v1) — expected',
      players: [
        { user_id: 'diamond', elo: 1400, rank_tier: 'diamond' },
        { user_id: 'bronze', elo: 800, rank_tier: 'bronze' },
      ],
      ranking: { diamond: 1, bronze: 2 },
    },
    {
      name: 'Equal tiers — Silver vs Silver (1v1)',
      players: [
        { user_id: 'silver_a', elo: 1000, rank_tier: 'silver' },
        { user_id: 'silver_b', elo: 950, rank_tier: 'silver' },
      ],
      ranking: { silver_a: 1, silver_b: 2 },
    },
    {
      name: '4-player: Gold, Silver, Bronze, Diamond',
      players: [
        { user_id: 'gold', elo: 1100, rank_tier: 'gold' },
        { user_id: 'silver', elo: 950, rank_tier: 'silver' },
        { user_id: 'bronze', elo: 800, rank_tier: 'bronze' },
        { user_id: 'diamond', elo: 1400, rank_tier: 'diamond' },
      ],
      ranking: { bronze: 1, silver: 2, gold: 3, diamond: 4 },
    },
    {
      name: 'Rank up: Silver → Gold (1000 → 1120)',
      players: [
        { user_id: 'player', elo: 1000, rank_tier: 'silver' },
        { user_id: 'gold', elo: 1150, rank_tier: 'gold' },
        { user_id: 'platinum', elo: 1300, rank_tier: 'platinum' },
      ],
      ranking: { player: 1, gold: 2, platinum: 3 },
    },
    {
      name: 'Rank down: Diamond → Platinum (1400 → 1280)',
      players: [
        { user_id: 'player', elo: 1400, rank_tier: 'diamond' },
        { user_id: 'bronze', elo: 800, rank_tier: 'bronze' },
        { user_id: 'silver', elo: 950, rank_tier: 'silver' },
      ],
      ranking: { player: 3, bronze: 1, silver: 2 },
    },
    {
      name: '4 equal silvers, all ~1000 ELO',
      players: [
        { user_id: 'a', elo: 1000, rank_tier: 'silver' },
        { user_id: 'b', elo: 1020, rank_tier: 'silver' },
        { user_id: 'c', elo: 980, rank_tier: 'silver' },
        { user_id: 'd', elo: 1010, rank_tier: 'silver' },
      ],
      ranking: { a: 1, b: 2, c: 3, d: 4 },
    },
    {
      name: '2v2: Golds vs Bronzes (top 2 win)',
      players: [
        { user_id: 'gold_a', elo: 1150, rank_tier: 'gold' },
        { user_id: 'gold_b', elo: 1120, rank_tier: 'gold' },
        { user_id: 'bronze_a', elo: 850, rank_tier: 'bronze' },
        { user_id: 'bronze_b', elo: 820, rank_tier: 'bronze' },
      ],
      ranking: { gold_a: 1, gold_b: 2, bronze_a: 3, bronze_b: 4 },
    },
    {
      name: '1v1 forfeit — same tier (should be ±3)',
      players: [
        { user_id: 'a', elo: 1000, rank_tier: 'silver' },
        { user_id: 'b', elo: 1000, rank_tier: 'silver' },
      ],
      ranking: { a: 1, b: 2 },
    },
  ];

  for (const s of scenarios) {
    const result = computeNewElos(s.players, s.ranking);
    console.log(`%c=== ${s.name} ===`, 'font-weight:bold');
    for (const r of result) {
      const player = s.players.find((p) => p.user_id === r.user_id);
      const sign = r.delta >= 0 ? '+' : '';
      const oldTier = tierFromElo(r.oldElo);
      const newTier = tierFromElo(r.newElo);
      const rankChange = oldTier !== newTier ? ` (${oldTier} → ${newTier})` : '';
      console.log(
        `  ${r.user_id} (${player.rank_tier}, ${r.oldElo}elo): ${r.oldElo} → ${r.newElo} (${sign}${r.delta})${rankChange}`,
      );
    }
  }
}

if (typeof window !== 'undefined') {
  window.testElo = runEloTests;
  window.computeElo = (players, ranking) => {
    console.log(computeNewElos(players, ranking));
  };
  window.tierFromElo = tierFromElo;
}
