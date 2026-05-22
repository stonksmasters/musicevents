'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { stmts } = require('../db');
const { getTier } = require('../utils/mmr');

const data = new SlashCommandBuilder()
  .setName('rank')
  .setDescription('View MMR rankings and leaderboard')
  .addSubcommand((s) =>
    s
      .setName('view')
      .setDescription("View your rank or another artist's rank")
      .addUserOption((o) =>
        o.setName('user').setDescription('User to look up (defaults to you)')
      )
  )
  .addSubcommand((s) =>
    s.setName('leaderboard').setDescription('Show the top 10 artists in this server')
  );

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'view') return handleView(interaction);
  if (sub === 'leaderboard') return handleLeaderboard(interaction);
}

async function handleView(interaction) {
  const target = interaction.options.getUser('user') || interaction.user;
  const row = stmts.getRanking.get(interaction.guildId, target.id);
  const mmr = row?.mmr ?? 1000;
  const tier = getTier(mmr);

  const winRate =
    row && row.events_played > 0
      ? `${Math.round((row.wins / row.events_played) * 100)}%`
      : '—';

  const embed = new EmbedBuilder()
    .setColor(tier.color)
    .setTitle(`${tier.label} — ${target.displayName || target.username}`)
    .setThumbnail(target.displayAvatarURL())
    .addFields(
      { name: 'MMR',           value: `**${mmr}**`,           inline: true },
      { name: 'Wins',          value: `${row?.wins ?? 0}`,     inline: true },
      { name: 'Losses',        value: `${row?.losses ?? 0}`,   inline: true },
      { name: 'Events Played', value: `${row?.events_played ?? 0}`, inline: true },
      { name: 'Win Rate',      value: winRate,                 inline: true }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleLeaderboard(interaction) {
  const rows = stmts.topRankings.all(interaction.guildId, 10);
  if (rows.length === 0) {
    return interaction.reply({
      content: 'No rankings yet — complete an event first.',
      ephemeral: true,
    });
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = rows.map((r, i) => {
    const tier = getTier(r.mmr);
    const prefix = medals[i] || `${i + 1}.`;
    return `${prefix} <@${r.user_id}> ${tier.label} **${r.mmr}** MMR (${r.wins}W / ${r.losses}L)`;
  });

  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle('🏆 MMR Leaderboard')
    .setDescription(lines.join('\n'))
    .setFooter({ text: interaction.guild.name })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

module.exports = { data, execute };
