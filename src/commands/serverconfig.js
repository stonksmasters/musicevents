'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} = require('discord.js');
const { stmts } = require('../db');

const data = new SlashCommandBuilder()
  .setName('serverconfig')
  .setDescription('Configure the music event bot for this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('view').setDescription('View current settings'))
  .addSubcommand((s) =>
    s
      .setName('set')
      .setDescription('Update one or more settings')
      .addStringOption((o) =>
        o
          .setName('default_matching')
          .setDescription('Default pairing strategy for new events')
          .addChoices(
            { name: 'Random',    value: 'random' },
            { name: 'Genre',     value: 'genre'  },
            { name: 'Draft',     value: 'draft'  },
            { name: 'MMR (skill-balanced)', value: 'mmr' }
          )
      )
      .addChannelOption((o) =>
        o
          .setName('announce_channel')
          .setDescription('Channel for announcements and auto challenges')
          .addChannelTypes(ChannelType.GuildText)
      )
      .addBooleanOption((o) =>
        o.setName('challenges_enabled').setDescription('Enable automatic mid-event challenges')
      )
      .addIntegerOption((o) =>
        o
          .setName('challenge_min_minutes')
          .setDescription('Minimum minutes between auto challenges')
          .setMinValue(5)
          .setMaxValue(240)
      )
      .addIntegerOption((o) =>
        o
          .setName('challenge_max_minutes')
          .setDescription('Maximum minutes between auto challenges')
          .setMinValue(5)
          .setMaxValue(720)
      )
  )
  .addSubcommand((s) =>
    s
      .setName('add_challenge')
      .setDescription('Add a custom challenge to the pool')
      .addStringOption((o) =>
        o.setName('text').setDescription('Challenge text').setRequired(true)
      )
  )
  .addSubcommand((s) =>
    s
      .setName('remove_challenge')
      .setDescription('Remove a challenge from the custom pool by its number (use /challenge pool to list)')
      .addIntegerOption((o) =>
        o.setName('number').setDescription('Challenge number').setRequired(true).setMinValue(1)
      )
  )
  .addSubcommand((s) =>
    s.setName('reset_challenges').setDescription('Reset custom challenge pool back to built-in defaults')
  );

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'view')             return handleView(interaction);
  if (sub === 'set')              return handleSet(interaction);
  if (sub === 'add_challenge')    return handleAddChallenge(interaction);
  if (sub === 'remove_challenge') return handleRemoveChallenge(interaction);
  if (sub === 'reset_challenges') return handleResetChallenges(interaction);
}

function getSettings(guildId) {
  return stmts.getGuildSettings.get(guildId) || {
    guild_id:               guildId,
    default_matching:       'random',
    announce_channel_id:    null,
    challenge_enabled:      1,
    challenge_pool:         '[]',
    challenge_interval_min: 20,
    challenge_interval_max: 60,
  };
}

function saveSettings(s) {
  stmts.upsertGuildSettings.run({
    guildId:             s.guild_id,
    defaultMatching:     s.default_matching,
    announceChannelId:   s.announce_channel_id,
    challengeEnabled:    s.challenge_enabled,
    challengePool:       s.challenge_pool,
    challengeIntervalMin: s.challenge_interval_min,
    challengeIntervalMax: s.challenge_interval_max,
  });
}

async function handleView(interaction) {
  const s = getSettings(interaction.guildId);
  let pool = [];
  try { pool = JSON.parse(s.challenge_pool); } catch {}

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('⚙️ Server Configuration')
    .addFields(
      { name: 'Default Matching',   value: s.default_matching,                                    inline: true },
      { name: 'Announce Channel',   value: s.announce_channel_id ? `<#${s.announce_channel_id}>` : '_not set_', inline: true },
      { name: 'Auto Challenges',    value: s.challenge_enabled ? '✅ Enabled' : '❌ Disabled',    inline: true },
      { name: 'Challenge Interval', value: `${s.challenge_interval_min}–${s.challenge_interval_max} min`, inline: true },
      { name: 'Challenge Pool',     value: pool.length > 0 ? `${pool.length} custom` : 'Built-in defaults', inline: true }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleSet(interaction) {
  const s = getSettings(interaction.guildId);

  const matching  = interaction.options.getString('default_matching');
  const channel   = interaction.options.getChannel('announce_channel');
  const enabled   = interaction.options.getBoolean('challenges_enabled');
  const minMin    = interaction.options.getInteger('challenge_min_minutes');
  const maxMin    = interaction.options.getInteger('challenge_max_minutes');

  if (matching)          s.default_matching      = matching;
  if (channel)           s.announce_channel_id   = channel.id;
  if (enabled !== null)  s.challenge_enabled      = enabled ? 1 : 0;
  if (minMin !== null)   s.challenge_interval_min = minMin;
  if (maxMin !== null)   s.challenge_interval_max = maxMin;

  saveSettings(s);
  await interaction.reply({ content: '✅ Settings updated.', ephemeral: true });
}

async function handleAddChallenge(interaction) {
  const text = interaction.options.getString('text', true);
  const s = getSettings(interaction.guildId);
  let pool = [];
  try { pool = JSON.parse(s.challenge_pool); } catch {}

  pool.push(text);
  s.challenge_pool = JSON.stringify(pool);
  saveSettings(s);

  await interaction.reply({
    content: `Challenge added. Custom pool now has **${pool.length}** challenge${pool.length === 1 ? '' : 's'}.`,
    ephemeral: true,
  });
}

async function handleRemoveChallenge(interaction) {
  const num = interaction.options.getInteger('number', true);
  const s = getSettings(interaction.guildId);
  let pool = [];
  try { pool = JSON.parse(s.challenge_pool); } catch {}

  if (num < 1 || num > pool.length) {
    return interaction.reply({
      content: `Invalid number. Pool has ${pool.length} challenge${pool.length === 1 ? '' : 's'}.`,
      ephemeral: true,
    });
  }

  const removed = pool.splice(num - 1, 1)[0];
  s.challenge_pool = JSON.stringify(pool);
  saveSettings(s);

  await interaction.reply({
    content: `Removed: "${removed}". Pool now has **${pool.length}** challenge${pool.length === 1 ? '' : 's'}.`,
    ephemeral: true,
  });
}

async function handleResetChallenges(interaction) {
  const s = getSettings(interaction.guildId);
  s.challenge_pool = '[]';
  saveSettings(s);
  await interaction.reply({ content: 'Challenge pool reset to built-in defaults.', ephemeral: true });
}

module.exports = { data, execute };
