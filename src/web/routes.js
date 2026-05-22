'use strict';

const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { stmts } = require('../db');
const eventsService = require('../services/events');
const auth = require('./auth');
const views = require('./views');
const { newFakeId, isFakeUser } = require('../utils/users');
const { deleteEventChannels } = require('../utils/channels');
const challengeScheduler = require('../managers/ChallengeScheduler');
const deadlineReminder = require('../managers/DeadlineReminder');

// FUTURE: When we add a phone app, mount a JSON API at /api/* alongside
// these HTML routes. Both layers should call into src/services/* for
// business logic (createEvent, startEvent, etc.) — never duplicate.
// Recommended path: /api/auth/* (Discord OAuth + token), /api/g/:id/events,
// /api/g/:id/events/:id (POST = action), /api/g/:id/settings, etc.

function buildRouter(client) {
  const router = express.Router();

  // Health/version endpoint — useful for future mobile clients to detect
  // server compatibility.
  router.get('/api/health', (req, res) => {
    res.json({ ok: true, version: 1, devMode: config.dashboard.devMode });
  });

  // ---------- helpers ----------
  function flash(req, kind, message) { req.session.flash = { kind, message }; }
  function takeFlash(req) {
    const f = req.session.flash;
    delete req.session.flash;
    return f;
  }

  async function loadGuild(req, res, next) {
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(404).send('Bot is not in this server.');
    req.guild = guild;
    next();
  }

  // ---------- auth ----------
  router.get('/login', (req, res) => {
    if (config.dashboard.devMode) {
      req.session.user = auth.devUser();
      req.session.guilds = auth.devGuilds(client);
      return res.redirect('/');
    }
    if (!config.dashboard.oauthClientSecret) {
      return res.status(500).send('OAuth not configured. Set DISCORD_OAUTH_CLIENT_SECRET in .env, or set DASHBOARD_DEV_MODE=true.');
    }
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    res.redirect(auth.loginUrl(req, state));
  });

  router.get('/auth/callback', async (req, res) => {
    if (!req.query.code || req.query.state !== req.session.oauthState) {
      return res.status(400).send('OAuth state mismatch — try again.');
    }
    delete req.session.oauthState;
    try {
      const tokens = await auth.exchangeCode(req.query.code, auth.redirectUri(req));
      const user = await auth.fetchUser(tokens.access_token);
      const userGuilds = await auth.fetchGuilds(tokens.access_token);
      req.session.user = { id: user.id, username: user.username };
      req.session.guilds = auth.filterAdminGuilds(userGuilds, client);
      res.redirect('/');
    } catch (err) {
      console.error('OAuth callback failed:', err);
      res.status(500).send(`Auth failed: ${err.message}`);
    }
  });

  router.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
  });

  // ---------- home ----------
  router.get('/', (req, res) => {
    res.send(views.home({
      user: req.session.user,
      devMode: config.dashboard.devMode,
      guilds: req.session.guilds || [],
      flash: takeFlash(req),
    }));
  });

  // ---------- guild dashboard ----------
  router.get('/g/:guildId', auth.requireAuth, auth.requireGuildAccess, loadGuild, (req, res) => {
    const tab = req.query.tab || 'events';
    const events = stmts.listEventsByGuild.all(req.guild.id).map((e) => {
      const signups = stmts.signupsForEvent.all(e.id);
      return { ...e, signup_count: signups.length };
    });
    const settings = stmts.getGuildSettings.get(req.guild.id);
    const leaderboard = stmts.topRankings.all(req.guild.id, 25);
    const challenges = stmts.challengesForEvent;

    res.send(views.guildPage({
      user: req.session.user,
      devMode: config.dashboard.devMode,
      guild: req.guild,
      events,
      settings,
      leaderboard,
      challenges,
      flash: takeFlash(req),
      tab,
    }));
  });

  // ---------- event detail ----------
  router.get('/g/:guildId/events/:eventId', auth.requireAuth, auth.requireGuildAccess, loadGuild, (req, res) => {
    const eventId = parseInt(req.params.eventId, 10);
    const event = stmts.getEvent.get(eventId);
    if (!event || event.guild_id !== req.guild.id) return res.status(404).send('Event not found.');

    const signups = stmts.signupsForEvent.all(eventId);
    const teams = stmts.teamsForEvent.all(eventId);
    const members = stmts.membersAllTeams.all(eventId);
    const submissions = stmts.submissionsWithTeam.all(eventId);
    const votes = stmts.voteCountsForEvent.all(eventId);
    const challenges = stmts.challengesForEvent.all(eventId);

    res.send(views.eventDetailPage({
      user: req.session.user,
      devMode: config.dashboard.devMode,
      guild: req.guild,
      event,
      signups,
      teams,
      members,
      submissions,
      votes,
      challenges,
      flash: takeFlash(req),
    }));
  });

  // ---------- trigger challenge manually ----------
  router.post('/g/:guildId/events/:eventId/challenge', auth.requireAuth, auth.requireGuildAccess, loadGuild, async (req, res) => {
    const eventId = parseInt(req.params.eventId, 10);
    const event = stmts.getEvent.get(eventId);
    if (!event || event.guild_id !== req.guild.id) {
      flash(req, 'error', 'Event not found.');
      return res.redirect(`/g/${req.params.guildId}`);
    }
    if (event.state !== 'active') {
      flash(req, 'error', 'Event must be active to fire a challenge.');
      return res.redirect(`/g/${req.params.guildId}/events/${eventId}`);
    }

    const settings = stmts.getGuildSettings.get(req.guild.id) || {};
    const customText = (req.body.text || '').trim();
    const pool = challengeScheduler.getPool(settings);
    const text = customText || pool[Math.floor(Math.random() * pool.length)];

    const teams = stmts.teamsForEvent.all(eventId);
    const channelIds = teams.map((t) => t.channel_id).filter(Boolean);

    try {
      await challengeScheduler.postChallenge(client, eventId, req.guild.id, channelIds, text, settings);
      flash(req, 'success', `Challenge fired: "${text}"`);
    } catch (err) {
      console.error(err);
      flash(req, 'error', `Failed to post challenge: ${err.message}`);
    }
    res.redirect(`/g/${req.params.guildId}/events/${eventId}`);
  });

  // ---------- cancel event ----------
  router.post('/g/:guildId/events/:eventId/cancel', auth.requireAuth, auth.requireGuildAccess, loadGuild, async (req, res) => {
    const eventId = parseInt(req.params.eventId, 10);
    const event = stmts.getEvent.get(eventId);
    if (!event || event.guild_id !== req.guild.id) {
      flash(req, 'error', 'Event not found.');
      return res.redirect(`/g/${req.params.guildId}`);
    }
    if (event.state === 'finished') {
      flash(req, 'error', 'Event already finished.');
      return res.redirect(`/g/${req.params.guildId}/events/${eventId}`);
    }

    challengeScheduler.stop(eventId);
    deadlineReminder.stop(eventId);

    // Mark cancelled and clean up channels
    stmts.setEventState.run('finished', eventId);

    const teams = stmts.teamsForEvent.all(eventId);
    const channelIds = [];
    for (const t of teams) {
      if (t.channel_id) channelIds.push(t.channel_id);
      if (t.voice_channel_id) channelIds.push(t.voice_channel_id);
    }
    if (event.submissions_channel_id) channelIds.push(event.submissions_channel_id);

    deleteEventChannels(req.guild, { channelIds, categoryId: event.category_id })
      .catch((err) => console.error('Cancel cleanup failed:', err));

    flash(req, 'success', `Event cancelled. Channels are being cleaned up.`);
    res.redirect(`/g/${req.params.guildId}`);
  });

  // ---------- create event ----------
  router.post('/g/:guildId/events', auth.requireAuth, auth.requireGuildAccess, loadGuild, async (req, res) => {
    try {
      const { name, matching, team_size, deadline } = req.body;
      let deadlineUnix = null;
      if (deadline) deadlineUnix = Math.floor(new Date(deadline).getTime() / 1000);

      const result = await eventsService.createEvent({
        guild: req.guild,
        client,
        name,
        matching: matching || null,
        teamSize: parseInt(team_size, 10) || 2,
        deadline: deadlineUnix,
        createdBy: req.session.user.id,
      });
      flash(req, 'success', `Created event #${result.event.id} — ${result.event.name}.`);
    } catch (err) {
      console.error(err);
      flash(req, 'error', err.message);
    }
    res.redirect(`/g/${req.params.guildId}`);
  });

  // ---------- start / end / tally ----------
  router.post('/g/:guildId/events/:eventId/start', auth.requireAuth, auth.requireGuildAccess, loadGuild, async (req, res) => {
    const eventId = parseInt(req.params.eventId, 10);
    const result = await eventsService.startEvent({ guild: req.guild, client, eventId });
    flash(req, result.ok ? 'success' : 'error', result.ok ? `Event #${result.event.id} started!` : result.error);
    res.redirect(`/g/${req.params.guildId}/events/${eventId}`);
  });

  router.post('/g/:guildId/events/:eventId/end', auth.requireAuth, auth.requireGuildAccess, loadGuild, async (req, res) => {
    const eventId = parseInt(req.params.eventId, 10);
    const result = await eventsService.endEvent({ guild: req.guild, client, eventId });
    flash(req, result.ok ? 'success' : 'error', result.ok ? `Voting open!` : result.error);
    res.redirect(`/g/${req.params.guildId}/events/${eventId}`);
  });

  router.post('/g/:guildId/events/:eventId/tally', auth.requireAuth, auth.requireGuildAccess, loadGuild, async (req, res) => {
    const eventId = parseInt(req.params.eventId, 10);
    const result = await eventsService.tallyEvent({ guild: req.guild, client, eventId });
    flash(req, result.ok ? 'success' : 'error',
      result.ok ? `Tallied — winner: ${result.winnerName}. Posted to #winners and #events. Channels clean up in 30s.` : result.error);
    res.redirect(`/g/${req.params.guildId}/events/${eventId}`);
  });

  // ---------- dev signups ----------
  router.post('/g/:guildId/events/:eventId/dev-signup', auth.requireAuth, auth.requireGuildAccess, loadGuild, (req, res) => {
    if (!config.dashboard.devMode) return res.status(403).send('Dev mode not enabled.');
    const eventId = parseInt(req.params.eventId, 10);
    const count = Math.min(20, Math.max(1, parseInt(req.body.count, 10) || 1));
    let added = 0;
    for (let i = 0; i < count; i++) {
      const fakeId = newFakeId();
      stmts.upsertArtist.run({
        guildId: req.guild.id, userId: fakeId,
        genre: pickRandomGenre(), daw: null, skill: null,
      });
      const result = stmts.joinEvent.run(eventId, fakeId);
      if (result.changes > 0) added++;
    }
    flash(req, 'success', `Added ${added} test signup${added === 1 ? '' : 's'}.`);
    res.redirect(`/g/${req.params.guildId}/events/${eventId}`);
  });

  router.post('/g/:guildId/events/:eventId/dev-self-signup', auth.requireAuth, auth.requireGuildAccess, loadGuild, (req, res) => {
    if (!config.dashboard.devMode) return res.status(403).send('Dev mode not enabled.');
    const eventId = parseInt(req.params.eventId, 10);
    const userId = config.dashboard.devUserId;
    if (!userId) {
      flash(req, 'error', 'Set DEV_USER_ID in .env to your real Discord user ID first.');
      return res.redirect(`/g/${req.params.guildId}`);
    }
    if (!stmts.getArtist.get(req.guild.id, userId)) {
      stmts.upsertArtist.run({ guildId: req.guild.id, userId, genre: null, daw: null, skill: null });
    }
    const result = stmts.joinEvent.run(eventId, userId);
    flash(req, 'success', result.changes > 0 ? `Signed you up (real Discord user).` : `You're already signed up.`);
    res.redirect(`/g/${req.params.guildId}/events/${eventId}`);
  });

  // ---------- settings ----------
  router.post('/g/:guildId/settings', auth.requireAuth, auth.requireGuildAccess, loadGuild, (req, res) => {
    const existing = stmts.getGuildSettings.get(req.guild.id) || {};
    stmts.upsertGuildSettings.run({
      guildId: req.guild.id,
      defaultMatching: req.body.default_matching || existing.default_matching || 'random',
      announceChannelId: req.body.announce_channel_id || null,
      challengeEnabled: parseInt(req.body.challenge_enabled, 10) === 1 ? 1 : 0,
      challengePool: existing.challenge_pool || '[]',
      challengeIntervalMin: parseInt(req.body.challenge_interval_min, 10) || 20,
      challengeIntervalMax: parseInt(req.body.challenge_interval_max, 10) || 60,
    });
    flash(req, 'success', 'Settings saved.');
    res.redirect(`/g/${req.params.guildId}?tab=settings`);
  });

  // ---------- challenges ----------
  router.post('/g/:guildId/challenges', auth.requireAuth, auth.requireGuildAccess, loadGuild, (req, res) => {
    const settings = stmts.getGuildSettings.get(req.guild.id) || defaultSettings(req.guild.id);
    let pool = [];
    try { pool = JSON.parse(settings.challenge_pool || '[]'); } catch {}
    if (req.body.text) pool.push(req.body.text.trim());
    saveSettings(req.guild.id, { ...settings, challenge_pool: JSON.stringify(pool) });
    flash(req, 'success', 'Challenge added.');
    res.redirect(`/g/${req.params.guildId}?tab=challenges`);
  });

  router.post('/g/:guildId/challenges/remove', auth.requireAuth, auth.requireGuildAccess, loadGuild, (req, res) => {
    const settings = stmts.getGuildSettings.get(req.guild.id) || defaultSettings(req.guild.id);
    let pool = [];
    try { pool = JSON.parse(settings.challenge_pool || '[]'); } catch {}
    const idx = parseInt(req.body.index, 10);
    if (idx >= 0 && idx < pool.length) pool.splice(idx, 1);
    saveSettings(req.guild.id, { ...settings, challenge_pool: JSON.stringify(pool) });
    flash(req, 'success', 'Challenge removed.');
    res.redirect(`/g/${req.params.guildId}?tab=challenges`);
  });

  router.post('/g/:guildId/challenges/reset', auth.requireAuth, auth.requireGuildAccess, loadGuild, (req, res) => {
    const settings = stmts.getGuildSettings.get(req.guild.id) || defaultSettings(req.guild.id);
    saveSettings(req.guild.id, { ...settings, challenge_pool: '[]' });
    flash(req, 'success', 'Challenge pool reset to defaults.');
    res.redirect(`/g/${req.params.guildId}?tab=challenges`);
  });

  return router;
}

function defaultSettings(guildId) {
  return {
    guild_id: guildId,
    default_matching: 'random',
    announce_channel_id: null,
    challenge_enabled: 1,
    challenge_pool: '[]',
    challenge_interval_min: 20,
    challenge_interval_max: 60,
  };
}

function saveSettings(guildId, s) {
  stmts.upsertGuildSettings.run({
    guildId,
    defaultMatching: s.default_matching || 'random',
    announceChannelId: s.announce_channel_id || null,
    challengeEnabled: s.challenge_enabled ?? 1,
    challengePool: s.challenge_pool || '[]',
    challengeIntervalMin: s.challenge_interval_min || 20,
    challengeIntervalMax: s.challenge_interval_max || 60,
  });
}

function pickRandomGenre() {
  const { GENRES } = require('../utils/genres');
  return GENRES[Math.floor(Math.random() * (GENRES.length - 1))]; // exclude 'Other'
}

module.exports = { buildRouter };
