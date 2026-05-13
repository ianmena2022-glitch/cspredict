const axios  = require('axios');
const cheerio = require('cheerio');

// Cache propio — se rellena con refreshHltvOdds() cada 30min
const hltvCache = { fixtures: [], ts: 0 };
const HLTV_TTL  = 30 * 60 * 1000;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://www.hltv.org/',
  'DNT': '1',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
};

async function fetchPage(url) {
  const res = await axios.get(url, {
    headers: HEADERS,
    timeout: 15000,
    // Seguir redirects y aceptar cookies
    maxRedirects: 5,
  });
  return res.data;
}

// Parsea la página /matches y extrae: team1, team2, odds1xbet, matchUrl
function parseMatchesPage(html) {
  const $ = cheerio.load(html);
  const results = [];

  // HLTV estructura los partidos en .upcomingMatch o .liveMatch dentro de .matchListSection
  $('.upcomingMatchesSection .upcomingMatch, .liveMatchesSection .liveMatch').each((_, el) => {
    const $el  = $(el);
    const href = $el.find('a.match').attr('href') || $el.closest('a').attr('href') || $el.attr('href') || '';
    const matchUrl = href ? `https://www.hltv.org${href}` : null;

    const teams = $el.find('.matchTeamName');
    const t1 = $(teams[0]).text().trim();
    const t2 = $(teams[1]).text().trim();
    if (!t1 || !t2 || t1 === 'TBD' || t2 === 'TBD') return;

    // Cuotas embebidas en la card (cuando están disponibles)
    const oddsEls = $el.find('.matchOdds .oddsCell, .odds .bet-odds');
    let o1 = null, o2 = null;
    if (oddsEls.length >= 2) {
      o1 = parseFloat($(oddsEls[0]).text().trim());
      o2 = parseFloat($(oddsEls[1]).text().trim());
    }

    results.push({
      team1Name: t1,
      team2Name: t2,
      matchUrl,
      odds1xbet: (!isNaN(o1) && !isNaN(o2) && o1 > 1 && o2 > 1) ? { team1: +o1.toFixed(2), team2: +o2.toFixed(2) } : null,
    });
  });

  return results;
}

// Parsea la página de un partido individual para obtener cuotas de 1xbet
function parseMatchPage(html) {
  const $ = cheerio.load(html);

  const t1 = $('.teamName').eq(0).text().trim();
  const t2 = $('.teamName').eq(1).text().trim();

  let odds1xbet = null;

  // Las cuotas aparecen en .matchOdds o .betting-row o similares
  // HLTV muestra múltiples bookmakers; buscamos "1xbet" o el primero disponible
  let found = false;
  $('.oddsContainer .bookmakerOdds, .odds-row, .betting-offer').each((_, row) => {
    if (found) return;
    const bookmaker = $(row).find('.bookmaker, .bookmakerName').text().toLowerCase();
    const oddsEls   = $(row).find('.oddsCell, .odds-value, .bet-odds');
    if (oddsEls.length < 2) return;
    const o1 = parseFloat($(oddsEls[0]).text().trim());
    const o2 = parseFloat($(oddsEls[1]).text().trim());
    if (isNaN(o1) || isNaN(o2) || o1 <= 1 || o2 <= 1) return;

    // Preferir 1xbet, sino usar el primero válido
    if (!odds1xbet || bookmaker.includes('1xbet') || bookmaker.includes('1x')) {
      odds1xbet = { team1: +o1.toFixed(2), team2: +o2.toFixed(2) };
      if (bookmaker.includes('1xbet') || bookmaker.includes('1x')) found = true;
    }
  });

  return { team1Name: t1, team2Name: t2, odds1xbet };
}

// Refresca la lista de partidos con cuotas — solo fetches /matches (1 request)
async function refreshHltvOdds() {
  try {
    const html  = await fetchPage('https://www.hltv.org/matches');
    const items = parseMatchesPage(html);
    hltvCache.fixtures = items;
    hltvCache.ts = Date.now();
    const withOdds = items.filter(i => i.odds1xbet).length;
    console.log(`[HLTV] ${items.length} partidos scrapeados, ${withOdds} con cuotas inline`);
  } catch (err) {
    console.error('[HLTV] refreshHltvOdds error:', err.message);
  }
}

// Busca en el cache por nombre de equipo
function findHltvEntry(t1Name, t2Name) {
  if (!hltvCache.fixtures.length) return null;
  const n1 = t1Name.toLowerCase();
  const n2 = t2Name.toLowerCase();
  return hltvCache.fixtures.find(e => {
    const e1 = e.team1Name?.toLowerCase() || '';
    const e2 = e.team2Name?.toLowerCase() || '';
    return (e1.includes(n1) || n1.includes(e1)) && (e2.includes(n2) || n2.includes(e2)) ||
           (e1.includes(n2) || n2.includes(e1)) && (e2.includes(n1) || n1.includes(e2));
  });
}

// Fetch on-demand de cuotas para un partido específico (desde su página)
async function fetchHltvMatchOdds(t1Name, t2Name) {
  // Primero intentar con datos inline del cache
  const cached = findHltvEntry(t1Name, t2Name);
  if (cached?.odds1xbet) return { ...cached.odds1xbet, source: '1xbet (HLTV)', matchUrl: cached.matchUrl };

  // Si hay matchUrl, ir a la página del partido
  if (cached?.matchUrl) {
    try {
      const html   = await fetchPage(cached.matchUrl);
      const parsed = parseMatchPage(html);
      if (parsed.odds1xbet) return { ...parsed.odds1xbet, source: '1xbet (HLTV)', matchUrl: cached.matchUrl };
    } catch (err) {
      console.error('[HLTV] fetchMatchOdds page error:', err.message);
    }
  }

  return null;
}

module.exports = { refreshHltvOdds, findHltvEntry, fetchHltvMatchOdds, hltvCache, HLTV_TTL };
