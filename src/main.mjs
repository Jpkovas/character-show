import { DEFAULT_IMAGE, MODULE_ID } from "./constants.mjs";
import { CharacterShowOverlay, debugFoundryUiBlockers } from "./overlay.mjs";
import { CharacterShowStore } from "./settings.mjs";
import { markStageLayoutChanged, markStageSpeakerChanged, normalizeParticipantSizes, removeParticipant, resizeParticipantSizes, upsertParticipant, updateParticipant } from "./state.mjs";

export let store;
export let overlay;

Hooks.once("init", () => {
  store = new CharacterShowStore();
  store.registerSettings();
});

Hooks.once("ready", () => {
  overlay = new CharacterShowOverlay(store);
  overlay.mount();
  registerPublicApi();
});

async function addActor(actor, tokenDocument = null, placement = {}) {
  const data = {
    ...participantDataFromActor(actor, tokenDocument),
    showName: store.stage.showNames !== false,
    ...placement
  };
  await store.setStage(markStageLayoutChanged(upsertParticipant(store.stage, data)));
  ui.notifications?.info(game.i18n.format("CHARACTER_SHOW.notifications.added", { name: data.name }));
}

async function addActorAt(actor, placement = {}) {
  return addActor(actor, null, placement);
}

async function addDroppedDocument(dropData, placement = {}) {
  if (!game.user?.isGM) {
    ui.notifications?.warn(game.i18n.localize("CHARACTER_SHOW.notifications.gmOnly"));
    return;
  }

  const actor = await resolveActorFromDropData(dropData);
  if (!actor) return;
  await addActorAt(actor, placement);
}

function participantDataFromActor(actor, tokenDocument = null) {
  return {
    id: actor.uuid ?? `Actor.${actor.id}`,
    uuid: actor.uuid ?? `Actor.${actor.id}`,
    name: tokenDocument?.name || actor.name,
    image: tokenDocument?.texture?.src || actor.img || DEFAULT_IMAGE
  };
}

async function resolveActorFromDropData(dropData) {
  if (!dropData || dropData.type !== "Actor") return null;
  if (dropData.uuid) return globalThis.fromUuid?.(dropData.uuid);
  if (dropData.id) return game.actors?.get(dropData.id) ?? null;
  return null;
}

function registerPublicApi() {
  const api = {
    addActor,
    addActorAt,
    addDroppedDocument,
    clear: () => store.setStage(markStageLayoutChanged({ ...store.stage, participants: [], speakerId: null })),
    normalizeSizes: () => store.setStage(markStageLayoutChanged(normalizeParticipantSizes(store.stage))),
    resizeAll: (delta) => store.setStage(markStageLayoutChanged(resizeParticipantSizes(store.stage, delta))),
    removeActor: (id) => store.setStage(markStageLayoutChanged(removeParticipant(store.stage, id))),
    setSpeaker: (id) => store.setStage(markStageSpeakerChanged({ ...store.stage, speakerId: id })),
    updateActor: (id, patch) => store.setStage(markStageLayoutChanged(updateParticipant(store.stage, id, patch))),
    debugUiBlockers: (durationMs) => debugFoundryUiBlockers(durationMs)
  };

  game.modules.get(MODULE_ID).api = api;
}
