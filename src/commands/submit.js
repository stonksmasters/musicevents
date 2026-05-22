'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { stmts } = require('../db');
const { formatUser } = require('../utils/users');
const config = require('../config');

const ALLOWED_EXT = new Set(['.mp3', '.wav', '.flac', '.ogg', '.m4a']);
const MAX_BYTES = 25 * 1024 * 1024; // Discord's default upload ceiling

const data = new SlashCommandBuilder()
  .setName('submit')
  .setDescription("Upload your team's track for a collab event")
  .addIntegerOption((o) =>
    o.setName('id').setDescription('Event ID').setRequired(true)
  )
  .addAttachmentOption((o) =>
    o.setName('file').setDescription('Audio file (mp3/wav/flac/ogg/m4a)').setRequired(true)
  );

async function execute(interaction) {
  const eventId = interaction.options.getInteger('id', true);
  const attachment = interaction.options.getAttachment('file', true);

  // /submit may run from a DM — guildId can be null. Look up the event
  // first to figure out which guild this submission belongs to.
  const event = stmts.getEvent.get(eventId);
  if (!event) {
    return interaction.reply({ content: 'Event not found.', ephemeral: true });
  }
  if (event.state !== 'active') {
    return interaction.reply({
      content: `Submissions are not open (event state: \`${event.state}\`).`,
      ephemeral: true,
    });
  }
  if (event.deadline && Math.floor(Date.now() / 1000) > event.deadline) {
    return interaction.reply({
      content: 'Deadline has passed — talk to a mod if you need an extension.',
      ephemeral: true,
    });
  }

  // Make sure the user is on a team for this event.
  const team = stmts.teamForUser.get(eventId, interaction.user.id);
  if (!team) {
    return interaction.reply({
      content: "You're not on a team for this event.",
      ephemeral: true,
    });
  }

  const ext = path.extname(attachment.name || '').toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return interaction.reply({
      content: `Unsupported file type \`${ext}\`. Allowed: ${[...ALLOWED_EXT].join(', ')}.`,
      ephemeral: true,
    });
  }
  if (attachment.size > MAX_BYTES) {
    return interaction.reply({
      content: `File too big (${(attachment.size / 1024 / 1024).toFixed(1)}MB). Max ${MAX_BYTES / 1024 / 1024}MB.`,
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const eventDir = path.join(config.uploadDir, String(eventId));
  fs.mkdirSync(eventDir, { recursive: true });
  const safeName = `team-${team.id}-${Date.now()}${ext}`;
  const dest = path.join(eventDir, safeName);

  try {
    await downloadTo(attachment.url, dest);
  } catch (err) {
    console.error('Failed to download attachment:', err);
    return interaction.editReply('Failed to download your file. Try again.');
  }

  stmts.insertSubmission.run({
    eventId,
    teamId: team.id,
    uploaderId: interaction.user.id,
    filePath: dest,
    fileName: attachment.name,
  });

  // Live-post to the event's submissions channel so everyone can hear it
  // as it comes in. The same message is reused for voting at /event end.
  if (event.submissions_channel_id) {
    try {
      const subChannel = await interaction.client.channels.fetch(event.submissions_channel_id);
      if (subChannel) {
        const members = stmts.membersForTeam.all(team.id).map((m) => formatUser(m.user_id));
        const file = new AttachmentBuilder(dest, { name: attachment.name });

        // If they re-submitted, delete the old post so we don't have stale tracks.
        const existing = stmts.submissionsForEvent.all(eventId).find((s) => s.team_id === team.id);
        if (existing?.message_id) {
          await subChannel.messages.delete(existing.message_id).catch(() => {});
        }

        const msg = await subChannel.send({
          content: `🎵 **${team.name}** — ${members.join(', ')}`,
          files: [file],
        });
        stmts.setSubmissionMessage.run(msg.id, team.id);
      }
    } catch (err) {
      console.error('Failed to post submission to submissions channel:', err);
    }
  }

  await interaction.editReply(
    `Submission received for **${team.name}**: \`${attachment.name}\` (${(attachment.size / 1024).toFixed(0)} KB).` +
      (event.submissions_channel_id ? `\nPosted live in <#${event.submissions_channel_id}>.` : '')
  );
}

function downloadTo(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          fs.unlink(dest, () => {});
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
      })
      .on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
  });
}

module.exports = { data, execute };
