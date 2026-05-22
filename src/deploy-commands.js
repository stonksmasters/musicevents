'use strict';

const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const config = require('./config');

if (!config.token || !config.clientId) {
  console.error('DISCORD_TOKEN and DISCORD_CLIENT_ID must be set.');
  process.exit(1);
}

const commands = [];
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const cmd = require(path.join(commandsDir, file));
  if (cmd?.data?.toJSON) {
    commands.push(cmd.data.toJSON());
  }
}

const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
  try {
    let route;
    if (config.devGuildId) {
      route = Routes.applicationGuildCommands(config.clientId, config.devGuildId);
      console.log(`Deploying ${commands.length} commands to guild ${config.devGuildId}`);
    } else {
      route = Routes.applicationCommands(config.clientId);
      console.log(`Deploying ${commands.length} commands globally`);
    }
    const data = await rest.put(route, { body: commands });
    console.log(`Deployed ${data.length} commands`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
