'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const { stmts } = require('../db');
const eventsService = require('../services/events');
const { eventStarted, eventResults } = require('../utils/embeds');

const data = new SlashCommandBuilder()
  .setName('event')
  .setDescription('Manage music collab events')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('create')
      .setDescription('Create a new collab event in this server')
      .addStringOption((o) =>
        o.setName('name').setDescription('Event name').setRequired(true)
      )
      .addStringOption((o) =>
        o
          .setName('matching')
          .setDescription('How to pair artists (overrides server default)')
          .addChoices(
            { name: 'Random',   value: 'random' },
            { name: 'Genre',    value: 'genre'  },
            { name: 'Draft',    value: 'draft'  },
            { name: 'MMR (skill-balanced)', value: 'mmr' }
          )
      )
      .addIntegerOption((o) =>
        o.setName('team_size').setDescription('Artists per team (default 2)').setMinValue(2).setMaxValue(8)
      )
      .addStringOption((o) =>
        o.setName('deadline').setDescription('Submission deadline (ISO 8601, e.g. 2026-06-01T20:00:00Z)')
      )
  )
  .addSubcommand((s) =>
    s.setName('start').setDescription('Close signups, run matching, create team channels')
      .addIntegerOption((o) => o.setName('id').setDescription('Event ID').setRequired(true))
  )
  .addSubcommand((s) =>
    s.setName('end').setDescription('Close submissions and open voting')
      .addIntegerOption((o) => o.setName('id').setDescription('Event ID').setRequired(true))
      .addChannelOption((o) =>
        o.setName('voting_channel').setDescription('Channel to post submissions in (defaults to the event submissions channel)').addChannelTypes(ChannelType.GuildText)
      )
  )
  .addSubcommand((s) =>
    s.setName('tally').setDescription('Tally votes, award MMR, and announce the winner')
      .addIntegerOption((o) => o.setName('id').setDescription('Event ID').setRequired(true))
  )
  .addSubcommand((s) => s.setName('list').setDescription('List events in this server'))
  .addSubcommand((s) =>
    s.setName('info').setDescription('Show details and signups for an event')
      .addIntegerOption((o) => o.setName('id').setDescription('Event ID').setRequired(true))
  );

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'create': return handleCreate(interaction);
    case 'start':  return handleStart(interaction);
    case 'end':    return handleEnd(interaction);
    case 'tally':  return handleTally(interaction);
    case 'list':   return handleList(interaction);
    case 'info':   return handleInfo(interaction);
  }
}

async function handleCreate(interaction) {
  const name = interaction.options.getString('name', true);
  const teamSize = interaction.options.getInteger('team_size') || 2;
  const matching = interaction.options.getString('matching');
  const deadlineStr = interaction.options.getString('deadline');

  let deadline = null;
  if (deadlineStr) {
    const t = Date.parse(deadlineStr);
    if (Number.isNaN(t)) {
      return interaction.reply({
        content: `Could not parse deadline "${deadlineStr}". Use ISO 8601, e.g. 2026-06-01T20:00:00Z.`,
        ephemeral: true,
      });
    }
    deadline = Math.floor(t / 1000);
  }

  const { event } = await eventsService.createEvent({
    guild: interaction.guild,
    client: interaction.client,
    name,
    matching,
    teamSize,
    deadline,
    createdBy: interaction.user.id,
  });

  const settings = stmts.getGuildSettings.get(interaction.guildId);
  await interaction.reply({
    content:
      `Event **#${event.id} ${event.name}** created. Members can sign up by clicking **Join Event** in ` +
      (settings?.announce_channel_id ? `<#${settings.announce_channel_id}>` : 'your announce channel') +
      `. Run \`/event start id:${event.id}\` once you're ready to pair teams.`,
    ephemeral: true,
  });
}

async function handleStart(interaction) {
  const eventId = interaction.options.getInteger('id', true);
  await interaction.deferReply();
  const result = await eventsService.startEvent({
    guild: interaction.guild,
    client: interaction.client,
    eventId,
  });
  if (!result.ok) return interaction.editReply(result.error);
  await interaction.editReply({ embeds: [eventStarted(result.event, result.summary)] });
}

async function handleEnd(interaction) {
  const eventId = interaction.options.getInteger('id', true);
  const overrideChannel = interaction.options.getChannel('voting_channel');
  await interaction.deferReply();
  const result = await eventsService.endEvent({
    guild: interaction.guild,
    client: interaction.client,
    eventId,
    votingChannelId: overrideChannel?.id,
  });
  if (!result.ok) return interaction.editReply(result.error);
  await interaction.editReply(
    `Voting is open in <#${result.votingChannelId}>. Run \`/event tally id:${eventId}\` when ready to count.`
  );
}

async function handleTally(interaction) {
  const eventId = interaction.options.getInteger('id', true);
  await interaction.deferReply();
  const result = await eventsService.tallyEvent({
    guild: interaction.guild,
    client: interaction.client,
    eventId,
  });
  if (!result.ok) return interaction.editReply(result.error);
  await interaction.editReply({ embeds: [result.embed] });
}

async function handleList(interaction) {
  const events = stmts.listEventsByGuild.all(interaction.guildId);
  if (events.length === 0) {
    return interaction.reply({ content: 'No events yet.', ephemeral: true });
  }
  const lines = events.map(
    (e) =>
      `#${e.id} **${e.name}** — \`${e.state}\` · \`${e.matching}\` · team_size: ${e.team_size}` +
      (e.deadline ? ` · deadline <t:${e.deadline}:R>` : '')
  );
  await interaction.reply({ content: lines.join('\n'), ephemeral: true });
}

async function handleInfo(interaction) {
  const eventId = interaction.options.getInteger('id', true);
  const event = stmts.getEvent.get(eventId);
  if (!event || event.guild_id !== interaction.guildId) {
    return interaction.reply({ content: 'Event not found.', ephemeral: true });
  }
  const signups = stmts.signupsForEvent.all(eventId);
  const teams = stmts.teamsForEvent.all(eventId);

  const teamLines = teams.map((t) => {
    const members = stmts.membersForTeam.all(t.id).map((m) => `<@${m.user_id}>`).join(', ');
    return `- **${t.name}** ${t.channel_id ? `<#${t.channel_id}>` : ''} — ${members}`;
  });

  const challenges = stmts.challengesForEvent.all(eventId);
  const challengeLines = challenges.map(
    (c, i) => `${i + 1}. <t:${c.triggered_at}:R> — ${c.text}`
  );

  const lines = [
    `**Event #${event.id} — ${event.name}**`,
    `State: \`${event.state}\` · Matching: \`${event.matching}\` · Team size: \`${event.team_size}\``,
    event.deadline ? `Deadline: <t:${event.deadline}:F>` : 'No deadline set',
    '',
    `**Signups (${signups.length})**`,
    signups.length
      ? signups.map((s) => `- <@${s.user_id}>${s.genre ? ` (${s.genre})` : ''} · MMR: ${s.mmr}`).join('\n')
      : '_none yet_',
  ];
  if (teams.length) lines.push('', `**Teams (${teams.length})**`, ...teamLines);
  if (challenges.length) lines.push('', `**Challenges (${challenges.length})**`, ...challengeLines);

  await interaction.reply({ content: lines.join('\n'), ephemeral: true });
}

module.exports = { data, execute };
