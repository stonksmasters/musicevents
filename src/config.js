'use strict';

require('dotenv').config();
const path = require('path');

const root = path.resolve(__dirname, '..');

function required(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env var: ${name}. See .env.example.`);
  }
  return v;
}

const config = {
  root,
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.DISCORD_CLIENT_ID || '',
  devGuildId: process.env.DEV_GUILD_ID || '',
  dbPath: path.resolve(root, process.env.DB_PATH || './data/musicevents.db'),
  uploadDir: path.resolve(root, process.env.UPLOAD_DIR || './data/uploads'),

  dashboard: {
    port: parseInt(process.env.DASHBOARD_PORT || '3000', 10),
    sessionSecret: process.env.DASHBOARD_SESSION_SECRET || 'dev-only-secret-change-me',
    oauthClientSecret: process.env.DISCORD_OAUTH_CLIENT_SECRET || '',
    devMode: (process.env.DASHBOARD_DEV_MODE || '').toLowerCase() === 'true',
    devUserId: process.env.DEV_USER_ID || '',
  },

  required,
};

module.exports = config;
