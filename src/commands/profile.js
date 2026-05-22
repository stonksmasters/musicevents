'use strict';

const {
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
} = require('discord.js');
const { stmts } = require('../db');
const { GENRES } = require('../utils/genres');

const data = new SlashCommandBuilder()
  .setName('profile')
  .setDescription('Set up or view your artist profile')
  .addSubcommand((s) =>
    s.setName('setup').setDescription('Set up your artist profile (only need to do this once)')
  )
  .addSubcommand((s) =>
    s
      .setName('view')
      .setDescription('View an artist profile')
      .addUserOption((o) =>
        o.setName('user').setDescription('Whose profile? (defaults to you)')
      )
  );

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'setup') return handleSetup(interaction);
  if (sub === 'view')  return handleView(interaction);
}

async function handleSetup(interaction) {
  return openSetup(interaction);
}

// Used both by /profile setup and the [Set My Genre] button on event announcements.
async function openSetup(interaction) {
  const existing = stmts.getArtist.get(interaction.guildId, interaction.user.id);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🎚️ Artist Profile')
    .setDescription(
      existing?.genre
        ? `Your current genre: **${existing.genre}**\nPick a new one below to update it.`
        : 'Pick your primary genre below. You only need to do this once — we use it to pair you up for events.'
    );

  const select = new StringSelectMenuBuilder()
    .setCustomId('profile:genre_select')
    .setPlaceholder('Choose a genre…')
    .addOptions(
      GENRES.map((g) => ({
        label: g,
        value: g,
        default: existing?.genre === g,
      }))
    );

  const reply = { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], ephemeral: true };
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(reply);
  }
  return interaction.reply(reply);
}

// Called from the StringSelectMenu choice.
async function handleGenreSelect(interaction) {
  const choice = interaction.values[0];

  if (choice === 'Other') {
    // Open a modal to type a custom genre.
    const modal = new ModalBuilder()
      .setCustomId('profile:genre_modal')
      .setTitle('Custom Genre')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('genre_text')
            .setLabel('Type your genre')
            .setStyle(TextInputStyle.Short)
            .setMinLength(2)
            .setMaxLength(40)
            .setRequired(true)
            .setPlaceholder('e.g. Vaporwave')
        )
      );
    return interaction.showModal(modal);
  }

  saveGenre(interaction, choice);
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('✅ Profile saved')
        .setDescription(`Your genre is set to **${choice}**. You're ready to join events!`),
    ],
    components: [],
  });
}

// Called when the modal is submitted.
async function handleGenreModal(interaction) {
  const text = interaction.fields.getTextInputValue('genre_text').trim();
  if (!text) {
    return interaction.reply({ content: 'Empty genre — try again.', ephemeral: true });
  }
  saveGenre(interaction, text);
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('✅ Profile saved')
        .setDescription(`Your genre is set to **${text}**. You're ready to join events!`),
    ],
    ephemeral: true,
  });
}

function saveGenre(interaction, genre) {
  stmts.upsertArtist.run({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    genre,
    daw: null,
    skill: null,
  });
}

async function handleView(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  const row  = stmts.getArtist.get(interaction.guildId, user.id);
  const ranking = stmts.getRanking.get(interaction.guildId, user.id);

  const fields = [
    { name: 'Genre', value: row?.genre || '_not set_', inline: true },
  ];
  if (ranking) {
    fields.push(
      { name: 'MMR',           value: `${ranking.mmr}`,           inline: true },
      { name: 'W / L',         value: `${ranking.wins} / ${ranking.losses}`, inline: true },
      { name: 'Events Played', value: `${ranking.events_played}`, inline: true },
    );
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Profile — ${user.displayName || user.username}`)
    .setThumbnail(user.displayAvatarURL())
    .addFields(fields)
    .setTimestamp();

  const components = user.id === interaction.user.id
    ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('profile:setup')
          .setLabel('🎚️ Edit Genre')
          .setStyle(ButtonStyle.Primary)
      )]
    : [];

  await interaction.reply({ embeds: [embed], components, ephemeral: true });
}

module.exports = {
  data,
  execute,
  openSetup,
  handleGenreSelect,
  handleGenreModal,
};
