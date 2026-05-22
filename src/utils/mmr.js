'use strict';

const K = 32;
const DEFAULT_MMR = 1000;

function expectedScore(myMmr, opponentMmr) {
  return 1 / (1 + Math.pow(10, (opponentMmr - myMmr) / 400));
}

function avgMmr(userIds, userMmrs) {
  if (userIds.length === 0) return DEFAULT_MMR;
  const sum = userIds.reduce((s, uid) => s + (userMmrs.get(uid) || DEFAULT_MMR), 0);
  return sum / userIds.length;
}

// Returns Map<userId, { newMmr, delta, win }>
// winnerTeamId: the team_id that won
// teams: [{ team_id, user_ids: [...] }]
// stmts + guildId: used to fetch current MMR
function calculateDeltas(teams, winnerTeamId, { stmts, guildId }) {
  const userMmrs = new Map();
  for (const team of teams) {
    for (const uid of team.user_ids) {
      const row = stmts.getRanking.get(guildId, uid);
      userMmrs.set(uid, row?.mmr ?? DEFAULT_MMR);
    }
  }

  const winnerTeam = teams.find((t) => t.team_id === winnerTeamId);
  const loserTeams = teams.filter((t) => t.team_id !== winnerTeamId);

  const loserUserIds = loserTeams.flatMap((t) => t.user_ids);
  const loserAvg = avgMmr(loserUserIds, userMmrs);
  const winnerAvg = winnerTeam ? avgMmr(winnerTeam.user_ids, userMmrs) : DEFAULT_MMR;

  const result = new Map();

  if (winnerTeam) {
    for (const uid of winnerTeam.user_ids) {
      const myMmr = userMmrs.get(uid) || DEFAULT_MMR;
      const delta = Math.round(K * (1 - expectedScore(myMmr, loserAvg)));
      result.set(uid, { newMmr: Math.max(0, myMmr + delta), delta, win: true });
    }
  }

  for (const team of loserTeams) {
    for (const uid of team.user_ids) {
      const myMmr = userMmrs.get(uid) || DEFAULT_MMR;
      const delta = Math.round(K * (0 - expectedScore(myMmr, winnerAvg)));
      result.set(uid, { newMmr: Math.max(0, myMmr + delta), delta, win: false });
    }
  }

  return result;
}

const TIERS = [
  { min: 1800, label: '💎 Diamond', color: 0x00bfff },
  { min: 1600, label: '🥇 Gold',    color: 0xffd700 },
  { min: 1400, label: '🥈 Silver',  color: 0xc0c0c0 },
  { min: 1200, label: '🥉 Bronze',  color: 0xcd7f32 },
  { min: 0,    label: '⚙️ Iron',    color: 0x808080 },
];

function getTier(mmr) {
  return TIERS.find((t) => mmr >= t.min) || TIERS[TIERS.length - 1];
}

module.exports = { calculateDeltas, getTier, DEFAULT_MMR };
