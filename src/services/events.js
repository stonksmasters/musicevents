'use strict';

// Event lifecycle services. Both the slash commands and the web dashboard
// call into these — they do all the DB writes + Discord API work and return
// a plain result object so callers don't need to know any internals.

const {
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ChannelType,
  AttachmentBuilder,
} = require('discord.js');
const { db, stmts } = require('../db');
const { buildTeams } = require('../matching');
const {
  createTeamChannel,
  createTeamVoiceChannel,
  createSubmissionsChannel,
  deleteEventChannels,
  ensureCategory,
  ensureGuildChannel,
} = require('../utils/channels');
const { TEAM_EMOJI, formatLeaderboard } = require('../utils/voting');
const {
  eventSignup,
  eventStarted,
  votingOpen,
  eventResults,
  teamWelcome,
} = require('../utils/embeds');
const { isFakeUser, realUsersOnly, formatUser, formatUsers } = require('../utils/users');
const { calculateDeltas, getTier } = require('../utils/mmr');
const scheduler = require('../managers/ChallengeScheduler');
const deadlineReminder = require('../managers/DeadlineReminder');

function signupButtonRow(eventId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`event:join:${eventId}`).setLabel('🎵 Join Event').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`event:leave:${eventId}`).setLabel('Leave Event').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('profile:setup').setLabel('🎚️ Set My Genre').setStyle(ButtonStyle.Primary),
  );
}

// Resolve the announce channel — uses configured channel, falls back to
// finding/creating a #events channel automatically. Persists to settings
// the first time so future events use the same channel.
async function resolveAnnounceChannel(guild) {
  const settings = stmts.getGuildSettings.get(guild.id);
  if (settings?.announce_channel_id) {
    const ch = await guild.channels.fetch(settings.announce_channel_id).catch(() => null);
    if (ch) return ch;
  }
  const ch = await ensureGuildChannel(guild, 'events', {
    topic: 'Music event announcements, signups, and results.',
  });
  stmts.setAnnounceChannel.run(guild.id, ch.id);
  return ch;
}

async function resolveWinnersChannel(guild) {
  const settings = stmts.getGuildSettings.get(guild.id);
  if (settings?.winners_channel_id) {
    const ch = await guild.channels.fetch(settings.winners_channel_id).catch(() => null);
    if (ch) return ch;
  }
  const ch = await ensureGuildChannel(guild, 'winners', {
    topic: 'Winners and final results from completed music events.',
    readonly: true,
  });
  stmts.setWinnersChannel.run(guild.id, ch.id);
  return ch;
}

// ---------- create ----------
async function createEvent({ guild, client, name, matching, teamSize, deadline, createdBy }) {
  const settings = stmts.getGuildSettings.get(guild.id);
  const finalMatching = matching || settings?.default_matching || 'random';
  const finalTeamSize = teamSize || 2;

  stmts.upsertGuild.run(guild.id, guild.name || '');
  const info = stmts.insertEvent.run({
    guildId: guild.id,
    name,
    matching: finalMatching,
    teamSize: finalTeamSize,
    deadline: deadline || null,
    createdBy,
  });
  const eventId = info.lastInsertRowid;
  const event = stmts.getEvent.get(eventId);

  // Always post the signup embed with buttons. Auto-create #events if needed
  // so mods don't have to configure it.
  const embed = eventSignup(event, 0);
  const row = signupButtonRow(eventId);
  let announceMsg = null;
  try {
    const announceChannel = await resolveAnnounceChannel(guild);
    announceMsg = await announceChannel.send({ embeds: [embed], components: [row] });
    stmts.setEventAnnouncement.run(announceChannel.id, announceMsg.id, eventId);
  } catch (err) {
    console.error('Failed to post announcement:', err);
  }

  return {
    event: stmts.getEvent.get(eventId),
    announcementId: announceMsg?.id || null,
    announceChannelId: announceMsg?.channelId || null,
  };
}

