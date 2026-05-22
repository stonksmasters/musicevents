'use strict';

const { EmbedBuilder } = require('discord.js');

// eventId -> [timeoutId, ...]
const active = new Map();

// Schedule reminders at: halfway, 1h left, 15min left, deadline hit
function start(eventId, client, deadlineUnix, channelIds, eventName) {
  stop(eventId);
  if (!deadlineUnix) return;

  const now = Math.floor(Date.now() / 1000);
  const total = deadlineUnix - now;
  if (total <= 0) return;

  const milestones = [
    { offset: total / 2,        label: 'Halfway there!',    color: 0x5865f2 },
    { offset: total - 3600,     label: '1 hour remaining',  color: 0xfee75c },
    { offset: total - 900,      label: '15 minutes left!',  color: 0xff6b00 },
    { offset: total,            label: "Time's up — submissions closing!", color: 0xed4245, final: true },
  ];

  const timeouts = [];
  for (const m of milestones) {
    if (m.offset <= 0 || m.offset > total) continue;
    const ms = m.offset * 1000;
    const id = setTimeout(async () => {
      try {
        await postReminder(client, channelIds, eventName, m, deadlineUnix);
      } catch (err) {
        console.error(`[DeadlineReminder] Failed for event ${eventId}:`, err);
      }
    }, ms);
    timeouts.push(id);
  }

  active.set(eventId, timeouts);
}

function stop(eventId) {
  const timeouts = active.get(eventId);
  if (timeouts) {
    for (const id of timeouts) clearTimeout(id);
    active.delete(eventId);
  }
}

async function postReminder(client, channelIds, eventName, milestone, deadlineUnix) {
  const embed = new EmbedBuilder()
    .setColor(milestone.color)
    .setTitle(`⏰ ${milestone.label}`)
    .setDescription(
      milestone.final
        ? `**${eventName}** — submissions are closing now. Run \`/submit\` if you haven't!`
        : `**${eventName}** — deadline <t:${deadlineUnix}:R> (<t:${deadlineUnix}:F>)`
    )
    .setTimestamp();

  for (const channelId of channelIds) {
    try {
      const ch = await client.channels.fetch(channelId);
      if (ch) await ch.send({ embeds: [embed] });
    } catch {}
  }
}

module.exports = { start, stop };
