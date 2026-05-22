'use strict';

// Lightweight HTML rendering — no template engine, just template literals.
// Tailwind via CDN keeps the markup short. All views return full HTML strings.

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout({ title, body, user, guild, devMode, flash }) {
  return `<!doctype html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)} · MusicEvents</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background:#0f0f12; color:#e7e7ea; font-family:ui-sans-serif,system-ui,sans-serif; }
    .card { background:#1a1a1f; border:1px solid #2a2a31; border-radius:12px; }
    .btn { display:inline-flex; align-items:center; gap:.4rem; padding:.5rem .9rem; border-radius:8px; font-weight:500; transition:filter .15s; cursor:pointer; }
    .btn:hover { filter:brightness(1.15); }
    .btn-primary { background:#5865f2; color:white; }
    .btn-success { background:#3ba55d; color:white; }
    .btn-danger  { background:#ed4245; color:white; }
    .btn-warn    { background:#faa61a; color:#1a1a1f; }
    .btn-ghost   { background:#2a2a31; color:#e7e7ea; }
    .pill { display:inline-block; padding:.15rem .55rem; border-radius:999px; font-size:.7rem; text-transform:uppercase; letter-spacing:.04em; }
    input, select, textarea { background:#0f0f12; border:1px solid #2a2a31; border-radius:8px; padding:.5rem .7rem; color:#e7e7ea; width:100%; }
    label { display:block; font-size:.8rem; color:#b8b8c0; margin-bottom:.3rem; }
    a { color:#9aa6ff; }
    a:hover { color:#c2caff; }
    .tab { padding:.5rem 1rem; border-bottom:2px solid transparent; cursor:pointer; }
    .tab.active { border-color:#5865f2; color:white; }
  </style>
</head>
<body class="min-h-screen">
  <header class="border-b border-[#2a2a31] bg-[#16161a]">
    <div class="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
      <a href="/" class="font-bold text-lg flex items-center gap-2 min-w-0">
        🎵 <span class="truncate">MusicEvents</span>
        ${devMode ? '<span class="pill bg-amber-700/40 text-amber-300 ml-1">DEV</span>' : ''}
      </a>
      <div class="flex items-center gap-3 text-sm flex-wrap">
        ${guild ? `<span class="text-gray-400 truncate max-w-[180px]">${esc(guild.name)}</span>` : ''}
        ${user ? `
          <span class="text-gray-300 hidden sm:inline">${esc(user.username)}</span>
          <form method="POST" action="/logout" class="inline"><button class="btn btn-ghost text-xs">Logout</button></form>
        ` : ''}
      </div>
    </div>
  </header>
  ${flash ? `<div class="max-w-6xl mx-auto px-6 mt-4"><div class="card p-3 text-sm border-l-4 ${flash.kind === 'error' ? 'border-red-500' : 'border-emerald-500'}">${esc(flash.message)}</div></div>` : ''}
  <main class="max-w-6xl mx-auto px-6 py-6">${body}</main>
</body>
</html>`;
}

function home({ user, devMode, guilds, flash }) {
  let body;
  if (!user) {
    body = `
      <div class="card p-8 text-center">
        <h1 class="text-3xl font-bold mb-2">🎵 MusicEvents Dashboard</h1>
        <p class="text-gray-400 mb-6">Manage your Discord music collab events from the web.</p>
        <a href="/login" class="btn btn-primary">Sign in with Discord</a>
        ${devMode ? '<p class="text-amber-400 text-sm mt-3">Dev mode is on — clicking will log you in as a fake admin.</p>' : ''}
      </div>`;
  } else if (guilds.length === 0) {
    body = `
      <div class="card p-8 text-center">
        <h1 class="text-2xl font-bold mb-2">No servers found</h1>
        <p class="text-gray-400">You need <code>Manage Server</code> permission on a server where the bot is installed.</p>
      </div>`;
  } else {
    body = `
      <h1 class="text-2xl font-bold mb-4">Your servers</h1>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        ${guilds.map((g) => `
          <a href="/g/${esc(g.id)}" class="card p-5 hover:border-indigo-500 transition">
            <div class="font-semibold text-lg">${esc(g.name)}</div>
            <div class="text-xs text-gray-500 mt-1">${esc(g.id)}</div>
          </a>
        `).join('')}
      </div>`;
  }
  return layout({ title: 'Home', body, user, devMode, flash });
}

