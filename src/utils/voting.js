'use strict';

// Single shared emoji used for voting. Reacting with this on a
// submission post in the voting channel = a vote for that team.
const TEAM_EMOJI = '🗳️';

function formatLeaderboard(rows, teams) {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  if (rows.length === 0) return 'No votes yet.';
  return rows
    .map((r, i) => {
      const t = teamById.get(r.team_id);
      const name = t ? t.name : `team#${r.team_id}`;
      return `${i + 1}. ${name} — ${r.votes} vote${r.votes === 1 ? '' : 's'}`;
    })
    .join('\n');
}

module.exports = { TEAM_EMOJI, formatLeaderboard };
