const FIFA_EVENT_TYPES = {
  0: 'goal',
  34: 'own_goal',
  39: 'goal',
  41: 'penalty_goal',
  2: 'yellow_card',
  3: 'red_card',
  4: 'second_yellow',
  5: 'substitution',
  71: 'var',
  72: 'var',
  7: 'period',
  8: 'period',
  26: 'period',
};

const PERIOD_MAP = {
  0: 'not_started',
  2: 'pre_match',
  3: 'first_half',
  4: 'half_time',
  5: 'second_half',
  7: 'extra_first',
  9: 'extra_second',
  10: 'full_time',
  11: 'shootout',
};

const PUBLIC_EVENT_TYPES = new Set([
  'goal',
  'own_goal',
  'penalty_goal',
  'yellow_card',
  'red_card',
  'second_yellow',
  'substitution',
  'var',
  'period',
]);

function localeText(items, fallback = '') {
  if (!Array.isArray(items) || !items.length) return fallback;
  const en = items.find((i) => i.Locale?.startsWith('en'));
  return (en || items[0]).Description || fallback;
}

function teamNameFromSide(side) {
  if (!side) return { name: 'TBD', code: 'TBD', id: null };
  return {
    id: side.IdTeam || side.Id || null,
    name: localeText(side.TeamName || side.Name, side.ShortClubName || side.Abbreviation || 'TBD'),
    code: side.Abbreviation || side.ShortClubName || 'TBD',
  };
}

function groupLetter(groupName) {
  const text = localeText(groupName, '');
  const match = text.match(/Group\s+([A-L])/i);
  return match ? match[1].toUpperCase() : '';
}

function mapFifaEventType(type) {
  return FIFA_EVENT_TYPES[type] || 'other';
}

function isPublicEvent(type) {
  return PUBLIC_EVENT_TYPES.has(type);
}

