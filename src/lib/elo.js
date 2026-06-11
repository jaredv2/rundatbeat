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

const TIER_K_FACTOR = {
  bronze: 32,
  silver: 32,
  gold: 36,
  platinum: 36,
  diamond: 40,
  elite: 40,
  champion: 44,
  goat: 48,
};

export function tierFromElo(elo) {
  for (const t of TIER_THRESHOLDS) {
    if (elo >= t.elo) return t.tier;
  }
  return 'bronze';
}

export function tierOrder(tier) {
  const tiers = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'elite', 'champion', 'goat'];
  return tiers.indexOf(tier?.toLowerCase());
}

export function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function newElo(rating, expected, actual, K) {
  return Math.round(rating + K * (actual - expected));
}

export function getPlayerKFactor(playerElo, lobbyAvgElo) {
  const diff = playerElo - lobbyAvgElo;
  const baseK = 32;
  const adjustment = Math.round(Math.max(-16, Math.min(16, diff / 100)));
  return Math.max(16, Math.min(64, baseK + adjustment));
}

export function computeLobbyAverageElo(players) {
  if (!players?.length) return DEFAULT_ELO;
  return players.reduce((sum, p) => sum + (p.elo ?? DEFAULT_ELO), 0) / players.length;
}

function positionScore(position, totalPlayers) {
  if (totalPlayers <= 2) {
    return position === 0 ? 1.0 : 0.0;
  }
  if (position === 0) return 1.0;
  if (position === 1) return 0.4;
  if (position === 2) return 0.15;
  return 0.0;
}

export function computeNewElos(players, ranking) {
  const sorted = [...players].sort((a, b) => (ranking[a.user_id] ?? 99) - (ranking[b.user_id] ?? 99));
  const n = sorted.length;
  const lobbyAvgElo = computeLobbyAverageElo(players);

  return sorted.map((p, i) => {
    const actual = n > 1 ? positionScore(i, n) : 0.5;
    const expected = sorted
      .filter((o) => o.user_id !== p.user_id)
      .reduce((sum, o) => sum + expectedScore(p.elo ?? DEFAULT_ELO, o.elo ?? DEFAULT_ELO), 0)
      / (n - 1);
    const K = getPlayerKFactor(p.elo ?? DEFAULT_ELO, lobbyAvgElo);
    return {
      user_id: p.user_id,
      newElo: newElo(p.elo ?? DEFAULT_ELO, expected, actual, K),
      oldElo: p.elo ?? DEFAULT_ELO,
      kFactor: K,
      expected: +expected.toFixed(3),
      actual: +actual.toFixed(3),
    };
  });
}

// ── Debug helpers (callable from browser console) ─────────

export function runEloTests() {
  const scenarios = [
    {
      name: 'Bronze beats Diamond (1v1)',
      players: [
        { user_id: 'bronze', elo: 800, rank_tier: 'bronze' },
        { user_id: 'diamond', elo: 1400, rank_tier: 'diamond' },
      ],
      ranking: { bronze: 1, diamond: 2 },
    },
    {
      name: 'Diamond beats Bronze (1v1)',
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
  ];

  for (const s of scenarios) {
    const result = computeNewElos(s.players, s.ranking);
    console.log(`%c=== ${s.name} ===`, 'font-weight:bold');
    for (const r of result) {
      const player = s.players.find((p) => p.user_id === r.user_id);
      const delta = r.newElo - r.oldElo;
      const sign = delta >= 0 ? '+' : '';
      const oldTier = tierFromElo(r.oldElo);
      const newTier = tierFromElo(r.newElo);
      const rankChange = oldTier !== newTier ? ` (${oldTier} → ${newTier})` : '';
      console.log(
        `  ${r.user_id} (${player.rank_tier}, ${r.oldElo}elo): ${r.oldElo} → ${r.newElo} (${sign}${delta})${rankChange}  K=${r.kFactor}  expected=${r.expected}  actual=${r.actual}`,
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
