import mysql from "mysql2/promise";
import { seedMatches, seedPlanilleros, seedSheets } from "./seed-data.js";

let pool;
let activeConfig;

const serialize = (value) => JSON.stringify(value ?? null);
const envFlagEnabled = (value, fallback = false) => {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
};

const parseJson = (value, fallback) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const escapeIdentifier = (value) => `\`${String(value).replaceAll("`", "``")}\``;

const sameConfig = (left, right) =>
  Boolean(left) &&
  Boolean(right) &&
  left.host === right.host &&
  left.port === right.port &&
  left.user === right.user &&
  left.password === right.password &&
  left.database === right.database;

export const getDbConfig = (overrides = {}) => ({
  host: overrides.host ?? process.env.DB_HOST ?? "127.0.0.1",
  port: Number(overrides.port ?? process.env.DB_PORT ?? 3306),
  user: overrides.user ?? process.env.DB_USER ?? "root",
  password: overrides.password ?? process.env.DB_PASSWORD ?? "",
  database: overrides.database ?? process.env.DB_NAME ?? "planilleros-app",
});

const createAdminConnection = async (config) =>
  mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
  });

const upsertPlanillero = async (db, item) => {
  await db.execute(
    `INSERT INTO planilleros (
      id, name, username, email, phone, dni, status,
      assigned_matches_count, completed_matches_count, created_at_iso
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      username = VALUES(username),
      email = VALUES(email),
      phone = VALUES(phone),
      dni = VALUES(dni),
      status = VALUES(status),
      assigned_matches_count = VALUES(assigned_matches_count),
      completed_matches_count = VALUES(completed_matches_count),
      created_at_iso = VALUES(created_at_iso)`,
    [
      item.id,
      item.name,
      item.username,
      item.email,
      item.phone,
      item.dni,
      item.status,
      item.assignedMatchesCount,
      item.completedMatchesCount,
      item.createdAtIso,
    ]
  );
};

const upsertMatch = async (db, item) => {
  await db.execute(
    `INSERT INTO matches (
      id, tournament, status, date_iso, time, venue, pitch,
      home_team, away_team, score, assigned_planillero_id, reopen_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      tournament = VALUES(tournament),
      status = VALUES(status),
      date_iso = VALUES(date_iso),
      time = VALUES(time),
      venue = VALUES(venue),
      pitch = VALUES(pitch),
      home_team = VALUES(home_team),
      away_team = VALUES(away_team),
      score = VALUES(score),
      assigned_planillero_id = VALUES(assigned_planillero_id),
      reopen_reason = VALUES(reopen_reason)`,
    [
      item.id,
      item.tournament,
      item.status,
      item.dateIso,
      item.time,
      item.venue,
      item.pitch,
      serialize(item.homeTeam),
      serialize(item.awayTeam),
      serialize(item.score),
      item.assignedPlanilleroId,
      item.reopenReason,
    ]
  );
};

const upsertSheet = async (db, item) => {
  await db.execute(
    `INSERT INTO sheets (
      match_id, home_players, away_players, observations, incidents, updated_at_iso
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      home_players = VALUES(home_players),
      away_players = VALUES(away_players),
      observations = VALUES(observations),
      incidents = VALUES(incidents),
      updated_at_iso = VALUES(updated_at_iso)`,
    [
      item.matchId,
      serialize(item.homePlayers),
      serialize(item.awayPlayers),
      item.observations,
      serialize(item.incidents),
      item.updatedAtIso,
    ]
  );
};

