const express = require('express');
const { createFifaClient } = require('./fifa-client');
const { createStore } = require('./store');
const { createPoller } = require('./poller');
const { createRoutes } = require('./routes');

const port = Number(process.env.PORT || 8090);

const store = createStore({
  snapshotPath: process.env.SNAPSHOT_PATH || './data/snapshot.json',
});

const fifaClient = createFifaClient();
const poller = createPoller({ fifaClient, store });

const app = express();
app.use(express.json());
app.use(createRoutes(store));

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

poller.start().catch((err) => {
  console.error(`Poller failed to start: ${err.message}`);
});

const server = app.listen(port, () => {
  console.log(`open-fifa-api listening on :${port}`);
});

function shutdown() {
  poller.stop();
  store.saveSnapshot();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
