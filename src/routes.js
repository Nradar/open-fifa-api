const express = require('express');
const { reconcileGoalEvents, normalizeMatchLineup } = require('./normalize');

function createRoutes(store, { ensureTimeline, fifaClient } = {}) {
  const router = express.Router();

  async function loadMatchEvents(match, req) {
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    if (ensureTimeline && (force || !store.getMatchEvents(match.id).length)) {
      await ensureTimeline(match.id, { force });
      if (store.getMatchEvents(match.id).length) {
        store.saveSnapshot();
      }
    }
    const events = store.getMatchEvents(match.id);
    return reconcileGoalEvents(events, match);
  }

  router.get('/health', (_req, res) => {
    const meta = store.getMeta();
    res.json({
      ok: true,
      ...meta,
      uptimeSec: Math.floor((Date.now() - new Date(meta.startedAt).getTime()) / 1000),
    });
  });

  router.get('/api/matches', (_req, res) => {
    res.json({
      updatedAt: store.getMeta().lastPollAt,
      count: store.getAllMatches().length,
      matches: store.getAllMatches(),
    });
  });

  router.get('/api/live', (_req, res) => {
    const live = store.getLiveMatches();
    res.json({
      updatedAt: store.getMeta().lastPollAt,
      count: live.length,
      matches: live.map((m) => ({
        ...m,
        recentEvents: store.getMatchEvents(m.id).slice(-5),
      })),
    });
  });

  router.get('/api/matches/:matchId', async (req, res) => {
    const match = store.getMatch(req.params.matchId);
    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }
    try {
      const events = await loadMatchEvents(match, req);
      res.json({ match, events });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  router.get('/api/matches/:matchId/events', async (req, res) => {
    const match = store.getMatch(req.params.matchId);
    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }
    try {
      const events = await loadMatchEvents(match, req);
      const summary = summarizeEvents(events);
      res.json({
        matchId: match.id,
        matchNumber: match.matchNumber,
        home: match.home?.name,
        away: match.away?.name,
        count: events.length,
        summary,
        events,
      });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  router.get('/api/matches/:matchId/lineup', async (req, res) => {
    const match = store.getMatch(req.params.matchId);
    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    let lineup = force ? null : store.getMatchLineup(match.id);

    if (!lineup && fifaClient) {
      try {
        const detail = await fifaClient.fetchLiveMatchDetail(match.id);
        lineup = normalizeMatchLineup(detail, match);
        if (lineup) store.setMatchLineup(match.id, lineup);
      } catch (err) {
        if (!lineup) {
          res.status(502).json({ error: err.message });
          return;
        }
      }
    }

    if (!lineup) {
      res.status(404).json({ error: 'Lineup not available yet' });
      return;
    }

    res.json(lineup);
  });

  router.get('/api/events/recent', (req, res) => {
    const limit = Number(req.query.limit || 50);
    res.json({
      updatedAt: store.getMeta().lastPollAt,
      events: store.getRecentEvents(limit),
    });
  });

  router.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`data: ${JSON.stringify({ type: 'connected', at: new Date().toISOString() })}\n\n`);
    store.addSseClient(res);

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 25000);

    req.on('close', () => clearInterval(heartbeat));
  });

  return router;
}

function summarizeEvents(events) {
  const counts = {
    goal: 0,
    yellow_card: 0,
    red_card: 0,
    second_yellow: 0,
    substitution: 0,
    var: 0,
  };
  const byTeam = {};

  for (const event of events) {
    if (counts[event.type] !== undefined) {
      counts[event.type] += 1;
    }
    if (!event.team?.name) continue;
    if (!byTeam[event.team.name]) {
      byTeam[event.team.name] = {
        goal: 0,
        penalty_goal: 0,
        own_goal: 0,
        yellow_card: 0,
        red_card: 0,
        second_yellow: 0,
        substitution: 0,
        var: 0,
      };
    }
    const bucket = byTeam[event.team.name];
    if (bucket[event.type] !== undefined) {
      bucket[event.type] += 1;
    }
  }

  return {
    ...counts,
    yellow_cards: counts.yellow_card + counts.second_yellow,
    red_cards: counts.red_card + counts.second_yellow,
    byTeam,
  };
}

module.exports = { createRoutes };
