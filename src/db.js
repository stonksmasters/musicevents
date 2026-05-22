'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------- migrations ----------
// Each migration is run inside a transaction. Add new ones to the end.
const migrations = [
  // 0001 initial schema
  `
  CREATE TABLE IF NOT EXISTS guilds (
    guild_id TEXT PRIMARY KEY,
    name TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    matching TEXT NOT NULL DEFAULT 'random',  -- random | genre | draft
    team_size INTEGER NOT NULL DEFAULT 2,
    deadline INTEGER,                         -- unix seconds, when /submit closes
    state TEXT NOT NULL DEFAULT 'signup',     -- signup | active | voting | finished
    voting_channel_id TEXT,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS artists (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    genre TEXT,
    daw TEXT,
    skill TEXT,                  -- beginner | intermediate | advanced
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS event_signups (
    event_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    joined_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (event_id, user_id),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    channel_id TEXT,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS team_members (
    team_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (team_id, user_id),
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL UNIQUE,
    uploader_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    message_id TEXT,                     -- voting message in voting channel
    submitted_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id)  REFERENCES teams(id)  ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS votes (
    event_id INTEGER NOT NULL,
    voter_id TEXT NOT NULL,
    team_id INTEGER NOT NULL,
    voted_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (event_id, voter_id),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id)  REFERENCES teams(id)  ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_events_guild ON events(guild_id);
  CREATE INDEX IF NOT EXISTS idx_signups_event ON event_signups(event_id);
  CREATE INDEX IF NOT EXISTS idx_teams_event ON teams(event_id);
  `,

  // 0002 MMR rankings, guild settings, challenges
  `
  CREATE TABLE IF NOT EXISTS rankings (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    mmr      INTEGER NOT NULL DEFAULT 1000,
    wins     INTEGER NOT NULL DEFAULT 0,
    losses   INTEGER NOT NULL DEFAULT 0,
    events_played INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id              TEXT PRIMARY KEY,
    default_matching      TEXT NOT NULL DEFAULT 'random',
    announce_channel_id   TEXT,
    challenge_enabled     INTEGER NOT NULL DEFAULT 1,
    challenge_pool        TEXT NOT NULL DEFAULT '[]',
    challenge_interval_min INTEGER NOT NULL DEFAULT 20,
    challenge_interval_max INTEGER NOT NULL DEFAULT 60,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS challenges (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id     INTEGER NOT NULL,
    text         TEXT NOT NULL,
    triggered_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_rankings_guild ON rankings(guild_id, mmr DESC);
  CREATE INDEX IF NOT EXISTS idx_challenges_event ON challenges(event_id);
  `,

  // 0003 add started_at to events
  `
  ALTER TABLE events ADD COLUMN started_at INTEGER;
  `,

  // 0004 add voice_channel_id to teams
  `
  ALTER TABLE teams ADD COLUMN voice_channel_id TEXT;
  `,

  // 0005 add submissions_channel_id and category_id to events,
  //      and announcement_message_id (for the join button message)
  `
  ALTER TABLE events ADD COLUMN submissions_channel_id TEXT;
  ALTER TABLE events ADD COLUMN category_id TEXT;
  ALTER TABLE events ADD COLUMN announcement_message_id TEXT;
  ALTER TABLE events ADD COLUMN announcement_channel_id TEXT;
  `,

  // 0006 add winners_channel_id to guild_settings
  `
  ALTER TABLE guild_settings ADD COLUMN winners_channel_id TEXT;
  `,
];

function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version)
  );
  const txn = db.transaction((sqls) => {
    sqls.forEach(({ version, sql }) => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(version);
    });
  });
  const pending = migrations
    .map((sql, i) => ({ version: i + 1, sql }))
    .filter(({ version }) => !applied.has(version));
  if (pending.length) txn(pending);
}

runMigrations();

