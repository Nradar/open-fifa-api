const DEFAULT_BASE = 'https://api.fifa.com/api/v3';
const DEFAULT_USER_AGENT = 'open-fifa-api/1.0';
const MAX_RETRIES = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFifaClient(options = {}) {
  const baseUrl = (options.baseUrl || process.env.FIFA_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
  const userAgent = options.userAgent || DEFAULT_USER_AGENT;
  const competitionId = options.competitionId || process.env.WC_COMPETITION_ID || '17';
  const seasonId = options.seasonId || process.env.WC_SEASON_ID || '285023';
  const stageId = options.stageId || process.env.WC_STAGE_ID || '289273';

  async function request(path, query = {}, attempt = 0) {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'en-US,en',
          'User-Agent': userAgent,
        },
      });

      if (res.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(1000 * (attempt + 1));
        return request(path, query, attempt + 1);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`FIFA API ${res.status} for ${path}: ${body.slice(0, 200)}`);
      }

      return res.json();
    } catch (err) {
      if (attempt < MAX_RETRIES && (err.cause?.code === 'ECONNRESET' || err.message.includes('fetch failed'))) {
        await sleep(1000 * (attempt + 1));
        return request(path, query, attempt + 1);
      }
      throw err;
    }
  }

  async function fetchAllCalendarMatches() {
    const matches = [];
    let token = null;

    do {
      const query = {
        IdCompetition: competitionId,
        IdSeason: seasonId,
        count: 200,
      };
      if (token) query.continuationtoken = token;

      const data = await request('/calendar/matches', query);
      matches.push(...(data.Results || []));
      token = data.ContinuationToken || null;
    } while (token);

    return matches;
  }

  async function fetchLiveMatches() {
    const data = await request('/live/football/now');
    const results = data.Results || [];
    return results.filter((m) => String(m.IdSeason) === String(seasonId));
  }

  async function fetchMatchTimeline(matchId) {
    const path = `/timelines/${competitionId}/${seasonId}/${stageId}/${matchId}`;
    return request(path);
  }

  async function fetchLiveMatchDetail(matchId) {
    const path = `/live/football/${competitionId}/${seasonId}/${stageId}/${matchId}`;
    return request(path);
  }

  async function fetchAllSquads() {
    const squads = [];
    let token = null;

    do {
      const query = token ? { continuationtoken: token } : {};
      const data = await request(`/teams/squads/all/${competitionId}/${seasonId}`, query);
      squads.push(...(data.Results || []));
      token = data.ContinuationToken || null;
    } while (token);

    return squads;
  }

  return {
    competitionId,
    seasonId,
    stageId,
    fetchAllCalendarMatches,
    fetchLiveMatches,
    fetchMatchTimeline,
    fetchLiveMatchDetail,
    fetchAllSquads,
  };
}

module.exports = { createFifaClient };
