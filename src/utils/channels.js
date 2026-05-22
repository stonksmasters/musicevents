'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { realUsersOnly } = require('./users');

// Create a private text channel for a team that only the bot, the team
// members, and admins can see. Returns the created channel.
async function createTeamChannel(guild, { teamName, memberIds, parentId }) {
  const everyone = guild.roles.everyone;
  const overwrites = [
    {
      id: everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: guild.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.AttachFiles,
      ],
    },
    ...realUsersOnly(memberIds).map((id) => ({
      id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    })),
  ];

  const channel = await guild.channels.create({
    name: slug(teamName),
    type: ChannelType.GuildText,
    parent: parentId || undefined,
    permissionOverwrites: overwrites,
    topic: `Private collab channel for team "${teamName}".`,
  });
  return channel;
}

// Create a private voice channel for a team. Same access rules as the text
// channel: only team members, the bot, and admins can join/speak.
async function createTeamVoiceChannel(guild, { teamName, memberIds, parentId }) {
  const everyone = guild.roles.everyone;
  const overwrites = [
    {
      id: everyone.id,
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
    },
    {
      id: guild.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.MoveMembers,
      ],
    },
    ...realUsersOnly(memberIds).map((id) => ({
      id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.Stream,
        PermissionFlagsBits.UseVAD,
      ],
    })),
  ];

  return guild.channels.create({
    name: `${slug(teamName)}-voice`,
    type: ChannelType.GuildVoice,
    parent: parentId || undefined,
    permissionOverwrites: overwrites,
  });
}

// Create a public submissions channel for an event. Everyone in the guild
// can read it; only the bot can post. Used for live submissions during the
// event and for voting at the end.
async function createSubmissionsChannel(guild, { eventName, parentId }) {
  const everyone = guild.roles.everyone;
  const overwrites = [
    {
      id: everyone.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AddReactions,
      ],
      deny: [PermissionFlagsBits.SendMessages],
    },
    {
      id: guild.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.AddReactions,
      ],
    },
  ];

  return guild.channels.create({
    name: `📥-${slug(eventName)}-submissions`.slice(0, 90),
    type: ChannelType.GuildText,
    parent: parentId || undefined,
    permissionOverwrites: overwrites,
    topic: `Submissions for "${eventName}". Tracks appear here as teams submit.`,
  });
}

// Delete a list of channels and (optionally) a category, swallowing errors
// so partial cleanup still works.
async function deleteEventChannels(guild, { channelIds = [], categoryId = null }) {
  for (const id of channelIds) {
    if (!id) continue;
    try {
      const ch = await guild.channels.fetch(id).catch(() => null);
      if (ch) await ch.delete('Event ended — auto cleanup');
    } catch (err) {
      console.error(`Failed to delete channel ${id}:`, err.message);
    }
  }
  if (categoryId) {
    try {
      const cat = await guild.channels.fetch(categoryId).catch(() => null);
      if (cat) await cat.delete('Event ended — auto cleanup');
    } catch (err) {
      console.error(`Failed to delete category ${categoryId}:`, err.message);
    }
  }
}

async function ensureCategory(guild, name) {
  const existing = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === name
  );
  if (existing) return existing;
  return guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
  });
}

// Find an existing text channel by name (case-insensitive, ignoring leading
// emoji decorations like "🏆-") or create one. Used for the bot's standard
// #events / #winners channels so mods don't have to set them up manually.
async function ensureGuildChannel(guild, name, { topic, readonly = false } = {}) {
  const target = name.toLowerCase();
  const existing = guild.channels.cache.find(
    (c) =>
      c.type === ChannelType.GuildText &&
      (c.name === target ||
       c.name === name ||
       c.name.replace(/^[^a-z0-9]+/, '') === target)
  );
  if (existing) return existing;

  const overwrites = [];
  if (readonly) {
    overwrites.push(
      {
        id: guild.roles.everyone.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AddReactions,
        ],
        deny: [PermissionFlagsBits.SendMessages],
      },
      {
        id: guild.client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.AddReactions,
        ],
      },
    );
  }

  return guild.channels.create({
    name: target,
    type: ChannelType.GuildText,
    topic: topic || undefined,
    permissionOverwrites: overwrites.length > 0 ? overwrites : undefined,
  });
}

function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90) || 'team';
}

module.exports = {
  createTeamChannel,
  createTeamVoiceChannel,
  createSubmissionsChannel,
  deleteEventChannels,
  ensureCategory,
  ensureGuildChannel,
  slug,
};
