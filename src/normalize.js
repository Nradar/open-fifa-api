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

function normalizeTimelineEvent(raw, match) {
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

  const event = {
    id: String(raw.EventId),
    matchId: match?.id || String(raw.IdMatch || ''),
    matchNumber: match?.matchNumber ?? null,
    minute: raw.MatchMinute || null,
    period: PERIOD_MAP[raw.Period] || 'unknown',
    type,
    rawType: raw.Type,
    team,
    player: raw.IdPlayer
      ? { id: String(raw.IdPlayer), name: extractPlayerName(raw) }
      : null,
    playerIn: raw.IdPlayer ? { id: String(raw.IdPlayer), name: null } : null,
    playerOut: raw.IdSubPlayer ? { id: String(raw.IdSubPlayer), name: null } : null,
    score: {
      home: raw.HomeGoals ?? null,
      away: raw.AwayGoals ?? null,
    },
    description: localeText(raw.EventDescription, localeText(raw.TypeLocalized, '')),
    timestamp: raw.Timestamp || null,
  };

  if (type === 'substitution') {
    event.playerIn = raw.IdPlayer ? { id: String(raw.IdPlayer), name: null } : null;
    event.playerOut = raw.IdSubPlayer ? { id: String(raw.IdSubPlayer), name: null } : null;
    event.player = null;
  }

  return event;
}

function extractPlayerName(raw) {
  const desc = localeText(raw.EventDescription, '');
  const match = desc.match(/^([^(]+)\s*\(/);
  if (match) return match[1].trim();
  return null;
}

function filterPublicEvents(events) {
  return events.filter((e) => isPublicEvent(e.type));
}

module.exports = {
  normalizeCalendarMatch,
  normalizeLiveMatch,
  normalizeTimelineEvent,
  filterPublicEvents,
  isPublicEvent,
  PERIOD_MAP,
};
