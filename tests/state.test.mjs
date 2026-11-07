import test from "node:test";
import assert from "node:assert/strict";

import {
  clearLocalParticipant,
  getEffectiveParticipant,
  markStageLayoutChanged,
  markStageSpeakerChanged,
  normalizeParticipantSizes,
  normalizeLocalState,
  normalizeStageState,
  removeParticipant,
  resizeParticipantSizes,
  syncLocalLayoutRevision,
  syncLocalSpeakerRevision,
  updateLocalParticipant,
  updateParticipant,
  upsertParticipant
} from "../src/state.mjs";

test("upsertParticipant adds a normalized portrait with default layout", () => {
  const state = upsertParticipant(undefined, {
    id: "Actor.abc",
    name: "Captain Vale",
    image: "actors/vale.webp"
  });

  assert.equal(state.participants.length, 1);
  assert.equal(state.participants[0].name, "Captain Vale");
  assert.equal(state.participants[0].image, "actors/vale.webp");
  assert.equal(state.participants[0].showName, true);
  assert.equal(state.participants[0].size, 190);
});

test("upsertParticipant can place a dropped actor at the pointer position", () => {
  const state = upsertParticipant(undefined, {
    id: "Actor.drop",
    name: "Dropped",
    x: 42,
    y: 31
  });

  assert.equal(state.participants[0].x, 42);
  assert.equal(state.participants[0].y, 31);
});

test("upsertParticipant updates existing portraits without duplicating them", () => {
  let state = upsertParticipant(undefined, { id: "Actor.abc", name: "Old", image: "old.webp" });
  state = upsertParticipant(state, { id: "Actor.abc", name: "New", image: "new.webp" });

  assert.equal(state.participants.length, 1);
  assert.equal(state.participants[0].name, "New");
  assert.equal(state.participants[0].image, "new.webp");
});

test("removeParticipant clears the speaker when the speaker is removed", () => {
  let state = upsertParticipant(undefined, { id: "Actor.abc", name: "Vale" });
  state.speakerId = "Actor.abc";

  const next = removeParticipant(state, "Actor.abc");

  assert.equal(next.participants.length, 0);
  assert.equal(next.speakerId, null);
});

test("updateParticipant clamps unsafe position and size values", () => {
  let state = upsertParticipant(undefined, { id: "Actor.abc", name: "Vale" });
  state = updateParticipant(state, "Actor.abc", { x: -20, y: 500, size: 1000, z: 10000 });

  assert.equal(state.participants[0].x, 0);
  assert.equal(state.participants[0].y, 100);
  assert.equal(state.participants[0].size, 360);
  assert.equal(state.participants[0].z, 999);
});

test("local participant overrides affect only the effective participant", () => {
  const stage = upsertParticipant(undefined, { id: "Actor.abc", name: "Vale" });
  const local = updateLocalParticipant(undefined, "Actor.abc", { x: 80, y: 10 });

  const effective = getEffectiveParticipant(stage.participants[0], local);

  assert.equal(stage.participants[0].x, 6);
  assert.equal(effective.x, 80);
  assert.equal(effective.y, 10);
});

test("clearLocalParticipant removes local overrides", () => {
  let local = updateLocalParticipant(undefined, "Actor.abc", { x: 80 });
  local.localSpeakerId = "Actor.abc";

  local = clearLocalParticipant(local, "Actor.abc");

  assert.deepEqual(local.participants, {});
  assert.equal(local.localSpeakerId, null);
});

test("normalizers tolerate malformed settings", () => {
  assert.deepEqual(normalizeStageState({ participants: "bad" }).participants, []);
  assert.deepEqual(normalizeLocalState({ participants: [] }).participants, {});
  assert.equal(normalizeStageState({ layoutRevision: "bad" }).layoutRevision, 0);
  assert.equal(normalizeStageState({ speakerRevision: "bad" }).speakerRevision, 0);
  assert.equal(normalizeLocalState({ syncedLayoutRevision: "bad" }).syncedLayoutRevision, 0);
  assert.equal(normalizeLocalState({ syncedSpeakerRevision: "bad" }).syncedSpeakerRevision, 0);
});

test("normalizeLocalState preserves local UI preferences", () => {
  const local = normalizeLocalState({
    controlsCollapsed: true,
    stageMinimized: true,
    snapToGrid: true,
    emptyHintDismissed: true,
    controlsPosition: { x: 120, y: 32 },
    selectedParticipantIds: ["Actor.a", "Actor.a", "Actor.b"]
  });

  assert.equal(local.controlsCollapsed, true);
  assert.equal(local.stageMinimized, true);
  assert.equal(local.snapToGrid, true);
  assert.equal(local.emptyHintDismissed, true);
  assert.deepEqual(local.controlsPosition, { x: 120, y: 32 });
  assert.deepEqual(local.selectedParticipantIds, ["Actor.a", "Actor.b"]);
});

