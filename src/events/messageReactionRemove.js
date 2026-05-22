'use strict';

const { db, stmts } = require('../db');
const { TEAM_EMOJI } = require('../utils/voting');

module.exports = {
  name: 'messageReactionRemove',
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

    // Only remove the vote if it matched THIS team. Voter may have moved to
    // a different submission; that newer vote is what's stored now.
    const current = db
      .prepare('SELECT team_id FROM votes WHERE event_id = ? AND voter_id = ?')
      .get(event.id, user.id);
    if (current?.team_id === row.team_id) {
      stmts.removeVote.run(event.id, user.id);
    }
  },
};
