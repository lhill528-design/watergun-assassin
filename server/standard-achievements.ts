// The canonical "Load All 52" achievement catalog, used by
// achievement.seedAll (server/routers.ts). Lives server-side (mirroring
// server/standard-rules.ts) since the server is now the one place that
// decides what actually gets inserted, and seeding is idempotent by name
// -- the client no longer needs its own copy.
export interface StandardAchievementDefinition {
  name: string;
  description: string;
  emoji: string;
  pointsValue: number;
  condition: string;
  achievementType: string;
  category: string;
}

export const ACHIEVEMENT_CATALOG: StandardAchievementDefinition[] = [
  // === COMBAT ACHIEVEMENTS ===
  { name: "First Blood", description: "Get your 1st elimination", emoji: "🩸", pointsValue: 50, condition: "lifetime_eliminations >= 1", achievementType: "combat", category: "Lifetime" },
  { name: "Public Menace", description: "Get 15 eliminations", emoji: "😈", pointsValue: 200, condition: "lifetime_eliminations >= 15", achievementType: "combat", category: "Lifetime" },
  { name: "Living Legend", description: "Get 25 eliminations", emoji: "🏆", pointsValue: 500, condition: "lifetime_eliminations >= 25", achievementType: "combat", category: "Lifetime" },
  { name: "Elimination God", description: "Get 50 eliminations", emoji: "💀", pointsValue: 750, condition: "lifetime_eliminations >= 50", achievementType: "combat", category: "Lifetime" },
  { name: "Wet Bandit", description: "Get 1st elimination of the game", emoji: "🔫", pointsValue: 150, condition: "game_first_elimination", achievementType: "combat", category: "Game" },
  { name: "Predator", description: "Get 5 eliminations in one game", emoji: "🦅", pointsValue: 250, condition: "game_eliminations >= 5", achievementType: "combat", category: "Game" },
  { name: "Apex Predator", description: "Get 10 eliminations in one game", emoji: "🦁", pointsValue: 500, condition: "game_eliminations >= 10", achievementType: "combat", category: "Game" },
  { name: "Sharpsquirter", description: "Get the 1st elimination of the round", emoji: "💧", pointsValue: 150, condition: "round_first_elimination", achievementType: "combat", category: "Round" },
  { name: "Serial Soaker", description: "Get 3 eliminations in one round", emoji: "🌊", pointsValue: 250, condition: "round_eliminations >= 3", achievementType: "combat", category: "Round" },
  { name: "Drip Queen", description: "Get 5 eliminations in one round", emoji: "👑", pointsValue: 500, condition: "round_eliminations >= 5", achievementType: "combat", category: "Round" },
  { name: "Cat Burglar", description: "Use 1 theft power-up in one game", emoji: "🐱", pointsValue: 200, condition: "game_theft_powerups >= 1", achievementType: "combat", category: "Game" },
  { name: "Master Thief", description: "Use 3 theft power-ups in one game", emoji: "🥷", pointsValue: 300, condition: "game_theft_powerups >= 3", achievementType: "combat", category: "Game" },
  { name: "Crime Boss", description: "Use 10+ power-ups in one game", emoji: "🤵", pointsValue: 500, condition: "game_powerups_used >= 10", achievementType: "combat", category: "Game" },
  { name: "Hit List", description: "Place a bounty on active player in one game", emoji: "📋", pointsValue: 200, condition: "game_bounties_placed >= 1", achievementType: "combat", category: "Game" },
  { name: "Bounty Broker", description: "Place 5 bounties on active player in one game", emoji: "💰", pointsValue: 300, condition: "game_bounties_placed >= 5", achievementType: "combat", category: "Game" },
  { name: "Crime Syndicate", description: "Place 10+ bounties on active player in one game", emoji: "🏦", pointsValue: 500, condition: "game_bounties_placed >= 10", achievementType: "combat", category: "Game" },
  { name: "Tracker", description: "Collect 1 bounty in one game", emoji: "🎯", pointsValue: 150, condition: "game_bounties_collected >= 1", achievementType: "combat", category: "Game" },
  { name: "Bounty Hunter", description: "Collect 5 bounties in one game", emoji: "🏹", pointsValue: 400, condition: "game_bounties_collected >= 5", achievementType: "combat", category: "Game" },
  { name: "Legend Hunter", description: "Collect 10+ bounties in one game", emoji: "⚔️", pointsValue: 650, condition: "game_bounties_collected >= 10", achievementType: "combat", category: "Game" },
  { name: "Killing Spree", description: "Get 3 eliminations without dying in one game", emoji: "🔥", pointsValue: 250, condition: "game_kill_streak >= 3", achievementType: "combat", category: "Game" },
  { name: "Rampage", description: "Get 5 eliminations without dying in one game", emoji: "💥", pointsValue: 500, condition: "game_kill_streak >= 5", achievementType: "combat", category: "Game" },
  { name: "One Man Army", description: "Get 10+ eliminations in one game without dying", emoji: "🪖", pointsValue: 750, condition: "game_kill_streak >= 10", achievementType: "combat", category: "Game" },
  { name: "No Mercy", description: "Eliminate 3 players during open season or a purge", emoji: "😤", pointsValue: 250, condition: "purge_eliminations >= 3", achievementType: "combat", category: "Game" },
  { name: "Grudge Match", description: "Eliminate 5 players during open season or a purge", emoji: "😡", pointsValue: 500, condition: "purge_eliminations >= 5", achievementType: "combat", category: "Game" },
  { name: "Uno Reverse", description: "Eliminate any of your previous or current hunters during a purge", emoji: "🔄", pointsValue: 150, condition: "purge_hunter_elimination", achievementType: "combat", category: "Game" },
  // === SURVIVAL ACHIEVEMENTS ===
  { name: "Dry as a Bone", description: "Survive 3 consecutive rounds", emoji: "🦴", pointsValue: 75, condition: "consecutive_rounds_survived >= 3", achievementType: "survival", category: "Game" },
  { name: "Untouchable", description: "Survive 5 consecutive rounds", emoji: "🛡️", pointsValue: 125, condition: "consecutive_rounds_survived >= 5", achievementType: "survival", category: "Game" },
  { name: "Shell", description: "Use 3 defensive power-ups", emoji: "🐢", pointsValue: 75, condition: "game_defensive_powerups >= 3", achievementType: "survival", category: "Game" },
  { name: "Bunker", description: "Use 10 defensive power-ups", emoji: "🏰", pointsValue: 250, condition: "game_defensive_powerups >= 10", achievementType: "survival", category: "Game" },
  { name: "Fortress", description: "Use 25 defensive power-ups", emoji: "🗼", pointsValue: 500, condition: "game_defensive_powerups >= 25", achievementType: "survival", category: "Game" },
  { name: "The Comeback Kid", description: "Get eliminated, revive and get an elimination in one round", emoji: "🔁", pointsValue: 250, condition: "round_revive_then_eliminate", achievementType: "survival", category: "Round" },
  { name: "Apparition", description: "Vanish from map 5x in one game", emoji: "👻", pointsValue: 75, condition: "game_vanish_count >= 5", achievementType: "survival", category: "Game" },
  { name: "Ghost Story", description: "Vanish from map 10x in one game", emoji: "🌫️", pointsValue: 150, condition: "game_vanish_count >= 10", achievementType: "survival", category: "Game" },
  { name: "Urban Legend", description: "Vanish 25x in one game", emoji: "🕸️", pointsValue: 300, condition: "game_vanish_count >= 25", achievementType: "survival", category: "Game" },
  { name: "On the Run", description: "Survive one bounty", emoji: "🏃", pointsValue: 100, condition: "game_bounties_survived >= 1", achievementType: "survival", category: "Game" },
  { name: "Public Enemy", description: "Survive 3 bounties", emoji: "🚨", pointsValue: 300, condition: "game_bounties_survived >= 3", achievementType: "survival", category: "Game" },
  { name: "Most Wanted", description: "Survive 5 bounties", emoji: "🎪", pointsValue: 500, condition: "game_bounties_survived >= 5", achievementType: "survival", category: "Game" },
  { name: "Bulletproof", description: "Survive 3 open seasons or purges", emoji: "🔒", pointsValue: 175, condition: "purges_survived >= 3", achievementType: "survival", category: "Game" },
  { name: "Above the Law", description: "Survive 5 open seasons or purges", emoji: "⚖️", pointsValue: 400, condition: "purges_survived >= 5", achievementType: "survival", category: "Game" },
  { name: "Not Today Satan", description: "Survive 8 open seasons or purges", emoji: "😇", pointsValue: 750, condition: "purges_survived >= 8", achievementType: "survival", category: "Game" },
  // === CHAOS ACHIEVEMENTS ===
  { name: "Shopaholic", description: "Purchase 5 power-ups", emoji: "🛍️", pointsValue: 100, condition: "game_powerups_purchased >= 5", achievementType: "chaos", category: "Game" },
  { name: "Big Spender", description: "Purchase 10 power-ups", emoji: "💸", pointsValue: 250, condition: "game_powerups_purchased >= 10", achievementType: "chaos", category: "Game" },
  { name: "Hoarder", description: "Purchase 15+ power-ups", emoji: "📦", pointsValue: 500, condition: "game_powerups_purchased >= 15", achievementType: "chaos", category: "Game" },
  { name: "Risk Taker", description: "Spin roulette wheel 1x", emoji: "🎲", pointsValue: 75, condition: "game_roulette_spins >= 1", achievementType: "chaos", category: "Game" },
  { name: "High Roller", description: "Spin roulette wheel 5x", emoji: "🎰", pointsValue: 150, condition: "game_roulette_spins >= 5", achievementType: "chaos", category: "Game" },
  { name: "Gambling Addict", description: "Spin roulette wheel 10x", emoji: "🃏", pointsValue: 450, condition: "game_roulette_spins >= 10", achievementType: "chaos", category: "Game" },
  { name: "Instigator", description: "Use 2 chaos power-ups", emoji: "😏", pointsValue: 200, condition: "game_chaos_powerups >= 2", achievementType: "chaos", category: "Game" },
  { name: "Loose Cannon", description: "Use 5 chaos power-ups", emoji: "💣", pointsValue: 450, condition: "game_chaos_powerups >= 5", achievementType: "chaos", category: "Game" },
  { name: "Anarchist", description: "Use 10 chaos power-ups", emoji: "🔥", pointsValue: 650, condition: "game_chaos_powerups >= 10", achievementType: "chaos", category: "Game" },
  { name: "Good Samaritan", description: "Gift 1 power-up", emoji: "🎁", pointsValue: 125, condition: "game_powerups_gifted >= 1", achievementType: "chaos", category: "Game" },
  { name: "Donor", description: "Gift 5 power-ups", emoji: "🤝", pointsValue: 375, condition: "game_powerups_gifted >= 5", achievementType: "chaos", category: "Game" },
  { name: "Sugar Mama", description: "Gift 10 power-ups", emoji: "🍬", pointsValue: 750, condition: "game_powerups_gifted >= 10", achievementType: "chaos", category: "Game" },
];
