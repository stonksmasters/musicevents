'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { stmts } = require('../db');
const scheduler = require('../managers/ChallengeScheduler');

const data = new SlashCommandBuilder()
  .setName('challenge')
  .setDescription('Manage mid-event challenges')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('trigger')
      .setDescription('Manually fire a challenge for an active event')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Event ID').setRequired(true)
      )
      .addStringOption((o) =>
        o.setName('text').setDescription('Custom challenge text (blank = random from pool)')
      )
  )
  .addSubcommand((s) =>
    s
      .setName('list')
      .setDescription('List all challenges triggered during an event')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Event ID').setRequired(true)
      )
  )
  .addSubcommand((s) =>
    s.setName('pool').setDescription('Show the challenge pool for this server')
  );

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'trigger') return handleTrigger(interaction);
  if (sub === 'list')    return handleList(interaction);
  if (sub === 'pool')    return handlePool(interaction);
}

async function handleTrigger(interaction) {
  const eventId = interaction.options.getInteger('id', true);
  const event = stmts.getEvent.get(eventId);
  if (!event || event.guild_id !== interaction.guildId) {
    return interaction.reply({ content: 'Event not found.', ephemeral: true });
  }
  if (event.state !== 'active') {
    return interaction.reply({
      content: 'Event must be active to trigger a challenge.',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const settings = stmts.getGuildSettings.get(interaction.guildId) || {};
  const customText = interaction.options.getString('text');
  const pool = scheduler.getPool(settings);
  const text = customText || pool[Math.floor(Math.random() * pool.length)];

  const teams = stmts.teamsForEvent.all(eventId);
  const channelIds = teams.map((t) => t.channel_id).filter(Boolean);

  await scheduler.postChallenge(
    interaction.client,
    eventId,
    interaction.guildId,
    channelIds,
    text,
    settings
  );

  await interaction.editReply({ content: `Challenge posted: **${text}**` });
}

async function handleList(interaction) {
  const eventId = interaction.options.getInteger('id', true);
  const event = stmts.getEvent.get(eventId);
  if (!event || event.guild_id !== interaction.guildId) {
    return interaction.reply({ content: 'Event not found.', ephemeral: true });
  }

  const challenges = stmts.challengesForEvent.all(eventId);
  if (challenges.length === 0) {
    return interaction.reply({ content: 'No challenges triggered for this event yet.', ephemeral: true });
  }

  const lines = challenges.map(
    (c, i) => `**${i + 1}.** <t:${c.triggered_at}:R> — ${c.text}`
  );

  const embed = new EmbedBuilder()
    .setColor(0xff6b00)
    .setTitle(`⚡ Challenges — ${event.name}`)
    .setDescription(lines.join('\n'))
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handlePool(interaction) {
  const settings = stmts.getGuildSettings.get(interaction.guildId) || {};
  const pool = scheduler.getPool(settings);
  let pool_text;
  try {
    const custom = JSON.parse(settings.challenge_pool || '[]');
    pool_text = custom.length > 0 ? '(custom)' : '(built-in defaults)';
  } catch {
    pool_text = '(built-in defaults)';
  }

  const embed = new EmbedBuilder()
    .setColor(0xff6b00)
    .setTitle(`⚡ Challenge Pool ${pool_text}`)
    .setDescription(pool.map((c, i) => `${i + 1}. ${c}`).join('\n'))
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

module.exports = { data, execute };
