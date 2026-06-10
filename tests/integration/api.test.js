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

test("planillero CRUD persists each creation exactly once", async () => {
  const payload = {
    name: "Alta Integracion",
    username: "alta.integracion",
    email: "alta.integracion@tdefa.local",
    phone: "+54 11 5555 0101",
    dni: "39000101",
    status: "activo",
    assignedMatchesCount: 0,
    completedMatchesCount: 0,
  };

  const created = await fetchJson(`${api.baseUrl}/planilleros`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  assert.equal(created.response.status, 201);
  assert.match(created.data.id, /^u_plan_/);

  const listed = await fetchJson(`${api.baseUrl}/planilleros`);
  const matches = listed.data.filter((item) => item.username === payload.username);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].email, payload.email);

  const loaded = await fetchJson(`${api.baseUrl}/planilleros/${created.data.id}`);
  assert.equal(loaded.response.status, 200);
  assert.equal(loaded.data.name, payload.name);

  const updated = await fetchJson(`${api.baseUrl}/planilleros/${created.data.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "inactivo", phone: "+54 11 5555 0202" }),
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.data.status, "inactivo");
  assert.equal(updated.data.phone, "+54 11 5555 0202");

  const duplicate = await fetchJson(`${api.baseUrl}/planilleros`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  assert.equal(duplicate.response.status, 409);

  const removed = await fetch(`${api.baseUrl}/planilleros/${created.data.id}`, {
    method: "DELETE",
  });
  assert.equal(removed.status, 204);

  const missing = await fetchJson(`${api.baseUrl}/planilleros/${created.data.id}`);
  assert.equal(missing.response.status, 404);
});

test("tournament and team CRUD persists changes and allows deletion when unused", async () => {
  const tournament = await fetchJson(`${api.baseUrl}/tournaments`, {
    method: "POST",
    body: JSON.stringify({
      name: "Torneo CRUD",
      season: "2026",
      status: "activo",
      startDate: "2026-07-01",
      endDate: "2026-09-30",
    }),
  });
  assert.equal(tournament.response.status, 201);

  const updatedTournament = await fetchJson(`${api.baseUrl}/tournaments/${tournament.data.id}`, {
    method: "PATCH",
    body: JSON.stringify({ name: "Torneo CRUD Actualizado", status: "inactivo" }),
  });
  assert.equal(updatedTournament.response.status, 200);
  assert.equal(updatedTournament.data.name, "Torneo CRUD Actualizado");
  assert.equal(updatedTournament.data.status, "inactivo");

  const team = await fetchJson(`${api.baseUrl}/teams`, {
    method: "POST",
    body: JSON.stringify({
      name: "Equipo CRUD",
      shortName: "ECR",
      city: "Pilar",
      status: "activo",
    }),
  });
  assert.equal(team.response.status, 201);

  const updatedTeam = await fetchJson(`${api.baseUrl}/teams/${team.data.id}`, {
    method: "PATCH",
    body: JSON.stringify({ name: "Equipo CRUD Actualizado", shortName: "ECA" }),
  });
  assert.equal(updatedTeam.response.status, 200);
  assert.equal(updatedTeam.data.shortName, "ECA");

  const removedTeam = await fetch(`${api.baseUrl}/teams/${team.data.id}`, { method: "DELETE" });
  const removedTournament = await fetch(`${api.baseUrl}/tournaments/${tournament.data.id}`, {
    method: "DELETE",
  });
  assert.equal(removedTeam.status, 204);
  assert.equal(removedTournament.status, 204);
});

test("POST /api/matches creates the match, sheet and planillero assignment", async () => {
  const tournaments = await fetchJson(`${api.baseUrl}/tournaments`);
  const teams = await fetchJson(`${api.baseUrl}/teams`);
  const tournament = tournaments.data.find((item) => item.name === "Torneo Senior A");
  const homeTeam = teams.data.find((item) => item.id === "t_1");
  const awayTeam = teams.data.find((item) => item.id === "t_2");

  const created = await fetchJson(`${api.baseUrl}/matches`, {
    method: "POST",
    body: JSON.stringify({
      tournamentId: tournament.id,
      dateIso: "2026-07-01",
      time: "19:30",
      venue: "Sede Test",
      pitch: "Cancha 9",
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      assignedPlanilleroId: "u_plan_2",
    }),
  });

  assert.equal(created.response.status, 201);
  assert.equal(created.data.status, "pendiente");
  assert.deepEqual(created.data.score, { home: 0, away: 0 });
  assert.equal(created.data.assignedPlanilleroId, "u_plan_2");

  const assigned = await fetchJson(
    `${api.baseUrl}/matches?assignedPlanilleroId=u_plan_2`
  );
  assert.equal(
    assigned.data.filter((item) => item.id === created.data.id).length,
    1
  );

  const sheet = await fetchJson(`${api.baseUrl}/sheets/${created.data.id}`);
  assert.equal(sheet.response.status, 200);
  assert.deepEqual(sheet.data.homePlayers, []);
  assert.deepEqual(sheet.data.awayPlayers, []);

  const planillero = await fetchJson(`${api.baseUrl}/planilleros/u_plan_2`);
  assert.equal(planillero.data.assignedMatchesCount, 3);

  const blockedTournamentDelete = await fetch(`${api.baseUrl}/tournaments/${tournament.id}`, {
    method: "DELETE",
  });
  const blockedTeamDelete = await fetch(`${api.baseUrl}/teams/${homeTeam.id}`, {
    method: "DELETE",
  });
  assert.equal(blockedTournamentDelete.status, 409);
  assert.equal(blockedTeamDelete.status, 409);
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
