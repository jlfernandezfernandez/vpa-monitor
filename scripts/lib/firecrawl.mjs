import { config } from './config.mjs';

/**
 * POST a Firecrawl endpoint, returning parsed JSON or null on any failure/missing key.
 *
 * @param {string} endpoint - Endpoint name (e.g. 'scrape')
 * @param {Object} body - Request body
 * @param {string} label - What we're doing, for the warning log
 * @returns {Promise<Object|null>}
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function firecrawlPost(endpoint, body, label) {
  if (!config.firecrawl.apiKey) return null;
  // Un reintento con espera ante 429: el plan free se satura al mapear/raspar varios
  // sitios seguidos y perdíamos catálogos enteros de gestoras por rate-limit transitorio.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`https://api.firecrawl.dev/v1/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.firecrawl.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 429 && attempt === 0) {
        await sleep(6_000);
        continue;
      }
      if (!response.ok) {
        console.warn(`[firecrawl] Fallo al ${label}: HTTP ${response.status}`);
        return null;
      }
      return await response.json();
    } catch (error) {
      console.warn(`[firecrawl] Error al ${label}: ${error.message}`);
      return null;
    }
  }
  return null;
}

/** Scrapes a URL to clean markdown, or null. */
export async function scrapeUrl(url) {
  const json = await firecrawlPost('scrape', { url, formats: ['markdown'] }, `raspar ${url}`);
  return json?.data?.markdown || null;
}

/** Web search for a company's real pages (to ground data in a real scrape), or []. */
export async function searchWeb(query, limit = 3) {
  const json = await firecrawlPost('search', { query, limit }, `buscar "${query}"`);
  return (json?.data || []).map((r) => ({ url: r.url, title: r.title }));
}

/** Maps a site's URLs (project pages aren't usually on the homepage), or []. */
export async function mapSite(url) {
  const json = await firecrawlPost('map', { url }, `mapear ${url}`);
  return json?.links || [];
}