function guildPage({ user, devMode, guild, events, settings, leaderboard, challenges, flash, tab = 'events' }) {
  const tabs = ['events', 'settings', 'challenges', 'leaderboard'];
  const tabsHtml = tabs.map((t) => `
    <a href="?tab=${t}" class="tab ${t === tab ? 'active' : ''}">${t[0].toUpperCase() + t.slice(1)}</a>
  `).join('');

  let panel = '';
  if (tab === 'events') panel = eventsPanel({ events, guild, devMode });
  if (tab === 'settings') panel = settingsPanel({ settings, guild });
  if (tab === 'challenges') panel = challengesPanel({ settings, guild });
  if (tab === 'leaderboard') panel = leaderboardPanel({ leaderboard });

  const body = `
    <div class="flex gap-1 border-b border-[#2a2a31] mb-6">${tabsHtml}</div>
    ${panel}
  `;
  return layout({ title: guild.name, body, user, devMode, guild, flash });
}

const STATE_COLOR = {
  signup:   'bg-emerald-700/40 text-emerald-300',
  active:   'bg-blue-700/40 text-blue-300',
  voting:   'bg-amber-700/40 text-amber-300',
  finished: 'bg-gray-700/40 text-gray-400',
};

function eventsPanel({ events, guild, devMode }) {
  const eventsHtml = events.length === 0
    ? '<p class="text-gray-500">No events yet. Create one below.</p>'
    : `<div class="space-y-3">${events.map((e) => `
        <a href="/g/${guild.id}/events/${e.id}" class="block card p-4 hover:border-indigo-500 transition">
          <div class="flex items-center justify-between flex-wrap gap-3">
            <div class="min-w-0">
              <div class="font-semibold text-lg truncate">#${e.id} — ${esc(e.name)}</div>
              <div class="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-x-2">
                <span class="pill ${STATE_COLOR[e.state] || ''}">${e.state}</span>
                <span>matching <code>${esc(e.matching)}</code></span>
                <span>· team size ${e.team_size}</span>
                <span>· ${e.signup_count || 0} signup${(e.signup_count || 0) === 1 ? '' : 's'}</span>
                ${e.deadline ? `<span>· deadline ${new Date(e.deadline * 1000).toLocaleString()}</span>` : ''}
              </div>
            </div>
            <div class="text-gray-400">→ Manage</div>
          </div>
        </a>
      `).join('')}</div>`;

  return `
    ${eventsHtml}
    <div class="card p-5 mt-6">
      <h2 class="font-semibold text-lg mb-4">Create New Event</h2>
      <form method="POST" action="/g/${guild.id}/events" class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="md:col-span-2"><label>Event Name</label><input name="name" required placeholder="May Beat Battle"></div>
        <div><label>Matching</label>
          <select name="matching">
            <option value="">(server default)</option>
            <option value="random">Random</option>
            <option value="genre">Genre</option>
            <option value="draft">Draft</option>
            <option value="mmr">MMR (skill-balanced)</option>
          </select>
        </div>
        <div><label>Team Size</label><input type="number" name="team_size" value="2" min="2" max="8"></div>
        <div class="md:col-span-2"><label>Deadline (optional)</label><input type="datetime-local" name="deadline"></div>
        <div class="md:col-span-2"><button class="btn btn-primary">+ Create Event</button></div>
      </form>
      <p class="text-xs text-gray-500 mt-3">When you click create, the bot will post a sign-up announcement with Join/Leave buttons in <code>#events</code> (auto-created if it doesn't exist).</p>
    </div>
  `;
}

