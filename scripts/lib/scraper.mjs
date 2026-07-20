import { config } from './config.mjs';

// Scraping y mapeo van por Jina Reader (r.jina.ai): gratis, sin key para uso básico
// (JINA_API_KEY opcional sube límites), renderiza JS y no tiene el rate-limit agresivo
// de Firecrawl. La búsqueda sigue en Firecrawl, que ahí no daba problemas.

function jinaHeaders(extra = {}) {
  const headers = { ...extra };
  if (config.jina?.apiKey) headers.Authorization = `Bearer ${config.jina.apiKey}`;
  return headers;
}

/**
 * Scrapes a URL to markdown. Jina Reader first (free, no aggressive rate limit);
 * if it fails, Firecrawl as fallback — it resolves Google News redirect URLs
 * (news.google.com/rss/articles/...) that Jina returns 403 for.
 */
export async function scrapeUrl(url) {
  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers: jinaHeaders(),
      signal: AbortSignal.timeout(45_000),
    });
    if (response.ok) {
      const text = (await response.text()).trim();
      if (text) return text;
    }
  } catch (error) {
    console.warn(`[jina] Error al raspar ${url}: ${error.message}`);
  }
  return firecrawlScrape(url);
}

async function firecrawlScrape(url) {
  if (!config.firecrawl.apiKey) return null;
  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.firecrawl.apiKey}`,
      },
      body: JSON.stringify({ url, formats: ['markdown'] }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      console.warn(`[firecrawl] Fallo al raspar ${url}: HTTP ${response.status}`);
      return null;
    }
    const json = await response.json();
    return json?.data?.markdown || null;
  } catch (error) {
    console.warn(`[firecrawl] Error al raspar ${url}: ${error.message}`);
    return null;
  }
}

/** Same-origin URLs found on a site (project pages aren't usually on the homepage), or []. */
export async function mapSite(url) {
  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers: jinaHeaders({ 'X-With-Links-Summary': 'true' }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      console.warn(`[jina] Fallo al mapear ${url}: HTTP ${response.status}`);
      return [];
    }
    const text = await response.text();
    const origin = new URL(url).origin;
    const found = text.match(/https?:\/\/[^\s)\]"']+/g) || [];
    return [...new Set(found.filter((u) => u.startsWith(origin)))];
  } catch (error) {
    console.warn(`[jina] Error al mapear ${url}: ${error.message}`);
    return [];
  }
}

/** Web search for a company's real pages (Firecrawl), or []. */
export async function searchWeb(query, limit = 3) {
  if (!config.firecrawl.apiKey) return [];
  try {
    const response = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.firecrawl.apiKey}`,
      },
      body: JSON.stringify({ query, limit }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      console.warn(`[firecrawl] Fallo al buscar "${query}": HTTP ${response.status}`);
      return [];
    }
    const json = await response.json();
    return (json.data || []).map((r) => ({ url: r.url, title: r.title }));
  } catch (error) {
    console.warn(`[firecrawl] Error al buscar "${query}": ${error.message}`);
    return [];
  }
}
