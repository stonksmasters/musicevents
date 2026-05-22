'use strict';

const { EmbedBuilder } = require('discord.js');

const DEFAULT_CHALLENGES = [
  'Add a rain or water sound somewhere in your track.',
  'Your track must include a key change or modulation.',
  'Add a spoken word or vocal chop element.',
  'Keep your final track under 3 minutes.',
  'Incorporate a traditional or folk instrument sound.',
  'Add a reverse reverb effect on at least one element.',
  'Use a 7th or 9th chord somewhere in your harmony.',
  'Your track must begin with at least 5 seconds of silence or ambience.',
  'Add a percussion element borrowed from a completely different genre.',
  'Use exactly 3 distinct sound sources — no more, no less.',
  'Layer two contrasting rhythmic patterns simultaneously.',
  'Record and use a field recording of any real-world sound.',
  'Your track must feature a tempo change.',
  'Add a call-and-response element between two instruments.',
  'Use only sounds from a single instrument family.',
];

// eventId -> { timeoutId, stopped }
const active = new Map();

function start(eventId, client, guildId, channelIds, settings = {}) {
  stop(eventId);
  if (!settings.challenge_enabled && settings.challenge_enabled !== undefined) return;
  scheduleNext(eventId, client, guildId, channelIds, settings);
}

function scheduleNext(eventId, client, guildId, channelIds, settings) {
  const minMs = (settings.challenge_interval_min || 20) * 60 * 1000;
  const maxMs = (settings.challenge_interval_max || 60) * 60 * 1000;
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;

  const timeoutId = setTimeout(async () => {
    if (!active.has(eventId)) return;
    active.delete(eventId);

    const pool = getPool(settings);
    const text = pool[Math.floor(Math.random() * pool.length)];

    try {
      await postChallenge(client, eventId, guildId, channelIds, text, settings);
    } catch (err) {
      console.error(`[ChallengeScheduler] Failed to post challenge for event ${eventId}:`, err);
    }

    // Reschedule unless event was stopped during the post
    if (!active.has(eventId)) {
      scheduleNext(eventId, client, guildId, channelIds, settings);
    }
  }, delay);

  active.set(eventId, timeoutId);
}

function stop(eventId) {
  const id = active.get(eventId);
  if (id !== undefined) {
    clearTimeout(id);
    active.delete(eventId);
  }
}

function getPool(settings) {
  try {
    const custom = JSON.parse(settings.challenge_pool || '[]');
    return custom.length > 0 ? custom : DEFAULT_CHALLENGES;
  } catch {
    return DEFAULT_CHALLENGES;
  }
}

async function postChallenge(client, eventId, guildId, channelIds, text, settings) {
  const { stmts } = require('../db');
  stmts.insertChallenge.run({ eventId, text });

  const embed = new EmbedBuilder()
    .setColor(0xff6b00)
    .setTitle('⚡ Mid-Event Challenge!')
    .setDescription(`> ${text}`)
    .setFooter({ text: 'All teams must incorporate this into their submission.' })
    .setTimestamp();

  const announceChannelId = settings.announce_channel_id;
  if (announceChannelId) {
    try {
      const ch = await client.channels.fetch(announceChannelId);
      if (ch) {
        await ch.send({ embeds: [embed] });
        return;
      }
    } catch {}
  }

  // Fall back: post in every team channel
  for (const channelId of channelIds) {
    try {
      const ch = await client.channels.fetch(channelId);
      if (ch) await ch.send({ embeds: [embed] });
    } catch {}
  }
}

module.exports = { start, stop, postChallenge, getPool, DEFAULT_CHALLENGES };
