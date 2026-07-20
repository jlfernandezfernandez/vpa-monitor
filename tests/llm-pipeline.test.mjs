import test from 'node:test';
import assert from 'node:assert/strict';
import { extractHousingData, pickOfficialWebsite, extractGestoraContactFromText, extractPromotionsFromText } from '../scripts/lib/llm.mjs';
import { searchWeb, scrapeUrl } from '../scripts/lib/scraper.mjs';

function mockOpenAiResponse(payload) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function withMockedFetch(mockFn, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFn;
  return run().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

test('extractHousingData devuelve estado y nombrePromocion sin llamar a la red real', async () => {
  await withMockedFetch(
    async () => mockOpenAiResponse({
      precioMin: 300000, precioMax: null, habitacionesMin: 3, banosMin: null,
      promotora: 'Nozar', totalViviendas: 66, garaje: true, trastero: true, terraza: true,
      estado: 'Últimas unidades', nombrePromocion: 'Edificio Montevideo',
    }),
    async () => {
      const data = await extractHousingData('Título de prueba', 'Resumen de prueba');
      assert.equal(data.estado, 'Últimas unidades');
      assert.equal(data.nombrePromocion, 'Edificio Montevideo');
      assert.equal(data.promotora, 'Nozar');
    },
  );
});

test('pickOfficialWebsite descarta la web de una empresa distinta cuando el LLM dice indexMatch -1', async () => {
  await withMockedFetch(
    async () => mockOpenAiResponse({ indexMatch: -1 }),
    async () => {
      const url = await pickOfficialWebsite('Nozar', [
        { title: 'GESTOGAR Cooperativas de viviendas', url: 'https://www.gestogar.com/' },
      ]);
      assert.equal(url, null);
    },
  );
});

test('pickOfficialWebsite devuelve la url del índice elegido por el LLM', async () => {
  await withMockedFetch(
    async () => mockOpenAiResponse({ indexMatch: 1 }),
    async () => {
      const url = await pickOfficialWebsite('Nozar', [
        { title: 'GESTOGAR Cooperativas de viviendas', url: 'https://www.gestogar.com/' },
        { title: 'Nozar: Promotora Inmobiliaria de Obra nueva', url: 'https://nozar.es/' },
      ]);
      assert.equal(url, 'https://nozar.es/');
    },
  );
});

test('extractGestoraContactFromText deja vacío lo que no aparece literalmente en el texto', async () => {
  await withMockedFetch(
    async () => mockOpenAiResponse({ website: 'https://nozar.es', phone: '', email: '', address: '', description: 'Promotora nacional.' }),
    async () => {
      const contact = await extractGestoraContactFromText('Nozar', 'Nozar es una promotora nacional. https://nozar.es');
      assert.equal(contact.phone, '');
      assert.equal(contact.email, '');
      assert.equal(contact.website, 'https://nozar.es');
    },
  );
});

test('extractPromotionsFromText devuelve [] si la web no lista promociones con nombre propio', async () => {
  await withMockedFetch(
    async () => mockOpenAiResponse({ promociones: [] }),
    async () => {
      const promos = await extractPromotionsFromText('Carlos Luxury Realty', 'Agencia de reventa de viviendas de lujo, sin promociones propias.');
      assert.deepEqual(promos, []);
    },
  );
});

test('extractPromotionsFromText extrae el catálogo real cuando la web lo lista', async () => {
  await withMockedFetch(
    async () => mockOpenAiResponse({ promociones: [{ nombre: 'Parque de Oza', estado: 'Comercialización', location: 'A Coruña', totalViviendas: 32 }] }),
    async () => {
      const promos = await extractPromotionsFromText('Masar', 'Promoción Parque de Oza, 32 viviendas, en comercialización.');
      assert.equal(promos.length, 1);
      assert.equal(promos[0].nombre, 'Parque de Oza');
    },
  );
});

test('searchWeb devuelve [] si Firecrawl responde con error, sin lanzar excepción', async () => {
  await withMockedFetch(
    async () => new Response('', { status: 500 }),
    async () => {
      const results = await searchWeb('cualquier cosa');
      assert.deepEqual(results, []);
    },
  );
});

test('scrapeUrl devuelve null si Firecrawl falla, sin lanzar excepción', async () => {
  await withMockedFetch(
    async () => new Response('', { status: 500 }),
    async () => {
      const markdown = await scrapeUrl('https://example.com');
      assert.equal(markdown, null);
    },
  );
});