// ---------- helpers ----------
const stmts = {
  upsertGuild: db.prepare(
    'INSERT INTO guilds(guild_id, name) VALUES(?, ?) ON CONFLICT(guild_id) DO UPDATE SET name=excluded.name'
  ),

  insertEvent: db.prepare(
    `INSERT INTO events(guild_id, name, matching, team_size, deadline, created_by)
     VALUES(@guildId, @name, @matching, @teamSize, @deadline, @createdBy)`
  ),
  getEvent: db.prepare('SELECT * FROM events WHERE id = ?'),
  listEventsByGuild: db.prepare('SELECT * FROM events WHERE guild_id = ? ORDER BY id DESC'),
  setEventState: db.prepare('UPDATE events SET state = ? WHERE id = ?'),
  setEventStarted: db.prepare("UPDATE events SET started_at = strftime('%s','now') WHERE id = ?"),
  setEventSubmissionsChannel: db.prepare('UPDATE events SET submissions_channel_id = ? WHERE id = ?'),
  setEventCategory: db.prepare('UPDATE events SET category_id = ? WHERE id = ?'),
  setEventAnnouncement: db.prepare('UPDATE events SET announcement_channel_id = ?, announcement_message_id = ? WHERE id = ?'),
  setVotingChannel: db.prepare('UPDATE events SET voting_channel_id = ? WHERE id = ?'),

  upsertArtist: db.prepare(
    `INSERT INTO artists(guild_id, user_id, genre, daw, skill)
     VALUES(@guildId, @userId, @genre, @daw, @skill)
     ON CONFLICT(guild_id, user_id) DO UPDATE SET
       genre = COALESCE(excluded.genre, artists.genre),
       daw   = COALESCE(excluded.daw,   artists.daw),
       skill = COALESCE(excluded.skill, artists.skill),
       updated_at = strftime('%s','now')`
  ),
  getArtist: db.prepare('SELECT * FROM artists WHERE guild_id = ? AND user_id = ?'),

  joinEvent: db.prepare(
    'INSERT OR IGNORE INTO event_signups(event_id, user_id) VALUES(?, ?)'
  ),
  leaveEvent: db.prepare('DELETE FROM event_signups WHERE event_id = ? AND user_id = ?'),
  signupsForEvent: db.prepare(
    `SELECT s.user_id, a.genre, a.daw, a.skill,
            COALESCE(r.mmr, 1000) AS mmr
     FROM event_signups s
     LEFT JOIN artists a
       ON a.user_id = s.user_id
       AND a.guild_id = (SELECT guild_id FROM events WHERE id = s.event_id)
     LEFT JOIN rankings r
       ON r.user_id = s.user_id
       AND r.guild_id = (SELECT guild_id FROM events WHERE id = s.event_id)
     WHERE s.event_id = ?
     ORDER BY s.joined_at ASC`
  ),

  insertTeam: db.prepare('INSERT INTO teams(event_id, name) VALUES(?, ?)'),
  setTeamChannel: db.prepare('UPDATE teams SET channel_id = ? WHERE id = ?'),
  setTeamVoiceChannel: db.prepare('UPDATE teams SET voice_channel_id = ? WHERE id = ?'),
  insertTeamMember: db.prepare('INSERT INTO team_members(team_id, user_id) VALUES(?, ?)'),
  teamsForEvent: db.prepare('SELECT * FROM teams WHERE event_id = ? ORDER BY id ASC'),
  membersForTeam: db.prepare('SELECT user_id FROM team_members WHERE team_id = ?'),
  teamForUser: db.prepare(
    `SELECT t.* FROM teams t
     JOIN team_members m ON m.team_id = t.id
     WHERE t.event_id = ? AND m.user_id = ?`
  ),

  insertSubmission: db.prepare(
    `INSERT INTO submissions(event_id, team_id, uploader_id, file_path, file_name)
     VALUES(@eventId, @teamId, @uploaderId, @filePath, @fileName)
     ON CONFLICT(team_id) DO UPDATE SET
       uploader_id = excluded.uploader_id,
       file_path   = excluded.file_path,
       file_name   = excluded.file_name,
       submitted_at = strftime('%s','now')`
  ),
  setSubmissionMessage: db.prepare('UPDATE submissions SET message_id = ? WHERE team_id = ?'),
  submissionsForEvent: db.prepare('SELECT * FROM submissions WHERE event_id = ?'),

  recordVote: db.prepare(
    `INSERT INTO votes(event_id, voter_id, team_id) VALUES(?, ?, ?)
     ON CONFLICT(event_id, voter_id) DO UPDATE SET team_id = excluded.team_id, voted_at = strftime('%s','now')`
  ),
  removeVote: db.prepare('DELETE FROM votes WHERE event_id = ? AND voter_id = ?'),
  tallyVotes: db.prepare(
    `SELECT team_id, COUNT(*) AS votes FROM votes WHERE event_id = ? GROUP BY team_id ORDER BY votes DESC`
  ),

  // rankings
  getRanking: db.prepare('SELECT * FROM rankings WHERE guild_id = ? AND user_id = ?'),
  topRankings: db.prepare(
    'SELECT * FROM rankings WHERE guild_id = ? ORDER BY mmr DESC LIMIT ?'
  ),
  upsertRanking: db.prepare(
    `INSERT INTO rankings(guild_id, user_id, mmr, wins, losses, events_played)
     VALUES(@guildId, @userId, @mmr, @wins, @losses, @eventsPlayed)
     ON CONFLICT(guild_id, user_id) DO UPDATE SET
       mmr = excluded.mmr,
       wins = excluded.wins,
       losses = excluded.losses,
       events_played = excluded.events_played,
       updated_at = strftime('%s','now')`
  ),
  membersAllTeams: db.prepare(
    `SELECT tm.user_id, tm.team_id FROM team_members tm
     JOIN teams t ON t.id = tm.team_id
     WHERE t.event_id = ?`
  ),

  // guild settings
  getGuildSettings: db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?'),
  upsertGuildSettings: db.prepare(
    `INSERT INTO guild_settings(guild_id, default_matching, announce_channel_id, winners_channel_id,
       challenge_enabled, challenge_pool, challenge_interval_min, challenge_interval_max)
     VALUES(@guildId, @defaultMatching, @announceChannelId, @winnersChannelId,
       @challengeEnabled, @challengePool, @challengeIntervalMin, @challengeIntervalMax)
     ON CONFLICT(guild_id) DO UPDATE SET
       default_matching      = excluded.default_matching,
       announce_channel_id   = excluded.announce_channel_id,
       winners_channel_id    = excluded.winners_channel_id,
       challenge_enabled     = excluded.challenge_enabled,
       challenge_pool        = excluded.challenge_pool,
       challenge_interval_min = excluded.challenge_interval_min,
       challenge_interval_max = excluded.challenge_interval_max,
       updated_at = strftime('%s','now')`
  ),
  setAnnounceChannel: db.prepare(
    `INSERT INTO guild_settings(guild_id, announce_channel_id) VALUES(?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET announce_channel_id = excluded.announce_channel_id, updated_at = strftime('%s','now')`
  ),
  setWinnersChannel: db.prepare(
    `INSERT INTO guild_settings(guild_id, winners_channel_id) VALUES(?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET winners_channel_id = excluded.winners_channel_id, updated_at = strftime('%s','now')`
  ),

  // challenges
  insertChallenge: db.prepare(
    'INSERT INTO challenges(event_id, text) VALUES(@eventId, @text)'
  ),
  challengesForEvent: db.prepare(
    'SELECT * FROM challenges WHERE event_id = ? ORDER BY triggered_at ASC'
  ),

  // dashboard helpers
  submissionsWithTeam: db.prepare(
    `SELECT s.*, t.name AS team_name, t.channel_id AS team_channel_id
     FROM submissions s
     JOIN teams t ON t.id = s.team_id
     WHERE s.event_id = ?
     ORDER BY s.submitted_at ASC`
  ),
  voteCountsForEvent: db.prepare(
    'SELECT team_id, COUNT(*) AS votes FROM votes WHERE event_id = ? GROUP BY team_id'
  ),
};

module.exports = {
  db,
  stmts,
};