// ----- Event detail page -----
function eventDetailPage({ user, devMode, guild, event, signups, teams, members, submissions, votes, challenges, flash }) {
  const stateLabel = `<span class="pill ${STATE_COLOR[event.state] || ''}">${event.state}</span>`;
  const deadlineStr = event.deadline ? new Date(event.deadline * 1000).toLocaleString() : '—';
  const startedStr = event.started_at ? new Date(event.started_at * 1000).toLocaleString() : '—';

  // members map: { team_id -> [user_ids] }
  const membersByTeam = new Map();
  for (const m of members) {
    if (!membersByTeam.has(m.team_id)) membersByTeam.set(m.team_id, []);
    membersByTeam.get(m.team_id).push(m.user_id);
  }
  const votesByTeam = new Map();
  for (const v of votes) votesByTeam.set(v.team_id, v.votes);

  const actionButtons = `
    <div class="flex flex-wrap gap-2">
      ${event.state === 'signup'   ? `<form method="POST" action="/g/${guild.id}/events/${event.id}/start"><button class="btn btn-primary">▶ Start Event</button></form>` : ''}
      ${event.state === 'active'   ? `<form method="POST" action="/g/${guild.id}/events/${event.id}/end"><button class="btn btn-warn">⏹ End & Open Voting</button></form>` : ''}
      ${event.state === 'voting'   ? `<form method="POST" action="/g/${guild.id}/events/${event.id}/tally"><button class="btn btn-success">🏆 Tally Votes</button></form>` : ''}
      ${event.state !== 'finished' ? `
        <form method="POST" action="/g/${guild.id}/events/${event.id}/cancel" onsubmit="return confirm('Cancel this event? Channels will be cleaned up.')">
          <button class="btn btn-danger">Cancel Event</button>
        </form>` : ''}
    </div>`;

  const signupsHtml = signups.length === 0
    ? '<p class="text-gray-500 text-sm">No signups yet.</p>'
    : `<ul class="space-y-1 text-sm">${signups.map((s) => `
        <li class="flex items-center justify-between">
          <span class="font-mono text-xs">${esc(s.user_id)}</span>
          <span class="text-gray-500">${esc(s.genre || '—')} · MMR ${s.mmr || 1000}</span>
        </li>`).join('')}</ul>`;

  const teamsHtml = teams.length === 0
    ? '<p class="text-gray-500 text-sm">No teams formed yet — start the event to pair artists.</p>'
    : `<div class="space-y-2">${teams.map((t) => {
        const mems = (membersByTeam.get(t.id) || []).map((uid) => `<code class="text-xs">${esc(uid)}</code>`).join(', ');
        const voteCount = votesByTeam.get(t.id) || 0;
        return `
          <div class="p-3 bg-[#0f0f12] border border-[#2a2a31] rounded">
            <div class="flex items-center justify-between gap-3">
              <div class="font-semibold">${esc(t.name)}</div>
              ${event.state === 'voting' || event.state === 'finished' ? `<div class="text-sm text-amber-300">${voteCount} vote${voteCount === 1 ? '' : 's'}</div>` : ''}
            </div>
            <div class="text-xs text-gray-500 mt-1">${mems}</div>
            ${t.channel_id ? `<div class="text-xs mt-1"><a href="https://discord.com/channels/${guild.id}/${t.channel_id}" target="_blank">→ Discord channel</a></div>` : ''}
          </div>`;
      }).join('')}</div>`;

  const submissionsHtml = submissions.length === 0
    ? '<p class="text-gray-500 text-sm">No submissions yet.</p>'
    : `<ul class="space-y-2 text-sm">${submissions.map((s) => `
        <li class="p-3 bg-[#0f0f12] border border-[#2a2a31] rounded">
          <div class="font-semibold">${esc(s.team_name)}</div>
          <div class="text-xs text-gray-500 mt-1">📎 ${esc(s.file_name)} · submitted ${new Date(s.submitted_at * 1000).toLocaleString()}</div>
        </li>`).join('')}</ul>`;

  const challengesHtml = challenges.length === 0
    ? '<p class="text-gray-500 text-sm">No challenges fired yet.</p>'
    : `<ul class="space-y-2 text-sm">${challenges.map((c, i) => `
        <li class="p-3 bg-[#0f0f12] border border-[#2a2a31] rounded">
          <span class="text-amber-400 font-semibold">⚡ Challenge ${i + 1}</span> ·
          <span class="text-gray-500">${new Date(c.triggered_at * 1000).toLocaleString()}</span>
          <div class="mt-1">${esc(c.text)}</div>
        </li>`).join('')}</ul>`;

  const triggerChallengeForm = event.state === 'active' ? `
    <form method="POST" action="/g/${guild.id}/events/${event.id}/challenge" class="mt-3 flex gap-2 flex-wrap">
      <input name="text" placeholder="Custom challenge text (leave blank for random from pool)" class="flex-1 min-w-[200px]">
      <button class="btn btn-warn">⚡ Fire Challenge Now</button>
    </form>` : '';

  const devToolsHtml = devMode && event.state === 'signup' ? `
    <div class="card p-4 mt-6 border-amber-700/40">
      <h3 class="font-semibold mb-2 text-amber-300">🧪 Dev Tools</h3>
      <p class="text-xs text-gray-400 mb-3">Add test users so you can trigger matching/MMR by yourself. Test users are skipped during DMs and channel permissions.</p>
      <div class="flex flex-wrap gap-2">
        <form method="POST" action="/g/${guild.id}/events/${event.id}/dev-signup" class="flex gap-1">
          <input type="number" name="count" value="3" min="1" max="20" class="w-20 text-sm">
          <button class="btn btn-ghost text-sm">+ Add Test Users</button>
        </form>
        <form method="POST" action="/g/${guild.id}/events/${event.id}/dev-self-signup">
          <button class="btn btn-ghost text-sm" title="Sign yourself up using your real Discord ID">+ Sign Me Up</button>
        </form>
      </div>
    </div>` : '';

  const body = `
    <div class="mb-4 text-sm">
      <a href="/g/${guild.id}" class="text-gray-400 hover:text-white">← Back to events</a>
    </div>

    <div class="card p-5 mb-5">
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div class="min-w-0">
          <div class="text-gray-400 text-xs">EVENT #${event.id}</div>
          <h1 class="text-2xl font-bold">${esc(event.name)}</h1>
          <div class="mt-2 text-sm flex flex-wrap gap-x-3 gap-y-1 text-gray-400">
            ${stateLabel}
            <span>matching <code>${esc(event.matching)}</code></span>
            <span>team size ${event.team_size}</span>
            <span>${signups.length} signup${signups.length === 1 ? '' : 's'}</span>
            <span>started ${startedStr}</span>
            <span>deadline ${deadlineStr}</span>
          </div>
        </div>
        ${actionButtons}
      </div>
      ${triggerChallengeForm}
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="card p-4">
        <h2 class="font-semibold mb-3">Signups (${signups.length})</h2>
        ${signupsHtml}
      </div>
      <div class="card p-4">
        <h2 class="font-semibold mb-3">Teams (${teams.length})</h2>
        ${teamsHtml}
      </div>
      <div class="card p-4">
        <h2 class="font-semibold mb-3">Submissions (${submissions.length})</h2>
        ${submissionsHtml}
      </div>
      <div class="card p-4">
        <h2 class="font-semibold mb-3">Challenges (${challenges.length})</h2>
        ${challengesHtml}
      </div>
    </div>

    ${devToolsHtml}
  `;

  return layout({ title: event.name, body, user, devMode, guild, flash });
}

