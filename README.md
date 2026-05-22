# MusicEvents Bot

A Discord bot for running music collaboration events inside a server. Artists sign up, the bot pairs them into teams, each team gets a private channel to make a song, then submissions are uploaded to the bot and the community votes on the winner.

## Quick start

```bash
npm install
cp .env.example .env   # fill in DISCORD_TOKEN + DISCORD_CLIENT_ID
npm run deploy         # register slash commands with Discord
npm start              # run the bot
```

If `DEV_GUILD_ID` is set in `.env`, slash commands are registered only to that guild (instant). Otherwise they deploy globally (can take up to an hour to propagate).

## Slash commands

Admin (Manage Server):
- `/event create name:<str> matching:<random|genre|draft> deadline:<ISO-date> team_size:<int>` — create an event in this server.
- `/event start id:<int>` — close signups, run matching, create per-team private channels.
- `/event end id:<int>` — close submissions, post all songs to a voting channel, open reaction voting.
- `/event tally id:<int>` — count votes and announce the winner.
- `/event list` — list events in this server.
- `/event info id:<int>` — show details + signed-up artists.

Artist:
- `/join id:<int>` — sign up for an event (only allowed before it starts).
- `/leave id:<int>` — drop out of an event before it starts.
- `/profile set genre:<str> daw:<str> skill:<beginner|intermediate|advanced>` — set your artist profile (used by genre/skill matching).
- `/profile view [user:<@user>]` — view your or another user's profile.
- `/submit id:<int> file:<attachment>` — upload your team's song before the deadline.

## Architecture

```
src/
  index.js              boots client, loads commands and event handlers
  db.js                 better-sqlite3 setup + migrations
  config.js             env loading
  deploy-commands.js    push slash command definitions to Discord
  commands/             one file per top-level slash command
  events/               discord.js event handlers (ready, interactionCreate)
  matching/             pluggable matching strategies (random, genre, draft)
  utils/                channel + voting helpers
data/
  musicevents.db        SQLite database (created on first run)
  uploads/              audio files saved by /submit
scripts/
  dryrun.js             local sanity check that does not touch Discord
```

## Data model

- `events` — one row per collab event, with state machine: `signup -> active -> voting -> finished`.
- `artists` — server-scoped artist profile (genre/DAW/skill).
- `event_signups` — which artists joined which event.
- `teams` + `team_members` — teams produced by the matching strategy.
- `submissions` — one per team per event, points at uploaded file.
- `votes` — one row per voter per event for tallying.

## Matching strategies

Set `matching` when creating an event:
- `random` — shuffle and chunk into teams of `team_size`.
- `genre` — group by primary genre, fill in by skill compatibility.
- `draft` — captains alternate picks (stub; v1 falls back to random).

Each strategy is a module under `src/matching/` that exports `buildTeams(signups, options)`.

## Status

Functional v1 scaffold. Voice channel creation and per-team threads are wired up; a full draft mode and audio analysis are stubs ready to extend.
# musicevents
