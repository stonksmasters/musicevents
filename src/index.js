'use strict';

const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');

const config = require('./config');
require('./db'); // initialize DB on startup so migrations run

if (!config.token) {
  console.error('DISCORD_TOKEN is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.commands = new Collection();

// ---------- load command modules ----------
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const cmd = require(path.join(commandsDir, file));
  if (!cmd?.data?.name || typeof cmd.execute !== 'function') {
    console.warn(`Skipping ${file}: missing { data, execute }`);
    continue;
  }
  client.commands.set(cmd.data.name, cmd);
}

// ---------- load event handlers ----------
const eventsDir = path.join(__dirname, 'events');
for (const file of fs.readdirSync(eventsDir).filter((f) => f.endsWith('.js'))) {
  const evt = require(path.join(eventsDir, file));
  if (!evt?.name || typeof evt.execute !== 'function') {
    console.warn(`Skipping event ${file}: missing { name, execute }`);
    continue;
  }
  if (evt.once) {
    client.once(evt.name, (...args) => evt.execute(...args, client));
  } else {
    client.on(evt.name, (...args) => evt.execute(...args, client));
  }
}

// Boot the web dashboard once the bot is ready (so the Discord client is
// available for actions like creating event channels).
client.once('ready', async () => {
  try {
    const { startDashboard } = require('./web/server');
    await startDashboard(client);
  } catch (err) {
    console.error('Failed to start dashboard:', err);
  }
});

client.login(config.token);