function settingsPanel({ settings, guild }) {
  const s = settings || {};
  const announceLabel = s.announce_channel_id
    ? `<a href="https://discord.com/channels/${guild.id}/${s.announce_channel_id}" target="_blank">Open in Discord ↗</a>`
    : `<em class="text-gray-500">Auto-created on first event</em>`;
  const winnersLabel = s.winners_channel_id
    ? `<a href="https://discord.com/channels/${guild.id}/${s.winners_channel_id}" target="_blank">Open in Discord ↗</a>`
    : `<em class="text-gray-500">Auto-created when first event is tallied</em>`;
  return `
    <div class="card p-5 mb-4">
      <h2 class="font-semibold text-lg mb-2">Channels</h2>
      <p class="text-sm text-gray-400 mb-3">The bot manages two server-wide channels automatically. You don't need to set them up — they appear when needed.</p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div class="p-3 bg-[#0f0f12] border border-[#2a2a31] rounded">
          <div class="font-semibold">📣 #events</div>
          <div class="text-xs text-gray-500 mt-1">Sign-up announcements with Join/Leave buttons, "event started" updates, voting open notices.</div>
          <div class="text-xs mt-2">${announceLabel}</div>
        </div>
        <div class="p-3 bg-[#0f0f12] border border-[#2a2a31] rounded">
          <div class="font-semibold">🏆 #winners</div>
          <div class="text-xs text-gray-500 mt-1">Final results, vote tallies, and MMR changes after every event.</div>
          <div class="text-xs mt-2">${winnersLabel}</div>
        </div>
      </div>
    </div>

    <div class="card p-5">
      <h2 class="font-semibold text-lg mb-4">Event Defaults</h2>
      <form method="POST" action="/g/${guild.id}/settings" class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><label>Default Matching Strategy</label>
          <select name="default_matching">
            ${['random','genre','draft','mmr'].map((m) => `<option value="${m}" ${s.default_matching === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
          <div class="text-xs text-gray-500 mt-1">Used when an event is created without specifying matching.</div>
        </div>
        <div><label>Auto Mid-Event Challenges</label>
          <select name="challenge_enabled">
            <option value="1" ${s.challenge_enabled !== 0 ? 'selected' : ''}>Enabled</option>
            <option value="0" ${s.challenge_enabled === 0 ? 'selected' : ''}>Disabled</option>
          </select>
        </div>
        <div><label>Challenge Min Interval (minutes)</label>
          <input type="number" name="challenge_interval_min" min="5" max="240" value="${s.challenge_interval_min || 20}">
        </div>
        <div><label>Challenge Max Interval (minutes)</label>
          <input type="number" name="challenge_interval_max" min="5" max="720" value="${s.challenge_interval_max || 60}">
        </div>
        <input type="hidden" name="announce_channel_id" value="${esc(s.announce_channel_id || '')}">
        <div class="md:col-span-2"><button class="btn btn-primary">Save Settings</button></div>
      </form>
    </div>
  `;
}

function challengesPanel({ settings, guild }) {
  let pool = [];
  try { pool = JSON.parse(settings?.challenge_pool || '[]'); } catch {}

  return `
    <div class="card p-5 mb-6">
      <h2 class="font-semibold text-lg mb-2">Custom Challenge Pool</h2>
      <p class="text-sm text-gray-400 mb-4">
        ${pool.length === 0
          ? 'Empty — using built-in defaults. Add challenges below to override them.'
          : `${pool.length} custom challenge${pool.length === 1 ? '' : 's'}.`}
      </p>
      ${pool.length === 0 ? '' : `<ol class="space-y-2 mb-4">${pool.map((c, i) => `
        <li class="flex items-center justify-between gap-3 p-3 bg-[#0f0f12] border border-[#2a2a31] rounded">
          <span class="text-sm">${esc(c)}</span>
          <form method="POST" action="/g/${guild.id}/challenges/remove">
            <input type="hidden" name="index" value="${i}">
            <button class="btn btn-ghost text-xs">Remove</button>
          </form>
        </li>
      `).join('')}</ol>`}
      <form method="POST" action="/g/${guild.id}/challenges" class="flex gap-2">
        <input name="text" required placeholder="Add a challenge — e.g. 'Use a key change'" class="flex-1">
        <button class="btn btn-primary">Add</button>
      </form>
      ${pool.length > 0 ? `
        <form method="POST" action="/g/${guild.id}/challenges/reset" class="mt-3">
          <button class="btn btn-ghost text-xs">Reset to built-in defaults</button>
        </form>
      ` : ''}
    </div>
  `;
}

function leaderboardPanel({ leaderboard }) {
  if (leaderboard.length === 0) {
    return '<div class="card p-8 text-center text-gray-500">No rankings yet — complete an event first.</div>';
  }
  const medals = ['🥇', '🥈', '🥉'];
  return `
    <div class="card p-5">
      <h2 class="font-semibold text-lg mb-4">🏆 MMR Leaderboard</h2>
      <table class="w-full text-sm">
        <thead><tr class="text-gray-500 text-left border-b border-[#2a2a31]">
          <th class="py-2 w-12">#</th>
          <th>User ID</th>
          <th class="text-right">MMR</th>
          <th class="text-right">W / L</th>
          <th class="text-right">Events</th>
        </tr></thead>
        <tbody>
          ${leaderboard.map((r, i) => `
            <tr class="border-b border-[#2a2a31]/50">
              <td class="py-2">${medals[i] || (i + 1)}</td>
              <td class="font-mono text-xs">${esc(r.user_id)}</td>
              <td class="text-right font-semibold">${r.mmr}</td>
              <td class="text-right">${r.wins} / ${r.losses}</td>
              <td class="text-right text-gray-500">${r.events_played}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

module.exports = { home, guildPage, eventDetailPage, layout, esc };
