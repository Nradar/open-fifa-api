const {
  normalizeCalendarMatch,
  normalizeLiveMatch,
  normalizeTimelineEvent,
  filterPublicEvents,
  reconcileGoalEvents,
} = require('./normalize');

const FINISH_GRACE_POLLS = 2;
const WINDOW_BEFORE_MS = 30 * 60 * 1000;
const WINDOW_AFTER_MS = 15 * 60 * 1000;

function createPoller({ fifaClient, store, playerLookup, options = {} }) {
  const pollLiveMs = Number(options.pollLiveMs || process.env.POLL_LIVE_MS || 15000);
  const pollIdleMs = Number(options.pollIdleMs || process.env.POLL_IDLE_MS || 300000);
  const snapshotEvery = Number(options.snapshotEvery || 10);

  let timer = null;
  let running = false;
  let pollCount = 0;
  const finishPolls = new Map();

  function isInMatchWindow(match) {
    if (!match?.datetime) return false;
    const kickoff = new Date(match.datetime).getTime();
    const now = Date.now();
    return now >= kickoff - WINDOW_BEFORE_MS && now <= kickoff + 3 * 60 * 60 * 1000 + WINDOW_AFTER_MS;
  }

  function hasUpcomingWindow() {
    return store.getAllMatches().some((m) => isInMatchWindow(m) && m.status !== 'finished');
  }

  async function syncSchedule() {
    const raw = await fifaClient.fetchAllCalendarMatches();
    for (const item of raw) {
      store.upsertMatch(normalizeCalendarMatch(item));
    }
    store.setMeta({ lastScheduleSyncAt: new Date().toISOString() });
    console.log(`Schedule synced: ${raw.length} matches`);
  }

  async function ingestTimeline(matchId) {
    const match = store.getMatch(matchId);
    if (!match) return [];

    let lineupGoals = [];
    if (playerLookup && (match.status === 'live' || store.getLiveMatches().some((m) => m.id === match.id))) {
      try {
        const detail = await fifaClient.fetchLiveMatchDetail(matchId);
        lineupGoals = playerLookup.ingestLineup(detail).goals;
      } catch (err) {
        console.warn(`Lineup fetch failed for ${matchId}: ${err.message}`);
      }
    }

    const timeline = await fifaClient.fetchMatchTimeline(matchId);
    const rawEvents = timeline.Event || [];
    const ctx = { playerLookup, lineupGoals };
    const normalized = rawEvents.map((e) => normalizeTimelineEvent(e, match, ctx));
    const publicEvents = filterPublicEvents(normalized);
    const reconciled = reconcileGoalEvents(publicEvents, match);
    store.setMatchEvents(matchId, reconciled);

    const last = normalized[normalized.length - 1];
    if (last?.type === 'period' && last.description?.toLowerCase().includes('final whistle')) {
      store.setMatchStatus(matchId, 'finished', {
        matchTime: last.minute,
        score: last.score,
      });
    }

    return reconciled;
  }

  async function pollLiveNow() {
    const liveRaw = await fifaClient.fetchLiveMatches();
    const liveIds = new Set();

    for (const raw of liveRaw) {
      const match = normalizeLiveMatch(raw);
      liveIds.add(match.id);
      store.upsertMatch(match);
      finishPolls.delete(match.id);
      await ingestTimeline(match.id);
    }

    for (const match of store.getAllMatches()) {
      if (match.status === 'live' && !liveIds.has(match.id)) {
        const count = (finishPolls.get(match.id) || 0) + 1;
        finishPolls.set(match.id, count);
        await ingestTimeline(match.id);
        if (count >= FINISH_GRACE_POLLS) {
          store.setMatchStatus(match.id, 'finished');
          finishPolls.delete(match.id);
        }
      }
    }

    store.setMeta({ liveCount: store.getLiveMatches().length });
    return liveIds.size;
  }

  async function pollTick() {
    if (running) return;
    running = true;
    pollCount += 1;

    try {
      const liveCount = await pollLiveNow();
      store.setMeta({ lastPollAt: new Date().toISOString(), lastError: null });

      if (pollCount % snapshotEvery === 0) {
        store.saveSnapshot();
      }

      scheduleNext(liveCount > 0 || hasUpcomingWindow());
    } catch (err) {
      console.warn(`Poll error: ${err.message}`);
      store.setMeta({ lastError: err.message, lastPollAt: new Date().toISOString() });
      scheduleNext(true);
    } finally {
      running = false;
    }
  }

  function scheduleNext(active) {
    if (timer) clearTimeout(timer);
    const delay = active ? pollLiveMs : pollIdleMs;
    timer = setTimeout(() => pollTick(), delay);
  }

  async function start() {
    store.loadSnapshot();
    if (playerLookup) {
      try {
        await playerLookup.loadSquads();
      } catch (err) {
        console.warn(`Squad preload failed: ${err.message}`);
      }
    }
    try {
      await syncSchedule();
    } catch (err) {
      console.warn(`Initial schedule sync failed: ${err.message}`);
      store.setMeta({ lastError: err.message });
    }
    await pollTick();
    console.log(`Poller started (live=${pollLiveMs}ms idle=${pollIdleMs}ms)`);
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return { start, stop, syncSchedule, pollTick, ingestTimeline };
}

module.exports = { createPoller };
