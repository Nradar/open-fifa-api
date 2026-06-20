const fs = require('fs');
const path = require('path');

function createStore(options = {}) {
  const snapshotPath = options.snapshotPath || process.env.SNAPSHOT_PATH || null;

  const state = {
    matches: new Map(),
    eventsByMatch: new Map(),
    eventIds: new Set(),
    recentEvents: [],
    meta: {
      startedAt: new Date().toISOString(),
      lastPollAt: null,
      lastScheduleSyncAt: null,
      lastError: null,
      liveCount: 0,
    },
  };

  const sseClients = new Set();

  function getMatch(id) {
    return state.matches.get(String(id)) || null;
  }

  function getAllMatches() {
    return [...state.matches.values()].sort((a, b) => {
      const ta = a.datetime ? new Date(a.datetime).getTime() : 0;
      const tb = b.datetime ? new Date(b.datetime).getTime() : 0;
      return ta - tb || (a.matchNumber || 0) - (b.matchNumber || 0);
    });
  }

  function getLiveMatches() {
    return getAllMatches().filter((m) => m.status === 'live');
  }

  function upsertMatch(match) {
    const id = String(match.id);
    const existing = state.matches.get(id) || {};
    state.matches.set(id, { ...existing, ...match, id });
    if (!state.eventsByMatch.has(id)) {
      state.eventsByMatch.set(id, []);
    }
    return state.matches.get(id);
  }

  function setMatchStatus(id, status, extras = {}) {
    const match = state.matches.get(String(id));
    if (!match) return null;
    Object.assign(match, { status, ...extras, updatedAt: new Date().toISOString() });
    return match;
  }

  function getMatchEvents(matchId, { publicOnly = false } = {}) {
    const events = state.eventsByMatch.get(String(matchId)) || [];
    if (!publicOnly) return [...events];
    return events.filter((e) => e.type !== 'other');
  }

  function eventRichness(event) {
    let score = 0;
    if (event.player?.name) score += 20;
    else if (event.player?.id) score += 8;
    const desc = String(event.description || '');
    if (desc && !/^[^()]+\s+score!$/i.test(desc.trim())) score += 5;
    if (desc.includes('(')) score += 3;
    if (desc.length > 16) score += 1;
    return score;
  }

  function mergeEvent(existing, incoming) {
    const merged = {
      ...existing,
      ...incoming,
      team: incoming.team?.name ? incoming.team : existing.team,
      score:
        incoming.score?.home != null || incoming.score?.away != null
          ? incoming.score
          : existing.score,
    };

    if (incoming.player?.name) {
      merged.player = incoming.player;
    } else if (existing.player?.name) {
      merged.player = existing.player;
    } else if (incoming.player?.id || existing.player?.id) {
      merged.player = {
        id: incoming.player?.id || existing.player?.id || null,
        name: incoming.player?.name || existing.player?.name || null,
      };
    } else {
      merged.player = incoming.player || existing.player || null;
    }

    if (eventRichness(merged) > eventRichness(existing)) {
      return merged;
    }
    return existing;
  }

  function addEvents(matchId, events) {
    const id = String(matchId);
    if (!state.eventsByMatch.has(id)) {
      state.eventsByMatch.set(id, []);
    }
    const list = state.eventsByMatch.get(id);
    const changed = [];

    for (const event of events) {
      const idx = list.findIndex((item) => item.id === event.id);
      if (idx >= 0) {
        const merged = mergeEvent(list[idx], event);
        if (merged !== list[idx]) {
          list[idx] = merged;
          changed.push(merged);
          const recentIdx = state.recentEvents.findIndex((item) => item.id === event.id);
          if (recentIdx >= 0) {
            state.recentEvents[recentIdx] = merged;
          }
        }
        continue;
      }

      state.eventIds.add(event.id);
      list.push(event);
      changed.push(event);
      state.recentEvents.unshift(event);
    }

    if (state.recentEvents.length > 500) {
      state.recentEvents.length = 500;
    }

    for (const event of changed) {
      broadcastSse(event);
    }

    return changed;
  }

  function getRecentEvents(limit = 50) {
    return state.recentEvents.slice(0, Math.max(1, Math.min(limit, 200)));
  }

  function setMeta(partial) {
    Object.assign(state.meta, partial);
  }

  function getMeta() {
    return { ...state.meta, matchCount: state.matches.size };
  }

  function addSseClient(res) {
    sseClients.add(res);
    res.on('close', () => sseClients.delete(res));
  }

  function broadcastSse(event) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  function saveSnapshot() {
    if (!snapshotPath) return;
    try {
      const dir = path.dirname(snapshotPath);
      fs.mkdirSync(dir, { recursive: true });
      const data = {
        savedAt: new Date().toISOString(),
        matches: getAllMatches(),
        eventsByMatch: Object.fromEntries(
          [...state.eventsByMatch.entries()].map(([k, v]) => [k, v])
        ),
        eventIds: [...state.eventIds],
        recentEvents: state.recentEvents.slice(0, 100),
        meta: state.meta,
      };
      fs.writeFileSync(snapshotPath, `${JSON.stringify(data, null, 2)}\n`);
    } catch (err) {
      console.warn(`Snapshot save failed: ${err.message}`);
    }
  }

  function loadSnapshot() {
    if (!snapshotPath || !fs.existsSync(snapshotPath)) return false;
    try {
      const data = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      for (const match of data.matches || []) {
        state.matches.set(String(match.id), match);
      }
      for (const [matchId, events] of Object.entries(data.eventsByMatch || {})) {
        state.eventsByMatch.set(String(matchId), events);
      }
      for (const id of data.eventIds || []) {
        state.eventIds.add(String(id));
      }
      state.recentEvents = data.recentEvents || [];
      if (data.meta) Object.assign(state.meta, data.meta);
      console.log(`Loaded snapshot: ${state.matches.size} matches`);
      return true;
    } catch (err) {
      console.warn(`Snapshot load failed: ${err.message}`);
      return false;
    }
  }

  return {
    getMatch,
    getAllMatches,
    getLiveMatches,
    upsertMatch,
    setMatchStatus,
    getMatchEvents,
    addEvents,
    getRecentEvents,
    setMeta,
    getMeta,
    addSseClient,
    saveSnapshot,
    loadSnapshot,
  };
}

module.exports = { createStore };