function normalizeCalendarMatch(raw) {
  const home = teamNameFromSide(raw.Home);
  const away = teamNameFromSide(raw.Away);
  const status = inferMatchStatus(raw);

  return {
    id: String(raw.IdMatch),
    matchNumber: raw.MatchNumber || null,
    competitionId: String(raw.IdCompetition),
    seasonId: String(raw.IdSeason),
    stageId: String(raw.IdStage),
    group: groupLetter(raw.GroupName),
    stage: localeText(raw.StageName, ''),
    datetime: raw.Date || null,
    localDatetime: raw.LocalDate || null,
    venue: localeText(raw.Stadium?.Name, ''),
    city: localeText(raw.Stadium?.CityName, ''),
    home,
    away,
    score: {
      home: raw.HomeTeamScore ?? raw.Home?.Score ?? null,
      away: raw.AwayTeamScore ?? raw.Away?.Score ?? null,
    },
    matchTime: raw.MatchTime || null,
    status,
    winnerId: raw.Winner || null,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeLiveMatch(raw) {
  const base = normalizeCalendarMatch({
    ...raw,
    Home: raw.HomeTeam || raw.Home,
    Away: raw.AwayTeam || raw.Away,
    HomeTeamScore: raw.HomeTeam?.Score ?? raw.Home?.Score,
    AwayTeamScore: raw.AwayTeam?.Score ?? raw.Away?.Score,
    Stadium: raw.Stadium,
    GroupName: raw.GroupName,
    StageName: raw.StageName,
    MatchNumber: raw.MatchNumber,
    IdMatch: raw.MatchId || raw.IdMatch,
    IdCompetition: raw.CompetitionId || raw.IdCompetition,
    IdSeason: raw.SeasonId || raw.IdSeason,
    IdStage: raw.StageId || raw.IdStage,
    Date: raw.Date,
    LocalDate: raw.LocalDate,
    MatchTime: raw.MatchTime,
    Winner: raw.Winner,
    Period: raw.Period,
    MatchStatus: raw.MatchStatus,
  });

  return {
    ...base,
    status: 'live',
    period: PERIOD_MAP[raw.Period] || 'unknown',
    matchTime: raw.MatchTime || base.matchTime,
  };
}

function inferMatchStatus(raw) {
  if (raw.Period === 10) {
    return 'finished';
  }
  if ([3, 5, 7, 9, 11].includes(raw.Period)) {
    return 'live';
  }

  const kickoff = raw.Date ? new Date(raw.Date).getTime() : null;
  const now = Date.now();

  if (raw.Winner && kickoff && now > kickoff + 2 * 60 * 60 * 1000) {
    return 'finished';
  }
  if (raw.Winner && raw.MatchStatus === 0 && raw.MatchTime) {
    return 'finished';
  }
  if (kickoff && kickoff > now) {
    return 'scheduled';
  }
  if (raw.MatchTime && raw.Period !== 0 && raw.Period !== undefined) {
    return 'live';
  }
  if (raw.Winner) {
    return 'finished';
  }
  return 'scheduled';
}

function normalizeTimelineEvent(raw, match, ctx = {}) {
  const type = mapFifaEventType(raw.Type);
  const teamId = raw.IdTeam || null;
  const team =
    teamId && match
      ? teamId === match.home?.id
        ? match.home
        : teamId === match.away?.id
          ? match.away
          : { id: teamId, name: null, code: null }
      : null;

  const description = localeText(raw.EventDescription, localeText(raw.TypeLocalized, ''));

  const event = {
    id: String(raw.EventId),
    matchId: match?.id || String(raw.IdMatch || ''),
    matchNumber: match?.matchNumber ?? null,
    minute: raw.MatchMinute || null,
    period: PERIOD_MAP[raw.Period] || 'unknown',
    type,
    rawType: raw.Type,
    team,
    player: resolvePlayer(raw, ctx),
    playerIn: null,
    playerOut: raw.IdSubPlayer ? { id: String(raw.IdSubPlayer), name: null } : null,
    score: {
      home: raw.HomeGoals ?? null,
      away: raw.AwayGoals ?? null,
    },
    description,
    timestamp: raw.Timestamp || null,
  };

  if (type === 'substitution') {
    const subNames = extractSubstitutionNames(raw);
    event.playerIn = raw.IdPlayer
      ? { id: String(raw.IdPlayer), name: subNames.playerIn }
      : null;
    event.playerOut = raw.IdSubPlayer
      ? { id: String(raw.IdSubPlayer), name: subNames.playerOut }
      : null;
    event.player = null;
  }

  return enrichGoalPlayer(event, ctx);
}

function extractPlayerName(raw) {
  const desc = localeText(raw.EventDescription, '');
  const paren = desc.match(/^([^(]+)\s*\(/);
  if (paren) return paren[1].trim();
  const booked = desc.match(/^(.+?)\s*\([^)]+\)\s+is booked/i);
  if (booked) return booked[1].trim();
  const ownGoal = desc.match(/^(.+?)\s*\([^)]+\)\s+scores an own goal/i);
  if (ownGoal) return ownGoal[1].trim();
  const scores = desc.match(/^(.+?)\s*\([^)]+\)\s+scores?!+/i);
  if (scores) return scores[1].trim();
  return null;
}

function resolvePlayer(raw, ctx = {}) {
  const lookup = ctx.playerLookup;
  let name = extractPlayerName(raw);
  const id = raw.IdPlayer ? String(raw.IdPlayer) : null;

  if (id && !name && lookup) {
    name = lookup.getName(id);
  }

  if (id) {
    return { id, name: name || null };
  }
  return null;
}

function enrichGoalPlayer(event, ctx = {}) {
  if (!['goal', 'penalty_goal', 'own_goal'].includes(event.type)) return event;
  if (event.player?.name) return event;

  const lookup = ctx.playerLookup;
  if (!lookup) return event;

  let id = event.player?.id || null;
  let name = event.player?.name || null;

  if (!id) {
    id = lookup.findGoalScorer(event, ctx.lineupGoals || []);
  }

  if (id && !name) {
    name = lookup.getName(id);
  }

  if (!id && !name) return event;

  return {
    ...event,
    player: {
      id: id || event.player?.id || null,
      name: name || event.player?.name || null,
    },
  };
}

function extractSubstitutionNames(raw) {
  const desc = localeText(raw.EventDescription, '');
  const bench = desc.match(
    /^(?:Before the second half begins\s+)?(.+?)\s*\(in\)\s*comes off the bench to replace\s+(.+?)\s*\(out\)/i
  );
  if (bench) {
    return { playerIn: bench[1].trim(), playerOut: bench[2].trim() };
  }
  const tagged = desc.match(
    /^(?:Before the second half begins\s+)?(.+?)\s*\(in\)\s*replace(?:s)?\s+(.+?)\s*\(out\)/i
  );
  if (tagged) {
    return { playerIn: tagged[1].trim(), playerOut: tagged[2].trim() };
  }
  return { playerIn: null, playerOut: null };
}

function filterPublicEvents(events) {
  return events.filter((e) => isPublicEvent(e.type));
}

const GOAL_EVENT_TYPES = new Set(['goal', 'penalty_goal', 'own_goal']);

function parseMinuteSortKey(minute) {
  if (!minute) return 0;
  const match = String(minute).replace(/\+/g, '.').match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

function eventSortKey(event) {
  const ts = event?.timestamp ? Date.parse(event.timestamp) : NaN;
  if (Number.isFinite(ts)) return ts;
  return parseMinuteSortKey(event?.minute);
}

function goalCredits(goal, match) {
  const teamId = goal.team?.id != null ? String(goal.team.id) : '';
  const homeId = match?.home?.id != null ? String(match.home.id) : '';
  const awayId = match?.away?.id != null ? String(match.away.id) : '';
  if (!teamId || (!homeId && !awayId)) return null;

  if (goal.type === 'own_goal') {
    if (teamId === homeId) return { home: 0, away: 1 };
    if (teamId === awayId) return { home: 1, away: 0 };
    return null;
  }

  if (teamId === homeId) return { home: 1, away: 0 };
  if (teamId === awayId) return { home: 0, away: 1 };
  return null;
}

function reconcileGoalEvents(events, match) {
  const list = events || [];
  const homeTarget = match?.score?.home;
  const awayTarget = match?.score?.away;
  if (homeTarget == null || awayTarget == null) return list;

  const goals = list
    .filter((event) => GOAL_EVENT_TYPES.has(event.type))
    .slice()
    .sort((a, b) => eventSortKey(a) - eventSortKey(b));

  if (!goals.length) return list;

  let homeCount = 0;
  let awayCount = 0;
  const keepGoalIds = new Set();

  for (const goal of goals) {
    const credit = goalCredits(goal, match);
    if (!credit) continue;

    const nextHome = homeCount + credit.home;
    const nextAway = awayCount + credit.away;
    if (nextHome > homeTarget || nextAway > awayTarget) continue;

    homeCount = nextHome;
    awayCount = nextAway;
    keepGoalIds.add(goal.id);
  }

  if (homeCount !== homeTarget || awayCount !== awayTarget) {
    return list;
  }

  return list.filter((event) => !GOAL_EVENT_TYPES.has(event.type) || keepGoalIds.has(event.id));
}

module.exports = {
  normalizeCalendarMatch,
  normalizeLiveMatch,
  normalizeTimelineEvent,
  filterPublicEvents,
  isPublicEvent,
  enrichGoalPlayer,
  reconcileGoalEvents,
  PERIOD_MAP,
};
