'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { stmts } = require('../db');

const data = new SlashCommandBuilder()
  .setName('join')
  .setDescription('Sign up for a music collab event')
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
      content: `Signups are closed for this event (state: \`${event.state}\`).`,
      ephemeral: true,
    });
  }
  stmts.joinEvent.run(eventId, interaction.user.id);

  // Touch artist row so the user has a profile entry, even if empty.
  const existing = stmts.getArtist.get(interaction.guildId, interaction.user.id);
  if (!existing) {
    stmts.upsertArtist.run({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      genre: null,
      daw: null,
      skill: null,
    });
  }

  await interaction.reply({
    content:
      `You're signed up for **${event.name}**. ` +
      `Set your profile with \`/profile set\` so genre matching works better.`,
    ephemeral: true,
  });
}

module.exports = { data, execute };
