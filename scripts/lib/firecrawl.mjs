import { config } from './config.mjs';

/**
 * Uses Firecrawl API to scrape a URL and extract its clean markdown content.
 * Handles rate limits and network issues gracefully by returning null.
 * 
 * @param {string} url - The web page URL to scrape
 * @returns {Promise<string|null>} Scraped markdown content, or null on failure/missing key
 */
export async function scrapeUrl(url) {
  if (!config.firecrawl.apiKey) {
    return null;
  }

  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.firecrawl.apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
      }),
      signal: AbortSignal.timeout(30_000), // 30 seconds timeout
    });

    if (!response.ok) {
      console.warn(`[firecrawl] Fallo al raspar ${url}: HTTP ${response.status}`);
      return null;
    }

    const json = await response.json();
    if (json.success && json.data && json.data.markdown) {
      return json.data.markdown;
    }
    
    return null;
  } catch (error) {
    console.warn(`[firecrawl] Error en llamada a Firecrawl para ${url}: ${error.message}`);
    return null;
  }
}
