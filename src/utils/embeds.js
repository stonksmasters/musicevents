'use strict';

const { EmbedBuilder } = require('discord.js');

const COLORS = {
  event:     0x9b59b6, // purple
  success:   0x57f287, // green
  voting:    0xfee75c, // yellow
  results:   0xffd700, // gold
  challenge: 0xff6b00, // orange
  rank:      0x5865f2, // blurple
  error:     0xed4245, // red
};

function eventCreated(event) {
  const fields = [
    { name: 'Matching', value: `\`${event.matching}\``, inline: true },
    { name: 'Team Size', value: `${event.team_size}`, inline: true },
  ];
  if (event.deadline) {
    fields.push({ name: 'Deadline', value: `<t:${event.deadline}:F>`, inline: true });
  }
  return new EmbedBuilder()
    .setColor(COLORS.event)
    .setTitle(`🎵 New Event: ${event.name}`)
    .setDescription(`Event **#${event.id}** is open for signups!\nUse \`/join id:${event.id}\` to enter.`)
    .addFields(fields)
    .setTimestamp();
}

function eventStarted(event, teamLines) {
  return new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle(`🚀 ${event.name} — Event Started!`)
    .setDescription('Signups are closed. Teams have been formed — check your private channel!')
    .addFields({ name: `Teams (${teamLines.length})`, value: teamLines.join('\n') || '_none_' })
    .setTimestamp();
}

function votingOpen(event, channelId) {
  return new EmbedBuilder()
    .setColor(COLORS.voting)
    .setTitle(`🗳️ ${event.name} — Voting is Open!`)
    .setDescription(
      `React with 🗳️ on your favorite track in <#${channelId}>.\n**One vote per person.**`
    )
    .setTimestamp();
}

function eventResults(event, winnerName, board, mmrLines) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.results)
    .setTitle(`🏆 ${event.name} — Final Results`)
    .setDescription(`**Winner: ${winnerName}**\n\n${board}`)
    .setTimestamp();
  if (mmrLines && mmrLines.length > 0) {
    embed.addFields({ name: 'MMR Changes', value: mmrLines.join('\n') });
  }
  return embed;
}

function teamWelcome(event, teamName, memberMentions, voiceChannelId, submissionsChannelId) {
  const fields = [
    {
      name: '📤 How to submit your track',
      value:
        `Use \`/submit id:${event.id} file:<your-audio-file>\` in this channel or in DM with the bot.\n` +
        `**Accepted formats:** \`.mp3\`, \`.wav\`, \`.flac\`, \`.ogg\`, \`.m4a\`\n` +
        `**Max file size:** 25 MB (Discord's limit)\n` +
        `You can re-submit any time before the deadline — the latest upload wins.` +
        (submissionsChannelId
          ? `\nAll submissions appear in <#${submissionsChannelId}> as they come in.`
          : ''),
    },
    {
      name: '👥 Your team',
      value: memberMentions,
    },
  ];

  if (voiceChannelId) {
    fields.push({
      name: '🎙️ Hop in voice',
      value: `Jump into <#${voiceChannelId}> to talk to your teammates while you work.`,
    });
  }

  if (event.deadline) {
    fields.unshift({
      name: '⏰ Deadline',
      value: `<t:${event.deadline}:F> (<t:${event.deadline}:R>)`,
    });
  }

  fields.push({
    name: '⚡ Watch for challenges',
    value: 'Mid-event challenges may appear in this channel — your final track must incorporate them!',
  });

  return new EmbedBuilder()
    .setColor(COLORS.event)
    .setTitle(`🎵 ${teamName}`)
    .setDescription(`Welcome to **${event.name}**! Here's everything you need to know.`)
    .addFields(fields)
    .setFooter({ text: 'Good luck — make something great!' })
    .setTimestamp();
}

function eventSignup(event, signupCount = 0) {
  const fields = [
    { name: 'Matching', value: `\`${event.matching}\``, inline: true },
    { name: 'Team Size', value: `${event.team_size}`, inline: true },
    { name: 'Signups',  value: `${signupCount}`,       inline: true },
  ];
  if (event.deadline) {
    fields.push({ name: 'Deadline', value: `<t:${event.deadline}:F> (<t:${event.deadline}:R>)` });
  }
  return new EmbedBuilder()
    .setColor(COLORS.event)
    .setTitle(`🎵 ${event.name}`)
    .setDescription(
      `**Event #${event.id}** is open for signups!\nClick **Join Event** below to enter.\n\n` +
      `_New here? Click **Set My Genre** first so you can be paired._`
    )
    .addFields(fields)
    .setTimestamp();
}

module.exports = {
  COLORS,
  eventCreated,
  eventSignup,
  eventStarted,
  votingOpen,
  eventResults,
  teamWelcome,
};
