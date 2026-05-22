'use strict';

const random = require('./random');

// Captain draft: pick the top `numTeams` signups (by skill, fall back to
// signup order) as captains, then snake-draft the remaining artists into
// their teams in a deterministic-but-shuffled order.
//
// This v1 stub uses skill ranking when available; a real captain-driven
// UI (where humans actually pick) is a future extension. For now the
// strategy still produces valid teams without blocking the rest of the
// pipeline.
function buildTeams(signups, { teamSize = 2 } = {}) {
  if (signups.length === 0) return [];
  if (signups.length <= teamSize) return [signups.map((s) => s.user_id)];

  const numTeams = Math.max(1, Math.floor(signups.length / teamSize));

  const skillRank = { advanced: 3, intermediate: 2, beginner: 1 };
  const ranked = signups
    .map((s) => ({ ...s, _r: skillRank[s.skill] || 0 }))
    .sort((a, b) => b._r - a._r);

  const captains = ranked.slice(0, numTeams);
  const pool = ranked.slice(numTeams);

  // shuffle the pool to randomize fall-through after captains
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const teams = captains.map((c) => [c.user_id]);
  let dir = 1;
  let idx = 0;
  for (const p of pool) {
    teams[idx].push(p.user_id);
    idx += dir;
    if (idx === teams.length) {
      dir = -1;
      idx = teams.length - 1;
    } else if (idx < 0) {
      dir = 1;
      idx = 0;
    }
  }

  // If somebody got left over due to mod math, dump them in the smallest team.
  return teams.length ? teams : random.buildTeams(signups, { teamSize });
}

module.exports = { buildTeams };
