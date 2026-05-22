'use strict';

const random = require('./random');

// Genre-aware matching: try to put artists who share a genre on the same
// team, then balance by skill so a beginner isn't lumped with three
// advanced producers.
//
// Algorithm:
//  1. Bucket signups by lowercased primary genre. Anyone with no genre
//     goes into a "_unknown" bucket.
//  2. For each bucket, run the random pairing within the bucket.
//  3. Any leftover singletons across buckets are merged and paired
//     randomly so nobody is alone.
//  4. If a team is all the same skill level, optionally swap one
//     member with another team to spread skill (best-effort, no global optimum).
function buildTeams(signups, { teamSize = 2 } = {}) {
  const buckets = new Map();
  for (const s of signups) {
    const key = (s.genre || '_unknown').toLowerCase().trim() || '_unknown';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(s);
  }

  const teams = [];
  const leftovers = [];

  for (const [, members] of buckets) {
    if (members.length >= teamSize) {
      const built = random.buildTeams(members, { teamSize });
      for (const t of built) {
        if (t.length >= teamSize) teams.push(t);
        else leftovers.push(...members.filter((m) => t.includes(m.user_id)));
      }
    } else {
      leftovers.push(...members);
    }
  }

  if (leftovers.length) {
    const built = random.buildTeams(leftovers, { teamSize });
    teams.push(...built);
  }

  return balanceSkill(teams, signups);
}

function balanceSkill(teams, signups) {
  const skillRank = { beginner: 1, intermediate: 2, advanced: 3 };
  const byId = new Map(signups.map((s) => [s.user_id, s]));

  function teamSkillSpread(team) {
    const skills = team.map((u) => skillRank[byId.get(u)?.skill] || 0);
    if (skills.length < 2) return 0;
    return Math.max(...skills) - Math.min(...skills);
  }

  // One pass: for each pair of teams, if a swap reduces the variance
  // imbalance, do it.
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      let bestSwap = null;
      let bestScore = teamSkillSpread(teams[i]) + teamSkillSpread(teams[j]);
      for (let a = 0; a < teams[i].length; a++) {
        for (let b = 0; b < teams[j].length; b++) {
          const newI = teams[i].slice();
          const newJ = teams[j].slice();
          [newI[a], newJ[b]] = [newJ[b], newI[a]];
          const score = teamSkillSpread(newI) + teamSkillSpread(newJ);
          if (score < bestScore) {
            bestScore = score;
            bestSwap = { a, b };
          }
        }
      }
      if (bestSwap) {
        const { a, b } = bestSwap;
        [teams[i][a], teams[j][b]] = [teams[j][b], teams[i][a]];
      }
    }
  }
  return teams;
}

module.exports = { buildTeams };
