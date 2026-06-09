import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { fetchJson, resetTestDatabase, startTestApiServer } from "../helpers/test-server.js";

let api;

before(async () => {
  await resetTestDatabase();
  api = await startTestApiServer();
});

beforeEach(async () => {
  await resetTestDatabase();
});

after(async () => {
  await api.close();
});

test("GET /api/matches returns seeded matches filtered by planillero", async () => {
  const { response, data } = await fetchJson(
    `${api.baseUrl}/matches?assignedPlanilleroId=u_plan_1`
  );

  assert.equal(response.status, 200);
  assert.equal(data.length, 6);
  assert.equal(data[0].id, "m_1004");
  assert.equal(data[1].id, "m_1002");
  assert.equal(data[5].id, "m_2002");
});

test("frontend match mutations persist score, observations and player fields in MySQL", async () => {
  const initialSheet = await fetchJson(`${api.baseUrl}/sheets/m_1002`);
  assert.equal(initialSheet.response.status, 200);

  const updatedScore = await fetchJson(`${api.baseUrl}/matches/m_1002/score`, {
    method: "PATCH",
    body: JSON.stringify({ score: { home: 3, away: 2 } }),
  });
  assert.equal(updatedScore.response.status, 200);
  assert.deepEqual(updatedScore.data.score, { home: 3, away: 2 });

  const updatedSheetPayload = {
    ...initialSheet.data,
    observations: "Observacion persistida desde test de integracion.",
    homePlayers: initialSheet.data.homePlayers.map((player) =>
      player.id === "cha_1"
        ? {
            ...player,
            dni: "39999111",
            signed: true,
            goals: 2,
            yellowCards: 1,
            notes: "Controlado desde frontend",
          }
        : player
    ),
    incidents: [
      {
        id: "itest_1",
        minute: 44,
        type: "nota",
        team: "home",
        label: "Integracion OK",
      },
      ...initialSheet.data.incidents,
    ],
  };

  const savedSheet = await fetchJson(`${api.baseUrl}/sheets/m_1002`, {
    method: "PUT",
    body: JSON.stringify(updatedSheetPayload),
  });
  assert.equal(savedSheet.response.status, 200);

  const persistedMatch = await fetchJson(`${api.baseUrl}/matches/m_1002`);
  const persistedSheet = await fetchJson(`${api.baseUrl}/sheets/m_1002`);

  assert.deepEqual(persistedMatch.data.score, { home: 3, away: 2 });
  assert.equal(
    persistedSheet.data.observations,
    "Observacion persistida desde test de integracion."
  );

  const persistedPlayer = persistedSheet.data.homePlayers.find((player) => player.id === "cha_1");
  assert.ok(persistedPlayer);
  assert.equal(persistedPlayer.dni, "39999111");
  assert.equal(persistedPlayer.signed, true);
  assert.equal(persistedPlayer.goals, 2);
  assert.equal(persistedPlayer.yellowCards, 1);
  assert.equal(persistedPlayer.notes, "Controlado desde frontend");
  assert.equal(persistedSheet.data.incidents[0].label, "Integracion OK");
});

test("POST /api/sheets/:matchId/incidents and PATCH status keep reopen reason in sync", async () => {
  const incident = await fetchJson(`${api.baseUrl}/sheets/m_1001/incidents`, {
    method: "POST",
    body: JSON.stringify({
      minute: 89,
      type: "expulsion",
      team: "away",
      label: "Falta grave",
    }),
  });
  assert.equal(incident.response.status, 201);
  assert.equal(incident.data.incidents[0].label, "Falta grave");

  const reopened = await fetchJson(`${api.baseUrl}/matches/m_1001/status`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "reabierto",
      reopenReason: "Corregir expulsion cargada",
    }),
  });
  assert.equal(reopened.response.status, 200);
  assert.equal(reopened.data.reopenReason, "Corregir expulsion cargada");

  const finished = await fetchJson(`${api.baseUrl}/matches/m_1001/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "terminado" }),
  });
  assert.equal(finished.response.status, 200);
  assert.equal(finished.data.status, "terminado");
  assert.equal(finished.data.reopenReason, null);
});