const createSchema = async (db) => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS planilleros (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      username VARCHAR(80) NOT NULL UNIQUE,
      email VARCHAR(160) NULL,
      phone VARCHAR(80) NULL,
      dni VARCHAR(32) NULL,
      status ENUM('activo', 'inactivo') NOT NULL DEFAULT 'activo',
      assigned_matches_count INT NOT NULL DEFAULT 0,
      completed_matches_count INT NOT NULL DEFAULT 0,
      created_at_iso VARCHAR(32) NOT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS matches (
      id VARCHAR(64) PRIMARY KEY,
      tournament VARCHAR(160) NOT NULL,
      status ENUM('pendiente', 'en_carga', 'terminado', 'reabierto') NOT NULL DEFAULT 'pendiente',
      date_iso VARCHAR(16) NOT NULL,
      time VARCHAR(16) NOT NULL,
      venue VARCHAR(160) NOT NULL,
      pitch VARCHAR(160) NOT NULL,
      home_team LONGTEXT NOT NULL,
      away_team LONGTEXT NOT NULL,
      score LONGTEXT NOT NULL,
      assigned_planillero_id VARCHAR(64) NOT NULL,
      reopen_reason VARCHAR(255) NULL,
      CONSTRAINT fk_matches_planillero FOREIGN KEY (assigned_planillero_id) REFERENCES planilleros(id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS sheets (
      match_id VARCHAR(64) PRIMARY KEY,
      home_players LONGTEXT NOT NULL,
      away_players LONGTEXT NOT NULL,
      observations LONGTEXT NOT NULL,
      incidents LONGTEXT NOT NULL,
      updated_at_iso VARCHAR(40) NOT NULL,
      CONSTRAINT fk_sheets_match FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
    )
  `);
};

export const seedDatabase = async (db = getPool()) => {
  for (const item of seedPlanilleros) {
    await upsertPlanillero(db, item);
  }

  for (const item of seedMatches) {
    await upsertMatch(db, item);
  }

  for (const item of Object.values(seedSheets)) {
    await upsertSheet(db, item);
  }
};

const databaseExists = async (config) => {
  try {
    const connection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
    });
    await connection.end();
    return true;
  } catch (error) {
    if (error?.code === "ER_BAD_DB_ERROR") return false;
    throw error;
  }
};

const ensureDatabase = async (config) => {
  if (await databaseExists(config)) return;

  const adminConnection = await createAdminConnection(config);
  await adminConnection.query(
    `CREATE DATABASE IF NOT EXISTS ${escapeIdentifier(config.database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await adminConnection.end();
};

export const closePool = async () => {
  if (!pool) return;
  await pool.end();
  pool = undefined;
  activeConfig = undefined;
};

const connectPool = async (config) => {
  if (pool && sameConfig(activeConfig, config)) {
    return pool;
  }

  await closePool();
  pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
  });
  activeConfig = config;
  return pool;
};

export const initializeDatabase = async (options = {}) => {
  const config = getDbConfig(options.config);
  const shouldCreateDatabase = options.createDatabase ?? envFlagEnabled(process.env.DB_AUTO_CREATE, false);
  const shouldSeed = options.seed ?? envFlagEnabled(process.env.DB_SEED, false);

  if (shouldCreateDatabase) {
    await ensureDatabase(config);
  }

  let db;
  try {
    db = await connectPool(config);
    await createSchema(db);
  } catch (error) {
    if (!shouldCreateDatabase && error?.code === "ER_BAD_DB_ERROR") {
      throw new Error(
        `Database "${config.database}" does not exist. Create it manually or set DB_AUTO_CREATE=true for the initial bootstrap.`
      );
    }
    throw error;
  }

  if (shouldSeed) {
    await seedDatabase(db);
  }
  return config;
};

export const resetDatabase = async (options = {}) => {
  const config = getDbConfig(options.config);
  await closePool();
  const adminConnection = await createAdminConnection(config);
  await adminConnection.query(`DROP DATABASE IF EXISTS ${escapeIdentifier(config.database)}`);
  await adminConnection.query(
    `CREATE DATABASE ${escapeIdentifier(config.database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await adminConnection.end();

  const db = await connectPool(config);
  await createSchema(db);
  if (options.seed !== false) {
    await seedDatabase(db);
  }
  return config;
};

export const getPool = () => {
  if (!pool) {
    throw new Error("Database pool not initialized");
  }
  return pool;
};

export const mapMatchRow = (row) => ({
  id: row.id,
  tournament: row.tournament,
  status: row.status,
  dateIso: row.date_iso,
  time: row.time,
  venue: row.venue,
  pitch: row.pitch,
  homeTeam: parseJson(row.home_team, {}),
  awayTeam: parseJson(row.away_team, {}),
  score: parseJson(row.score, { home: 0, away: 0 }),
  assignedPlanilleroId: row.assigned_planillero_id,
  reopenReason: row.reopen_reason,
});

export const mapSheetRow = (row) => ({
  matchId: row.match_id,
  homePlayers: parseJson(row.home_players, []),
  awayPlayers: parseJson(row.away_players, []),
  observations: row.observations,
  incidents: parseJson(row.incidents, []),
  updatedAtIso: row.updated_at_iso,
});
