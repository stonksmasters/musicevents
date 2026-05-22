'use strict';

// MMR-balanced matching using snake-draft order.
// Sorts artists by MMR descending, then assigns them to teams in a
// snake pattern so team total MMR stays even (strongest + weakest together).
function buildTeams(signups, { teamSize = 2 } = {}) {
  const ranked = [...signups].sort((a, b) => (b.mmr || 1000) - (a.mmr || 1000));
  const numTeams = Math.max(1, Math.ceil(ranked.length / teamSize));
  const teams = Array.from({ length: numTeams }, () => []);

  let dir = 1;
  let idx = 0;
  for (const signup of ranked) {
    teams[idx].push(signup.user_id);
    idx += dir;
    if (idx >= numTeams) {
      dir = -1;
      idx = numTeams - 1;
    } else if (idx < 0) {
      dir = 1;
      idx = 0;
    }
  }

  return teams.filter((t) => t.length > 0);
}

module.exports = { buildTeams };
