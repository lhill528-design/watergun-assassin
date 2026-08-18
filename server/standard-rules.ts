// The canonical standard-rules catalog per game type, used by
// rules.seedStandard (server/routers.ts). Lives server-side (rather than
// duplicated in app/admin/rules.tsx, where it previously lived purely for
// client-side display/counting) since the server is now the one place
// that actually decides what gets inserted -- the client no longer needs
// its own copy at all, only the counts the mutation returns.
export type StandardRulesGameType = "last_man_standing" | "highest_points" | "most_eliminations" | "teams";

export const STANDARD_RULES: Record<StandardRulesGameType, string[]> = {
  last_man_standing: [
    "Players are eliminated when hit with a water gun",
    "Safe object must be held (not just carried) to be immune",
    "No eliminations inside homes or workplaces",
    "No eliminations while target is driving",
    "Video evidence required for all eliminations",
    "Eliminated players cannot reveal their assassin",
    "No water balloons or super soakers - pistols only",
    "Players must update location every 4 hours during active rounds",
  ],
  highest_points: [
    "Points awarded per elimination: 100",
    "Bonus points for creative eliminations: 50",
    "Points deducted for false claims: -50",
    "Safe object must be held to be immune",
    "Video evidence required for all eliminations",
    "No eliminations inside homes or workplaces",
    "Players can be eliminated multiple times",
    "Players respawn after 2 hours",
  ],
  most_eliminations: [
    "Only confirmed kills count toward total",
    "Video evidence required for all eliminations",
    "Safe object must be held to be immune",
    "No eliminations inside homes or workplaces",
    "No eliminations while target is driving",
    "Players respawn after 1 hour",
    "Ties broken by fewer deaths",
  ],
  teams: [
    "Teams of 2 players each",
    "Both team members must be eliminated to be out",
    "Partners can revive each other once per round",
    "Safe object applies to both team members",
    "Video evidence required for all eliminations",
    "No eliminations inside homes or workplaces",
    "Team communication is encouraged",
  ],
};
