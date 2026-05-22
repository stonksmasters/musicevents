'use strict';

// Local sanity check that does not touch Discord. Validates:
//  1. All source files parse.
//  2. DB migrations run cleanly against a temp file.
//  3. Each matching strategy produces valid teams on a fake roster.
//
// Run with: npm run dryrun

const fs = require('fs');
const path = require('path');
const os = require('os');

// Force a temp DB path before requiring db.js.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicevents-dryrun-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'dryrun-token';
process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || 'dryrun-client';

const assert = require('assert');

console.log('1. Parsing all source files...');
walk(path.join(__dirname, '..', 'src'), (f) => {
  if (f.endsWith('.js')) require(f);
});
console.log('   OK');

console.log('2. Verifying DB migrations...');
const { db, stmts } = require('../src/db');
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all()
  .map((r) => r.name);
for (const t of [
  'artists',
  'event_signups',
  'events',
  'guilds',
  'submissions',
  'team_members',
  'teams',
  'votes',
]) {
  assert(tables.includes(t), `missing table ${t}`);
}
console.log('   OK — tables:', tables.join(', '));

console.log('3. Smoke-testing matching strategies...');
const { strategies } = require('../src/matching');
const fakeSignups = [
  { user_id: 'u1', genre: 'hip hop', skill: 'beginner' },
  { user_id: 'u2', genre: 'hip hop', skill: 'advanced' },
  { user_id: 'u3', genre: 'lofi', skill: 'intermediate' },
  { user_id: 'u4', genre: 'lofi', skill: 'beginner' },
  { user_id: 'u5', genre: 'edm', skill: 'advanced' },
  { user_id: 'u6', genre: null, skill: null },
  { user_id: 'u7', genre: 'hip hop', skill: 'intermediate' },
];
for (const [name, mod] of Object.entries(strategies)) {
  const teams = mod.buildTeams(fakeSignups, { teamSize: 2 });
  console.log(`   ${name}: ${JSON.stringify(teams)}`);
  const flat = teams.flat();
  assert(flat.length === fakeSignups.length, `${name} dropped or duplicated artists`);
  assert(new Set(flat).size === flat.length, `${name} duplicated an artist`);
  for (const t of teams) assert(t.length >= 1, `${name} produced empty team`);
}

console.log('4. Inserting fake event/signups/teams...');
stmts.upsertGuild.run('g1', 'Test Guild');
const ev = stmts.insertEvent.run({
  guildId: 'g1',
  name: 'Test Event',
  matching: 'random',
  teamSize: 2,
  deadline: Math.floor(Date.now() / 1000) + 3600,
  createdBy: 'admin',
});
const eid = ev.lastInsertRowid;
for (const s of fakeSignups) {
  stmts.upsertArtist.run({
    guildId: 'g1',
    userId: s.user_id,
    genre: s.genre,
    daw: null,
    skill: s.skill,
  });
  stmts.joinEvent.run(eid, s.user_id);
}
const signups = stmts.signupsForEvent.all(eid);
assert(signups.length === fakeSignups.length, 'signups round-trip lost rows');

const teams = require('../src/matching').buildTeams('genre', signups, { teamSize: 2 });
for (let i = 0; i < teams.length; i++) {
  const tRow = stmts.insertTeam.run(eid, `Team ${i + 1}`);
  for (const u of teams[i]) stmts.insertTeamMember.run(tRow.lastInsertRowid, u);
}
console.log(
  '   teams in DB:',
  stmts.teamsForEvent.all(eid).map((t) => ({
    id: t.id,
    name: t.name,
    members: stmts.membersForTeam.all(t.id).map((m) => m.user_id),
  }))
);

console.log('\nAll dry-run checks passed.');
console.log('Temp DB:', process.env.DB_PATH);

function walk(dir, cb) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, cb);
    else cb(p);
  }
}