test("normalizeParticipantSizes returns every participant to the shared default size", () => {
  let state = upsertParticipant(undefined, { id: "Actor.a", name: "A" });
  state = upsertParticipant(state, { id: "Actor.b", name: "B" });
  state = updateParticipant(state, "Actor.a", { size: 330 });
  state = updateParticipant(state, "Actor.b", { size: 140 });

  const normalized = normalizeParticipantSizes(state);

  assert.deepEqual(normalized.participants.map((participant) => participant.size), [190, 190]);
});

test("resizeParticipantSizes adjusts every participant by the same clamped amount", () => {
  let state = upsertParticipant(undefined, { id: "Actor.a", name: "A" });
  state = upsertParticipant(state, { id: "Actor.b", name: "B" });
  state = updateParticipant(state, "Actor.a", { size: 350 });
  state = updateParticipant(state, "Actor.b", { size: 120 });

  const grown = resizeParticipantSizes(state, 32);
  const shrunk = resizeParticipantSizes(grown, -64);

  assert.deepEqual(grown.participants.map((participant) => participant.size), [360, 152]);
  assert.deepEqual(shrunk.participants.map((participant) => participant.size), [296, 110]);
});

test("layout revision invalidates local participant overrides", () => {
  const stage = markStageLayoutChanged(upsertParticipant(undefined, { id: "Actor.a", name: "A" }));
  const local = updateLocalParticipant(undefined, "Actor.a", { x: 80, y: 40, size: 260 });

  const synced = syncLocalLayoutRevision(local, stage);

  assert.equal(stage.layoutRevision, 1);
  assert.equal(synced.syncedLayoutRevision, 1);
  assert.deepEqual(synced.participants, {});
});

test("layout revision can preserve local participant overrides when organization sync is disabled", () => {
  const stage = markStageLayoutChanged(upsertParticipant(undefined, { id: "Actor.a", name: "A" }));
  const local = updateLocalParticipant(undefined, "Actor.a", { x: 80, y: 40, size: 260, showName: false });

  const synced = syncLocalLayoutRevision(local, stage, { preserveParticipantOverrides: true });

  assert.equal(synced.syncedLayoutRevision, 1);
  assert.deepEqual(synced.participants, local.participants);
});

test("layout sync preserves local overrides when revision is current", () => {
  const stage = markStageLayoutChanged(upsertParticipant(undefined, { id: "Actor.a", name: "A" }));
  const local = updateLocalParticipant({ syncedLayoutRevision: stage.layoutRevision }, "Actor.a", { x: 80 });

  const synced = syncLocalLayoutRevision(local, stage);

  assert.deepEqual(synced.participants, local.participants);
});

test("speaker revision invalidates local speaker override", () => {
  const stage = markStageSpeakerChanged({
    ...upsertParticipant(undefined, { id: "Actor.a", name: "A" }),
    speakerId: "Actor.a"
  });
  const local = normalizeLocalState({ localSpeakerId: "Actor.b" });

  const synced = syncLocalSpeakerRevision(local, stage);

  assert.equal(stage.speakerRevision, 1);
  assert.equal(synced.syncedSpeakerRevision, 1);
  assert.equal(synced.localSpeakerId, null);
});

test("speaker sync preserves local speaker when revision is current", () => {
  const stage = markStageSpeakerChanged(upsertParticipant(undefined, { id: "Actor.a", name: "A" }));
  const local = normalizeLocalState({ syncedSpeakerRevision: stage.speakerRevision, localSpeakerId: "Actor.a" });

  const synced = syncLocalSpeakerRevision(local, stage);

  assert.equal(synced.localSpeakerId, "Actor.a");
});

test("speaker sync clears a local speaker that is no longer on stage", () => {
  const stage = markStageSpeakerChanged(upsertParticipant(undefined, { id: "Actor.a", name: "A" }));
  const local = normalizeLocalState({ syncedSpeakerRevision: stage.speakerRevision, localSpeakerId: "Actor.removed" });

  const synced = syncLocalSpeakerRevision(local, stage);

  assert.equal(synced.syncedSpeakerRevision, stage.speakerRevision);
  assert.equal(synced.localSpeakerId, null);
});
