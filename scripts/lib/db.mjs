import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { config } from './config.mjs';

let dbInstance = null;

/**
 * Open and initialize the native SQLite database file.
 * 
 * @returns {DatabaseSync} Database instance
 */
export function getDatabase() {
  if (!dbInstance) {
    const dbPath = join(config.paths.root, 'src', 'data', 'monitor.db');
    dbInstance = new DatabaseSync(dbPath);
    
    // Create tables schema
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS opportunities (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        source TEXT NOT NULL,
        sourceKind TEXT NOT NULL,
        publishedAt TEXT,
        firstSeenAt TEXT NOT NULL,
        lastSeenAt TEXT NOT NULL,
        location TEXT,
        type TEXT,
        status TEXT,
        summary TEXT,
        precioMin INTEGER,
        precioMax INTEGER,
        habitacionesMin INTEGER,
        banosMin INTEGER,
        promotora TEXT,
        totalViviendas INTEGER,
        garaje INTEGER,
        trastero INTEGER,
        terraza INTEGER
      );

      CREATE TABLE IF NOT EXISTS sources (
        name TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        kind TEXT NOT NULL,
        ok INTEGER NOT NULL,
        scanned INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS gestoras (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        logo TEXT NOT NULL,
        website TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT NOT NULL,
        address TEXT NOT NULL,
        description TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS gestora_promotions (
        id TEXT PRIMARY KEY,
        gestoraId TEXT NOT NULL,
        name TEXT NOT NULL,
        location TEXT NOT NULL,
        status TEXT NOT NULL,
        details TEXT,
        link TEXT,
        FOREIGN KEY(gestoraId) REFERENCES gestoras(id) ON DELETE CASCADE
      );
    `);

    // Seed default gestoras registry if empty
    seedGestoras(dbInstance);
  }
  return dbInstance;
}

/**
 * Inserts or updates an opportunity in the SQLite database.
 * 
 * @param {DatabaseSync} db - Database instance
 * @param {Object} op - Opportunity object
 */
export function saveOpportunity(db, op) {
  const stmt = db.prepare(`
    INSERT INTO opportunities (
      id, title, url, source, sourceKind, publishedAt, firstSeenAt, lastSeenAt,
      location, type, status, summary, precioMin, precioMax, habitacionesMin,
      banosMin, promotora, totalViviendas, garaje, trastero, terraza
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    ) ON CONFLICT(id) DO UPDATE SET
      lastSeenAt = excluded.lastSeenAt,
      status = CASE WHEN excluded.status IS NOT NULL THEN excluded.status ELSE status END,
      precioMin = CASE WHEN excluded.precioMin IS NOT NULL THEN excluded.precioMin ELSE precioMin END,
      precioMax = CASE WHEN excluded.precioMax IS NOT NULL THEN excluded.precioMax ELSE precioMax END,
      habitacionesMin = CASE WHEN excluded.habitacionesMin IS NOT NULL THEN excluded.habitacionesMin ELSE habitacionesMin END,
      banosMin = CASE WHEN excluded.banosMin IS NOT NULL THEN excluded.banosMin ELSE banosMin END,
      promotora = CASE WHEN excluded.promotora IS NOT NULL THEN excluded.promotora ELSE promotora END,
      totalViviendas = CASE WHEN excluded.totalViviendas IS NOT NULL THEN excluded.totalViviendas ELSE totalViviendas END,
      garaje = CASE WHEN excluded.garaje IS NOT NULL THEN excluded.garaje ELSE garaje END,
      trastero = CASE WHEN excluded.trastero IS NOT NULL THEN excluded.trastero ELSE trastero END,
      terraza = CASE WHEN excluded.terraza IS NOT NULL THEN excluded.terraza ELSE terraza END
  `);

  stmt.run(
    op.id,
    op.title,
    op.url,
    op.source,
    op.sourceKind,
    op.publishedAt || null,
    op.firstSeenAt,
    op.lastSeenAt,
    op.location || null,
    op.type || null,
    op.status || null,
    op.summary || null,
    op.precioMin !== undefined ? op.precioMin : null,
    op.precioMax !== undefined ? op.precioMax : null,
    op.habitacionesMin !== undefined ? op.habitacionesMin : null,
    op.banosMin !== undefined ? op.banosMin : null,
    op.promotora || null,
    op.totalViviendas !== undefined ? op.totalViviendas : null,
    op.garaje === true ? 1 : (op.garaje === false ? 0 : null),
    op.trastero === true ? 1 : (op.trastero === false ? 0 : null),
    op.terraza === true ? 1 : (op.terraza === false ? 0 : null)
  );
}

/**
 * Retrieves a single opportunity from the SQLite database.
 * 
 * @param {DatabaseSync} db - Database instance
 * @param {string} id - Opportunity ID
 * @returns {Object|null} Opportunity object or null
 */
export function getOpportunity(db, id) {
  const stmt = db.prepare('SELECT * FROM opportunities WHERE id = ?');
  const rows = stmt.all(id);
  if (rows.length === 0) return null;
  const row = rows[0];
  
  return {
    ...row,
    garaje: row.garaje === 1 ? true : (row.garaje === 0 ? false : null),
    trastero: row.trastero === 1 ? true : (row.trastero === 0 ? false : null),
    terraza: row.terraza === 1 ? true : (row.terraza === 0 ? false : null),
  };
}

/**
 * Retrieves the latest opportunities ordered by date.
 * 
 * @param {DatabaseSync} db - Database instance
 * @param {number} limit - Maximum number of items
 * @returns {Array<Object>} List of opportunities
 */
export function getAllOpportunities(db, limit = 150) {
  const stmt = db.prepare(`
    SELECT * FROM opportunities 
    ORDER BY COALESCE(publishedAt, firstSeenAt) DESC 
    LIMIT ?
  `);
  const rows = stmt.all(limit);
  return rows.map(row => ({
    ...row,
    garaje: row.garaje === 1 ? true : (row.garaje === 0 ? false : null),
    trastero: row.trastero === 1 ? true : (row.trastero === 0 ? false : null),
    terraza: row.terraza === 1 ? true : (row.terraza === 0 ? false : null),
  }));
}

/**
 * Inserts or updates a source log entry.
 * 
 * @param {DatabaseSync} db - Database instance
 * @param {Object} source - Source log object
 */
export function saveSource(db, source) {
  const stmt = db.prepare(`
    INSERT INTO sources (name, url, kind, ok, scanned)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      ok = excluded.ok,
      scanned = excluded.scanned
  `);
  stmt.run(
    source.name,
    source.url,
    source.kind,
    source.ok ? 1 : 0,
    source.scanned
  );
}

/**
 * Retrieves all source log entries.
 * 
 * @param {DatabaseSync} db - Database instance
 * @returns {Array<Object>} List of source entries
 */
export function getAllSources(db) {
  const stmt = db.prepare('SELECT * FROM sources');
  const rows = stmt.all();
  return rows.map(row => ({
    ...row,
    ok: row.ok === 1,
  }));
}

/**
 * Seeds the database with the verified default gestoras and promotions in A Coruña.
 * 
 * @param {DatabaseSync} db - Database instance
 */
function seedGestoras(db) {
  const count = db.prepare('SELECT count(*) as count FROM gestoras').all()[0].count;
  if (count > 0) return;

  const defaultGestoras = [
    {
      id: "gestogar",
      name: "Gestogar (Nosogar)",
      logo: "GG",
      website: "https://nosogar.com",
      phone: "+34 604 050 000",
      email: "info@nosogar.com",
      address: "Calle Juan Flórez, 16, 15004 A Coruña",
      description: "Gestora líder gallega con amplia trayectoria histórica en la comarca coruñesa. Coordinadores del proyecto cooperativo Mirador de Matogrande en Xuxán.",
      promotions: [
        {
          id: "matogrande-z15",
          name: "Mirador de Matogrande (Z-15)",
          location: "Xuxán (A Coruña)",
          status: "Entregada",
          details: "Edificio de 90 viviendas protegidas (VPA) en régimen de cooperativa.",
          link: "https://nosogar.com"
        },
        {
          id: "matogrande-z28",
          name: "Mirador de Matogrande (Z-28)",
          location: "Xuxán (A Coruña)",
          status: "Entregada",
          details: "Edificio de 90 viviendas protegidas (VPA) en régimen de cooperativa.",
          link: "https://nosogar.com"
        }
      ]
    },
    {
      id: "xesta",
      name: "Xesta (Xestión de Autopromoción)",
      logo: "XS",
      website: "https://xestadeservizos.com",
      phone: "+34 981 14 00 14",
      email: "xesta@xestapromocion.com",
      address: "Calle Federico Tapia, 33, 15005 A Coruña",
      description: "Gestora local gallega especializada en cooperativas de viviendas, gestionando bloques residenciales de gran escala en Xuxán.",
      promotions: [
        {
          id: "xesta-z32",
          name: "Cooperativa Z32 Ofimático",
          location: "Xuxán (A Coruña)",
          status: "En construcción",
          details: "Edificio de 70 viviendas colectivas en régimen de cooperativa.",
          link: "https://xestadeservizos.com"
        },
        {
          id: "xesta-z33",
          name: "Cooperativa Z33 Ofimático",
          location: "Xuxán (A Coruña)",
          status: "En construcción",
          details: "Edificio de 70 viviendas colectivas en régimen de cooperativa.",
          link: "https://xestadeservizos.com"
        }
      ]
    },
    {
      id: "galivivienda",
      name: "Galivivienda (Gesvieco)",
      logo: "GV",
      website: "https://www.galivivienda.com",
      phone: "+34 981 12 34 56",
      email: "info@galivivienda.com",
      address: "Avenida de Linares Rivas, 30, 15005 A Coruña",
      description: "Sociedad gestora gallega vinculada al desarrollo de viviendas cooperativas en alquiler asequible y régimen general libre.",
      promotions: [
        {
          id: "galivivienda-z27",
          name: "Alquiler50 Parque Ofimático (Z-27)",
          location: "Xuxán (A Coruña)",
          status: "Comercialización",
          details: "Proyecto de 224 viviendas cooperativas en régimen de alquiler protegido.",
          link: "https://www.galivivienda.com"
        }
      ]
    },
    {
      id: "libra-gp",
      name: "Libra Gestión de Proyectos",
      logo: "LP",
      website: "https://www.libragp.com",
      phone: "+34 981 91 26 12",
      email: "galicia@libragp.com",
      address: "Plaza de Lugo, 2, 1º Izq, 15004 A Coruña",
      description: "Gestora nacional especializada en cooperativas residenciales a precio de coste. Promotores del complejo Residencial Finca de Xaz en Oleiros.",
      promotions: [
        {
          id: "libra-xaz",
          name: "Residencial Finca de Xaz",
          location: "Oleiros (Finca de Xaz)",
          status: "Entregada",
          details: "Chalets unifamiliares integrados en el campo de golf de Oleiros.",
          link: "https://www.libragp.com"
        }
      ]
    }
  ];

  const insertGestora = db.prepare(`
    INSERT INTO gestoras (id, name, logo, website, phone, email, address, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPromo = db.prepare(`
    INSERT INTO gestora_promotions (id, gestoraId, name, location, status, details, link)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const g of defaultGestoras) {
    insertGestora.run(g.id, g.name, g.logo, g.website, g.phone, g.email, g.address, g.description);
    for (const p of g.promotions) {
      insertPromo.run(p.id, g.id, p.name, p.location, p.status, p.details, p.link);
    }
  }
}

/**
 * Retrieves all cooperative managers along with their promotions.
 * 
 * @param {DatabaseSync} db - Database instance
 * @returns {Array<Object>} List of gestoras with promotions
 */
export function getAllGestoras(db) {
  const gestorasRows = db.prepare('SELECT * FROM gestoras').all();
  const promotionsRows = db.prepare('SELECT * FROM gestora_promotions').all();

  return gestorasRows.map(g => {
    const promotions = promotionsRows
      .filter(p => p.gestoraId === g.id)
      .map(p => ({
        name: p.name,
        location: p.location,
        status: p.status,
        details: p.details,
        link: p.link
      }));
    return {
      ...g,
      promotions
    };
  });
}
