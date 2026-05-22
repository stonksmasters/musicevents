'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { stmts } = require('../db');

const data = new SlashCommandBuilder()
  .setName('leave')
  .setDescription('Drop out of a music collab event before it starts')
  .addIntegerOption((o) =>
    o.setName('id').setDescription('Event ID').setRequired(true)
  );

async function execute(interaction) {
  const eventId = interaction.options.getInteger('id', true);
  const event = stmts.getEvent.get(eventId);
  if (!event || event.guild_id !== interaction.guildId) {
    return interaction.reply({ content: 'Event not found.', ephemeral: true });
  }
  if (event.state !== 'signup') {
    return interaction.reply({
      content: 'Event has already started — talk to a mod if you need to drop.',
      ephemeral: true,
    });
  }
  stmts.leaveEvent.run(eventId, interaction.user.id);
  await interaction.reply({
    content: `Removed you from **${event.name}**.`,
    ephemeral: true,
  });
}

module.exports = { data, execute };
