'use strict';

// Test users created via the dashboard (dev mode) have IDs prefixed with this.
// Real Discord snowflakes are numeric strings, so this never collides.
const TEST_PREFIX = 'test-';

function isFakeUser(userId) {
  return typeof userId === 'string' && userId.startsWith(TEST_PREFIX);
}

function realUsersOnly(userIds) {
  return userIds.filter((id) => !isFakeUser(id));
}

// Pretty label for a user — works for real or fake. Real returns a Discord
// mention; fake returns plain text the bot can include in messages.
function formatUser(userId) {
  if (isFakeUser(userId)) {
    const short = userId.slice(TEST_PREFIX.length, TEST_PREFIX.length + 6);
    return `🧪 \`Test-${short}\``;
  }
  return `<@${userId}>`;
}

function formatUsers(userIds) {
  return userIds.map(formatUser).join(', ');
}

function newFakeId() {
  // crypto.randomUUID is built-in (Node 14.17+)
  return TEST_PREFIX + require('crypto').randomUUID().replace(/-/g, '');
}

module.exports = { TEST_PREFIX, isFakeUser, realUsersOnly, formatUser, formatUsers, newFakeId };
