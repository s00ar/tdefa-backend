import assert from "node:assert/strict";
import test from "node:test";
import { getDbConfig, mapMatchRow, mapSheetRow } from "../../server/db.js";

test("getDbConfig merges overrides over defaults", () => {
  const config = getDbConfig({ database: "custom-db", port: 3307 });
  assert.equal(config.database, "custom-db");
  assert.equal(config.port, 3307);
  assert.equal(config.user, "root");
});

test("getDbConfig normalizes localhost to IPv4 for MySQL hosts", () => {
  const config = getDbConfig({ host: "localhost" });
  assert.equal(config.host, "127.0.0.1");
});

test("mapMatchRow parses JSON payloads from database rows", () => {
  const match = mapMatchRow({
    id: "m_test_1",
    tournament: "Demo Cup",
    status: "en_carga",
    date_iso: "2026-06-20",
    time: "18:00",
    venue: "Sede Test",
    pitch: "Cancha 9",
    home_team: JSON.stringify({ id: "home_1", name: "Local", shortName: "LOC" }),
    away_team: JSON.stringify({ id: "away_1", name: "Visitante", shortName: "VIS" }),
    score: JSON.stringify({ home: 2, away: 1 }),
    assigned_planillero_id: "u_plan_1",
    reopen_reason: "Ajuste",
  });

  assert.deepEqual(match.homeTeam, { id: "home_1", name: "Local", shortName: "LOC" });
  assert.deepEqual(match.awayTeam, { id: "away_1", name: "Visitante", shortName: "VIS" });
  assert.deepEqual(match.score, { home: 2, away: 1 });
  assert.equal(match.reopenReason, "Ajuste");
});

test("mapSheetRow falls back safely when row JSON is invalid", () => {
  const sheet = mapSheetRow({
    match_id: "m_test_2",
    home_players: "invalid",
    away_players: null,
    observations: "Sincronizada",
    incidents: "invalid",
    updated_at_iso: "2026-06-08T18:00:00.000Z",
  });

  assert.deepEqual(sheet.homePlayers, []);
  assert.deepEqual(sheet.awayPlayers, []);
  assert.deepEqual(sheet.incidents, []);
  assert.equal(sheet.observations, "Sincronizada");
});