// ---------- start ----------
async function startEvent({ guild, client, eventId }) {
  const event = stmts.getEvent.get(eventId);
  if (!event) return { ok: false, error: 'Event not found.' };
  if (event.guild_id !== guild.id) return { ok: false, error: 'Event belongs to a different guild.' };
  if (event.state !== 'signup') return { ok: false, error: `Event is in state '${event.state}', can only start from 'signup'.` };

  const signups = stmts.signupsForEvent.all(eventId);
  if (signups.length < 2) return { ok: false, error: `Need at least 2 signups, have ${signups.length}.` };

  const teams = buildTeams(event.matching, signups, { teamSize: event.team_size });
  const category = await ensureCategory(guild, `Event: ${event.name}`).catch(() => null);

  let submissionsChannel = null;
  try {
    submissionsChannel = await createSubmissionsChannel(guild, {
      eventName: event.name,
      parentId: category?.id,
    });
  } catch (err) {
    console.error('Failed to create submissions channel:', err);
  }

  db.transaction(() => {
    stmts.setEventState.run('active', eventId);
    stmts.setEventStarted.run(eventId);
    if (category)           stmts.setEventCategory.run(category.id, eventId);
    if (submissionsChannel) stmts.setEventSubmissionsChannel.run(submissionsChannel.id, eventId);
  })();

  // Disable buttons on the original announcement
  if (event.announcement_channel_id && event.announcement_message_id) {
    try {
      const ch = await guild.channels.fetch(event.announcement_channel_id);
      const msg = await ch.messages.fetch(event.announcement_message_id);
      const disabled = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`event:join:${eventId}:closed`).setLabel('Signups Closed').setStyle(ButtonStyle.Secondary).setDisabled(true),
      );
      await msg.edit({ components: [disabled] });
    } catch {}
  }

  const summary = [];
  const teamChannelIds = [];

  for (let i = 0; i < teams.length; i++) {
    const teamName = `${event.name} — Team ${i + 1}`;
    const teamRow = stmts.insertTeam.run(eventId, teamName);
    const teamId = teamRow.lastInsertRowid;
    for (const uid of teams[i]) stmts.insertTeamMember.run(teamId, uid);

    let channelMention = '(channel creation failed)';
    let createdChannel = null;
    let createdVoice = null;
    try {
      createdChannel = await createTeamChannel(guild, { teamName, memberIds: teams[i], parentId: category?.id });
      stmts.setTeamChannel.run(createdChannel.id, teamId);
      channelMention = `<#${createdChannel.id}>`;
      teamChannelIds.push(createdChannel.id);

      try {
        createdVoice = await createTeamVoiceChannel(guild, { teamName, memberIds: teams[i], parentId: category?.id });
        stmts.setTeamVoiceChannel.run(createdVoice.id, teamId);
      } catch (err) {
        console.error('Failed to create team voice channel:', err);
      }

      const realIds = realUsersOnly(teams[i]);
      const mentions = formatUsers(teams[i]);
      const welcomeEmbed = teamWelcome(event, teamName, mentions, createdVoice?.id, submissionsChannel?.id);
      const pingContent = realIds.map((id) => `<@${id}>`).join(' ') || `**${teamName} formed!**`;

      await createdChannel.send({ content: pingContent });
      const welcomeMsg = await createdChannel.send({ embeds: [welcomeEmbed] });
      await welcomeMsg.pin().catch(() => {});

      const textLink = `https://discord.com/channels/${guild.id}/${createdChannel.id}`;
      const voiceLink = createdVoice ? `https://discord.com/channels/${guild.id}/${createdVoice.id}` : null;
      for (const uid of realIds) {
        try {
          const user = await client.users.fetch(uid);
          await user.send({
            content:
              `🎵 You've been paired for **${event.name}**!\n` +
              `💬 Team text channel: ${textLink}\n` +
              (voiceLink ? `🎙️ Team voice channel: ${voiceLink}\n` : '') +
              (event.deadline ? `⏰ Deadline: <t:${event.deadline}:F> (<t:${event.deadline}:R>)\n` : '') +
              `📤 Submit with \`/submit id:${eventId} file:<audio>\` when your track is ready.`,
          });
        } catch {}
      }
    } catch (err) {
      console.error('Failed to create team channel:', err);
    }
    summary.push(`**${teamName}** ${channelMention} — ${formatUsers(teams[i])}`);
  }

  const settings = stmts.getGuildSettings.get(guild.id) || {};
  if (settings.challenge_enabled !== 0) {
    scheduler.start(eventId, client, guild.id, teamChannelIds, settings);
  }
  if (event.deadline) {
    deadlineReminder.start(eventId, client, event.deadline, teamChannelIds, event.name);
  }

  try {
    const announceChannel = await resolveAnnounceChannel(guild);
    await announceChannel.send({ embeds: [eventStarted(event, summary)] });
  } catch (err) {
    console.error('Failed to post event-started announcement:', err);
  }

  return { ok: true, event: stmts.getEvent.get(eventId), summary };
}

