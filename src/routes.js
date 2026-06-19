const express = require('express');

function createRoutes(store) {
  const router = express.Router();

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

  router.get('/api/matches/:matchId', (req, res) => {
    const match = store.getMatch(req.params.matchId);
    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }
    res.json({
      match,
      events: store.getMatchEvents(match.id),
    });
  });

  router.get('/api/matches/:matchId/events', (req, res) => {
    const match = store.getMatch(req.params.matchId);
    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }
    res.json({
      matchId: match.id,
      matchNumber: match.matchNumber,
      count: store.getMatchEvents(match.id).length,
      events: store.getMatchEvents(match.id),
    });
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

module.exports = { createRoutes };
