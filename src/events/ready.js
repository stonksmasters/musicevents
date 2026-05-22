'use strict';

module.exports = {
  name: 'ready',
  once: true,
  execute(client) {
    console.log(`Logged in as ${client.user.tag}`);
    console.log(`In ${client.guilds.cache.size} guild(s)`);
  },
};