// ---------- end ----------
async function endEvent({ guild, client, eventId, votingChannelId }) {
  const event = stmts.getEvent.get(eventId);
  if (!event) return { ok: false, error: 'Event not found.' };
  if (event.guild_id !== guild.id) return { ok: false, error: 'Event belongs to a different guild.' };
  if (event.state !== 'active') return { ok: false, error: `Event is in state '${event.state}', can only end from 'active'.` };

  scheduler.stop(eventId);
  deadlineReminder.stop(eventId);

  let votingChannel = null;
  if (votingChannelId) {
    votingChannel = await guild.channels.fetch(votingChannelId).catch(() => null);
  }
  if (!votingChannel && event.submissions_channel_id) {
    votingChannel = await guild.channels.fetch(event.submissions_channel_id).catch(() => null);
  }
  if (!votingChannel || votingChannel.type !== ChannelType.GuildText) {
    return { ok: false, error: 'No valid voting/submissions channel found.' };
  }

  const submissions = stmts.submissionsForEvent.all(eventId);
  if (submissions.length === 0) return { ok: false, error: 'No submissions yet — nothing to vote on.' };

  await votingChannel.send({ embeds: [votingOpen(event, votingChannel.id)] });

  const teams = stmts.teamsForEvent.all(eventId);
  for (const sub of submissions) {
    let msg = null;
    if (sub.message_id) msg = await votingChannel.messages.fetch(sub.message_id).catch(() => null);
    if (!msg) {
      const team = teams.find((t) => t.id === sub.team_id);
      const members = stmts.membersForTeam.all(sub.team_id).map((m) => formatUser(m.user_id));
      let attachment;
      try { attachment = new AttachmentBuilder(sub.file_path, { name: sub.file_name }); } catch {}
      msg = await votingChannel.send({
        content: `**${team?.name || `team#${sub.team_id}`}** — ${members.join(', ')}`,
        files: attachment ? [attachment] : [],
      });
      stmts.setSubmissionMessage.run(msg.id, sub.team_id);
    }
    await msg.react(TEAM_EMOJI).catch(() => {});
  }

  stmts.setVotingChannel.run(votingChannel.id, eventId);
  stmts.setEventState.run('voting', eventId);

  return { ok: true, event: stmts.getEvent.get(eventId), votingChannelId: votingChannel.id };
}

// ---------- tally ----------
async function tallyEvent({ guild, client, eventId, cleanupDelayMs = 30000 }) {
  const event = stmts.getEvent.get(eventId);
  if (!event) return { ok: false, error: 'Event not found.' };
  if (event.guild_id !== guild.id) return { ok: false, error: 'Event belongs to a different guild.' };
  if (event.state !== 'voting') return { ok: false, error: `Event is in state '${event.state}', voting must be open to tally.` };

  const rows = stmts.tallyVotes.all(eventId);
  const teams = stmts.teamsForEvent.all(eventId);
  const board = formatLeaderboard(rows, teams);
  stmts.setEventState.run('finished', eventId);

  const winnerRow = rows[0];
  const winnerTeam = winnerRow ? teams.find((t) => t.id === winnerRow.team_id) : null;
  const winnerName = winnerTeam?.name || 'No winner';

  // MMR
  const allMembers = stmts.membersAllTeams.all(eventId);
  const teamUserMap = new Map();
  for (const m of allMembers) {
    if (!teamUserMap.has(m.team_id)) teamUserMap.set(m.team_id, []);
    teamUserMap.get(m.team_id).push(m.user_id);
  }
  const teamsForMmr = [...teamUserMap.entries()].map(([team_id, user_ids]) => ({ team_id, user_ids }));

  const mmrLines = [];
  if (winnerRow && teamsForMmr.length > 0) {
    const deltas = calculateDeltas(teamsForMmr, winnerRow.team_id, { stmts, guildId: guild.id });
    for (const [userId, { newMmr, delta, win }] of deltas) {
      if (isFakeUser(userId)) continue;
      const existing = stmts.getRanking.get(guild.id, userId) || { mmr: 1000, wins: 0, losses: 0, events_played: 0 };
      stmts.upsertRanking.run({
        guildId: guild.id,
        userId,
        mmr: newMmr,
        wins: existing.wins + (win ? 1 : 0),
        losses: existing.losses + (win ? 0 : 1),
        eventsPlayed: existing.events_played + 1,
      });
      const sign = delta >= 0 ? '+' : '';
      mmrLines.push(`<@${userId}> ${getTier(newMmr).label} **${newMmr}** (${sign}${delta})`);
    }
  }

  const embed = eventResults(event, winnerName, board, mmrLines);

  // Post results to #winners (auto-create if missing). Also mirror to
  // #events so anyone watching the original announcement sees the outcome.
  try {
    const winnersChannel = await resolveWinnersChannel(guild);
    await winnersChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Failed to post to winners channel:', err);
  }
  try {
    const announceChannel = await resolveAnnounceChannel(guild);
    await announceChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Failed to post to announce channel:', err);
  }

  // Schedule channel cleanup
  const cleanupTeams = stmts.teamsForEvent.all(eventId);
  const channelIds = [];
  for (const t of cleanupTeams) {
    if (t.channel_id)       channelIds.push(t.channel_id);
    if (t.voice_channel_id) channelIds.push(t.voice_channel_id);
  }
  if (event.submissions_channel_id) channelIds.push(event.submissions_channel_id);

  setTimeout(() => {
    deleteEventChannels(guild, { channelIds, categoryId: event.category_id }).catch((err) =>
      console.error('Cleanup failed:', err)
    );
  }, cleanupDelayMs);

  return { ok: true, event: stmts.getEvent.get(eventId), winnerName, board, mmrLines, embed };
}

module.exports = { createEvent, startEvent, endEvent, tallyEvent };
