'use strict';

const { stmts } = require('../db');
const profile = require('../commands/profile');
const { eventSignup } = require('../utils/embeds');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    try {
      if (interaction.isChatInputCommand()) {
        const cmd = client.commands.get(interaction.commandName);
        if (!cmd) return;
        return await cmd.execute(interaction, client);
      }

      if (interaction.isButton()) {
        return await handleButton(interaction);
      }

      if (interaction.isStringSelectMenu()) {
        return await handleSelect(interaction);
      }

      if (interaction.isModalSubmit()) {
        return await handleModal(interaction);
      }
    } catch (err) {
      console.error('Interaction error:', err);
      const reply = { content: `Error: ${err.message || err}`, ephemeral: true };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
    }
  },
};

async function handleButton(interaction) {
  const [scope, action, ...rest] = interaction.customId.split(':');

  if (scope === 'profile' && action === 'setup') {
    return profile.openSetup(interaction);
  }

  if (scope === 'event' && (action === 'join' || action === 'leave')) {
    const eventId = parseInt(rest[0], 10);
    return action === 'join'
      ? joinEvent(interaction, eventId)
      : leaveEvent(interaction, eventId);
  }
}

async function handleSelect(interaction) {
  if (interaction.customId === 'profile:genre_select') {
    return profile.handleGenreSelect(interaction);
  }
}

async function handleModal(interaction) {
  if (interaction.customId === 'profile:genre_modal') {
    return profile.handleGenreModal(interaction);
  }
}

async function joinEvent(interaction, eventId) {
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

  // Make sure they have an artist row (so genre matching has something to work with).
  const artist = stmts.getArtist.get(interaction.guildId, interaction.user.id);
  if (!artist) {
    stmts.upsertArtist.run({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      genre: null,
      daw: null,
      skill: null,
    });
  }

  stmts.joinEvent.run(eventId, interaction.user.id);
  await refreshAnnouncement(interaction.client, event);

  if (!artist?.genre) {
    return interaction.reply({
      content: `✅ You're signed up for **${event.name}**! Click **🎚️ Set My Genre** above to set your genre — it helps with team matching.`,
      ephemeral: true,
    });
  }
  await interaction.reply({
    content: `✅ You're signed up for **${event.name}**!`,
    ephemeral: true,
  });
}

async function leaveEvent(interaction, eventId) {
  const event = stmts.getEvent.get(eventId);
  if (!event || event.guild_id !== interaction.guildId) {
    return interaction.reply({ content: 'Event not found.', ephemeral: true });
  }
  if (event.state !== 'signup') {
    return interaction.reply({
      content: `Can only leave during signup (state: \`${event.state}\`).`,
      ephemeral: true,
    });
  }
  stmts.leaveEvent.run(eventId, interaction.user.id);
  await refreshAnnouncement(interaction.client, event);
  await interaction.reply({
    content: `You've left **${event.name}**.`,
    ephemeral: true,
  });
}

// Update the signup count on the announcement embed in place.
async function refreshAnnouncement(client, event) {
  if (!event.announcement_channel_id || !event.announcement_message_id) return;
  try {
    const ch  = await client.channels.fetch(event.announcement_channel_id);
    const msg = await ch.messages.fetch(event.announcement_message_id);
    const signups = stmts.signupsForEvent.all(event.id);
    const fresh = stmts.getEvent.get(event.id);
    const embed = eventSignup(fresh, signups.length);
    await msg.edit({ embeds: [embed], components: msg.components });
  } catch (err) {
    console.error('Failed to refresh announcement:', err.message);
  }
}
