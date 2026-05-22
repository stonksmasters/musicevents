'use strict';

const { db, stmts } = require('../db');
const { TEAM_EMOJI } = require('../utils/voting');

// When a user reacts to a submission post in the voting channel with the
// configured TEAM_EMOJI, record their vote (one vote per voter per event).
// Reacting on a different submission moves the vote to that team.
module.exports = {
  name: 'messageReactionAdd',
  async execute(reaction, user) {
    if (user.bot) return;
    try {
      if (reaction.partial) await reaction.fetch();
      if (reaction.message.partial) await reaction.message.fetch();
    } catch {
      return;
    }
    if (reaction.emoji.name !== TEAM_EMOJI) return;

    const row = db
      .prepare('SELECT event_id, team_id FROM submissions WHERE message_id = ?')
      .get(reaction.message.id);
    if (!row) return;

    const event = stmts.getEvent.get(row.event_id);
    if (!event || event.state !== 'voting') return;

    stmts.recordVote.run(event.id, user.id, row.team_id);
  },
};
