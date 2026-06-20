function localeText(items, fallback = '') {
  if (!Array.isArray(items) || !items.length) return fallback;
  const en = items.find((i) => i.Locale?.startsWith('en'));
  return (en || items[0]).Description || fallback;
}

function normalizeMinute(minute) {
  return String(minute || '')
    .replace(/\s+/g, '')
    .replace(/'+$/g, "'")
    .toLowerCase();
}

function createPlayerLookup(fifaClient) {
  const byId = new Map();
  let squadLoaded = false;
  let squadLoading = null;

  async function loadSquads() {
    if (squadLoaded) return;
    if (squadLoading) {
      await squadLoading;
      return;
    }
    squadLoading = (async () => {
      const data = await fifaClient.fetchAllSquads();
      for (const team of data || []) {
        for (const player of team.Players || []) {
          const id = String(player.IdPlayer || '');
          const name = localeText(player.PlayerName, localeText(player.ShortName, ''));
          if (id && name) byId.set(id, name.trim());
        }
      }
      squadLoaded = true;
      console.log(`Player lookup: ${byId.size} names from squads`);
    })();
    try {
      await squadLoading;
    } finally {
      squadLoading = null;
    }
  }

  function ingestLineup(detail) {
    const goals = [];
    for (const side of ['HomeTeam', 'AwayTeam']) {
      const team = detail?.[side];
      if (!team) continue;
      for (const player of team.Players || []) {
        const id = String(player.IdPlayer || '');
        const name = localeText(player.PlayerName, localeText(player.ShortName, ''));
        if (id && name) byId.set(id, name.trim());
      }
      for (const goal of team.Goals || []) {
        goals.push({
          ...goal,
          teamId: String(goal.IdTeam || team.IdTeam || team.TeamId || ''),
        });
      }
    }
    return { goals };
  }

  function getName(idPlayer) {
    if (!idPlayer) return null;
    return byId.get(String(idPlayer)) || null;
  }

  function findGoalScorer(event, lineupGoals = []) {
    if (!lineupGoals.length) return null;

    const minute = normalizeMinute(event.minute);
    const teamId = String(event.team?.id || '');

    for (const goal of lineupGoals) {
      if (teamId && String(goal.teamId || goal.IdTeam || '') !== teamId) continue;
      if (minute && normalizeMinute(goal.Minute) !== minute) continue;
      if (goal.IdPlayer) return String(goal.IdPlayer);
    }
    return null;
  }

  return {
    loadSquads,
    ingestLineup,
    getName,
    findGoalScorer,
  };
}

module.exports = { createPlayerLookup, localeText };
