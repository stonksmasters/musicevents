'use strict';

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Chunk shuffled signups into teams of teamSize. Leftover artists are
// distributed one-by-one across existing teams (so a leftover never plays
// solo) unless we have fewer than teamSize signups total, in which case
// we make a single best-effort team.
function buildTeams(signups, { teamSize = 2 } = {}) {
  const ids = shuffle(signups.map((s) => s.user_id));
  if (ids.length === 0) return [];
  if (ids.length <= teamSize) return [ids];

  const teams = [];
  let i = 0;
  while (i + teamSize <= ids.length) {
    teams.push(ids.slice(i, i + teamSize));
    i += teamSize;
  }
  // distribute remainder
  let t = 0;
  while (i < ids.length) {
    teams[t % teams.length].push(ids[i]);
    i++;
    t++;
  }
  return teams;
}

module.exports = { buildTeams };
