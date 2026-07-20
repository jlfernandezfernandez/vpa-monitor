import Parser from 'rss-parser';
import iconv from 'iconv-lite';
import { writeFile } from 'node:fs/promises';
import { config, AREA_LABELS } from './lib/config.mjs';
import {
  isActionableMarketAlert,
  toOpportunity,
} from './lib/monitor.mjs';
import { extractHousingData } from './lib/llm.mjs';
import { scrapeUrl } from './lib/firecrawl.mjs';
import {
  getDatabase,
  saveOpportunity,
  getOpportunity,
  getAllOpportunities,
  saveSource,
  getAllSources,
  getAllGestoras,
} from './lib/db.mjs';

const parser = new Parser({ customFields: { item: ['description'] } });
const dataPath = config.paths.dataJson;
const feeds = config.feeds;

function parseIgvsListing(html, sourceUrl) {
  const links = html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  const items = new Map();

  for (const [, href, rawTitle] of links) {
    if (!href.includes('/adjudicaciones-sorteos-de-vivienda-protegida/')) continue;
    const title = rawTitle.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const date = title.match(/^(\d{2}\/\d{2}\/\d{4})/u)?.[1];
    if (!date) continue;
    const itemTitle = title.replace(/^\d{2}\/\d{2}\/\d{4}\s*/u, '');
    const link = new URL(href, sourceUrl).toString();
    items.set(link, { title: itemTitle, link, pubDate: date });
  }

  return [...items.values()];
}

async function parseFeed(feed) {
  const response = await fetch(feed.url, {
    headers: { Accept: feed.format === 'html' ? 'text/html' : 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  if (feed.format === 'html') return parseIgvsListing(await response.text(), feed.url);

  const buffer = Buffer.from(await response.arrayBuffer());
  let xml = buffer.toString('utf8');
  if (xml.includes('\uFFFD') || xml.includes('Ã')) xml = iconv.decode(buffer, 'latin1');
  const parsed = await parser.parseString(xml);
  return parsed.items || [];
}

async function main() {
  const checkedAt = new Date().toISOString();
  const db = getDatabase();
  
  const results = await Promise.allSettled(feeds.map(parseFeed));
  const sources = [];
  const candidates = [];

  results.forEach((result, index) => {
    const feed = feeds[index];
    if (result.status === 'fulfilled') {
      const relevant = result.value
        .map((item) => toOpportunity(item, feed.name, checkedAt))
        .filter(Boolean)
        .map((item) => ({ ...item, sourceKind: feed.kind || 'official' }))
        .filter((item) => feed.kind !== 'market-alert' || isActionableMarketAlert(item, new Date(checkedAt)));
      candidates.push(...relevant);
      
      const source = { name: feed.name, url: feed.url, kind: feed.kind || 'official', ok: true, scanned: result.value.length };
      sources.push(source);
      saveSource(db, source);
      console.log(`✓ ${feed.name}: ${result.value.length} revisados, ${relevant.length} relevantes`);
      return;
    }

    const source = { name: feed.name, url: feed.url, kind: feed.kind || 'official', ok: false, scanned: 0 };
    sources.push(source);
    saveSource(db, source);
    console.error(`✗ ${feed.name}: ${result.reason?.message || 'error desconocido'}`);
  });

  if (!sources.some((source) => source.ok)) {
    throw new Error('No se pudo consultar ninguna fuente; se conservan los datos anteriores');
  }

  // Enriquecer e insertar ítems directamente en SQLite
  console.log('\n[IA/SQLite] Procesando novedades y enriqueciendo con LLM...');
  for (const item of candidates) {
    const old = getOpportunity(db, item.id);
    
    if (old && (old.precioMin !== null || old.promotora !== null)) {
      // Conservar datos ya procesados para no repetir llamadas a la API
      saveOpportunity(db, {
        ...item,
        precioMin: old.precioMin,
        precioMax: old.precioMax,
        habitacionesMin: old.habitacionesMin,
        banosMin: old.banosMin,
        promotora: old.promotora,
        totalViviendas: old.totalViviendas,
        garaje: old.garaje,
        trastero: old.trastero,
        terraza: old.terraza,
      });
    } else {
      let contentToAnalyze = item.summary || '';

      if (item.sourceKind === 'market-alert' && item.url) {
        console.log(`  [Firecrawl] Raspando artículo completo: "${item.title.slice(0, 45)}..."`);
        const fullMarkdown = await scrapeUrl(item.url);
        if (fullMarkdown) {
          contentToAnalyze = fullMarkdown.slice(0, 10000); // limit to ~2500 words to conserve tokens
          console.log(`  [Firecrawl] Éxito. Artículo obtenido (${contentToAnalyze.length} caracteres).`);
        } else {
          console.log(`  [Firecrawl] Inactivo o fallido. Usando snippet de prensa.`);
        }
      }

      // Llamar al extractor estructurado
      const llmData = await extractHousingData(item.title, contentToAnalyze);
      
      const enrichedItem = {
        ...item,
        precioMin: llmData.precioMin,
        precioMax: llmData.precioMax,
        habitacionesMin: llmData.habitacionesMin,
        banosMin: llmData.banosMin,
        promotora: llmData.promotora,
        totalViviendas: llmData.totalViviendas,
        garaje: llmData.garaje,
        trastero: llmData.trastero,
        terraza: llmData.terraza,
      };

      saveOpportunity(db, enrichedItem);
      
      if (enrichedItem.precioMin || enrichedItem.promotora || enrichedItem.habitacionesMin) {
        console.log(`  [IA Extraído] ${enrichedItem.title.slice(0, 40)}... -> Promotora: ${enrichedItem.promotora || '?'}, Min €: ${enrichedItem.precioMin || '?'}`);
      }
    }
  }

  // Cargar las oportunidades más recientes, las fuentes y las gestoras desde SQLite para exportar al JSON estático
  const items = getAllOpportunities(db, 150);
  const dbSources = getAllSources(db);
  const dbGestoras = getAllGestoras(db);

  const monitor = { checkedAt, area: AREA_LABELS, sources: dbSources, items, gestoras: dbGestoras };
  await writeFile(dataPath, `${JSON.stringify(monitor, null, 2)}\n`);
  console.log(`\n${items.length} oportunidades guardadas en SQLite y exportadas al JSON estático.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
