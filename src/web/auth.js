'use strict';

const config = require('../config');
const { PermissionFlagsBits } = require('discord.js');

const MANAGE_GUILD = 0x20n; // bit for MANAGE_GUILD permission
const OAUTH_SCOPES = ['identify', 'guilds'];

function redirectUri(req) {
  return `${req.protocol}://${req.get('host')}/auth/callback`;
}

function loginUrl(req, state) {
  const params = new URLSearchParams({
    client_id:     config.clientId,
    redirect_uri:  redirectUri(req),
    response_type: 'code',
    scope:         OAUTH_SCOPES.join(' '),
    state,
  });
  return `https://discord.com/api/oauth2/authorize?${params}`;
}

async function exchangeCode(code, redirectUriStr) {
  const body = new URLSearchParams({
    client_id:     config.clientId,
    client_secret: config.dashboard.oauthClientSecret,
    grant_type:    'authorization_code',
    code,
    redirect_uri:  redirectUriStr,
  });
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchUser(accessToken) {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`User fetch failed: ${res.status}`);
  return res.json();
}

async function fetchGuilds(accessToken) {
  const res = await fetch('https://discord.com/api/users/@me/guilds', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Guilds fetch failed: ${res.status}`);
  return res.json();
}

// Filter to guilds the user has Manage Guild permission AND the bot is in.
function filterAdminGuilds(userGuilds, client) {
  const botGuildIds = new Set(client.guilds.cache.map((g) => g.id));
  return userGuilds
    .filter((g) => botGuildIds.has(g.id))
    .filter((g) => (BigInt(g.permissions) & MANAGE_GUILD) === MANAGE_GUILD)
    .map((g) => ({ id: g.id, name: g.name }));
}

// In dev mode, every guild the bot is in is fair game.
function devGuilds(client) {
  return client.guilds.cache.map((g) => ({ id: g.id, name: g.name }));
}

function devUser() {
  return {
    id:       config.dashboard.devUserId || 'dev-admin',
    username: 'Dev Admin',
  };
}

// Express middleware: require a logged-in user, otherwise redirect to /login.
function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  res.redirect('/login');
}

// Require user has access to the requested :guildId.
function requireGuildAccess(req, res, next) {
  const guildId = req.params.guildId;
  const guilds = req.session?.guilds || [];
  if (!guilds.find((g) => g.id === guildId)) {
    return res.status(403).send('You do not have access to this server.');
  }
  next();
}

module.exports = {
  loginUrl,
  redirectUri,
  exchangeCode,
  fetchUser,
  fetchGuilds,
  filterAdminGuilds,
  devGuilds,
  devUser,
  requireAuth,
  requireGuildAccess,
  OAUTH_SCOPES,
};
