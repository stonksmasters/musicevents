'use strict';

// Pluggable matching strategies.
// Each strategy exports buildTeams(signups, options) -> Array<Array<userId>>.
// `signups` is an array of { user_id, genre, daw, skill }.
// `options` carries { teamSize }.

const random = require('./random');
const genre  = require('./genre');
const draft  = require('./draft');
const mmr    = require('./mmr');

const strategies = { random, genre, draft, mmr };

function getStrategy(name) {
  return strategies[name] || strategies.random;
}

function buildTeams(strategyName, signups, options) {
  const strategy = getStrategy(strategyName);
  return strategy.buildTeams(signups, options);
}

module.exports = {
  buildTeams,
  getStrategy,
  strategies,
};
