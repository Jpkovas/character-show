export const DEFAULT_STAGE_STATE = Object.freeze({
  version: 1,
  layoutRevision: 0,
  speakerRevision: 0,
  collapsed: false,
  showNames: true,
  participants: [],
  speakerId: null
});

export const DEFAULT_LOCAL_STATE = Object.freeze({
  version: 1,
  syncedLayoutRevision: 0,
  syncedSpeakerRevision: 0,
  hidden: false,
  controlsCollapsed: false,
  stageMinimized: false,
  snapToGrid: false,
  emptyHintDismissed: false,
  controlsPosition: null,
  offset: { x: 0, y: 0 },
  participants: {},
  selectedParticipantIds: [],
  localSpeakerId: null
});

const DEFAULT_SIZE = 190;
const MIN_SIZE = 110;
const MAX_SIZE = 360;
export const NORMALIZED_SIZE = DEFAULT_SIZE;

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

export function normalizeStageState(value = {}) {
  const state = {
    ...clone(DEFAULT_STAGE_STATE),
    ...(value && typeof value === "object" ? value : {})
  };

  state.version = 1;
  state.layoutRevision = Math.round(clamp(state.layoutRevision, 0, Number.MAX_SAFE_INTEGER));
  state.speakerRevision = Math.round(clamp(state.speakerRevision, 0, Number.MAX_SAFE_INTEGER));
  state.collapsed = Boolean(state.collapsed);
  state.showNames = state.showNames !== false;
  state.speakerId = typeof state.speakerId === "string" ? state.speakerId : null;
  state.participants = Array.isArray(state.participants)
    ? state.participants.map(normalizeParticipant).filter(Boolean)
    : [];

  if (state.speakerId && !state.participants.some((participant) => participant.id === state.speakerId)) {
    state.speakerId = null;
  }

  return state;
}

export function normalizeLocalState(value = {}) {
  const state = {
    ...clone(DEFAULT_LOCAL_STATE),
    ...(value && typeof value === "object" ? value : {})
  };

  state.version = 1;
  state.syncedLayoutRevision = Math.round(clamp(state.syncedLayoutRevision, 0, Number.MAX_SAFE_INTEGER));
  state.syncedSpeakerRevision = Math.round(clamp(state.syncedSpeakerRevision, 0, Number.MAX_SAFE_INTEGER));
  state.hidden = Boolean(state.hidden);
  state.controlsCollapsed = Boolean(state.controlsCollapsed);
  state.stageMinimized = Boolean(state.stageMinimized);
  state.snapToGrid = Boolean(state.snapToGrid);
  state.emptyHintDismissed = Boolean(state.emptyHintDismissed);
  state.controlsPosition = normalizeControlsPosition(state.controlsPosition);
  state.offset = normalizeOffset(state.offset);
  state.participants = normalizeLocalParticipants(state.participants);
  state.selectedParticipantIds = normalizeSelectedParticipantIds(state.selectedParticipantIds);
  state.localSpeakerId = typeof state.localSpeakerId === "string" ? state.localSpeakerId : null;
  return state;
}

export function createParticipant(data, index = 0) {
  const row = Math.floor(index / 4);
  const column = index % 4;

  return normalizeParticipant({
    id: data.id,
    uuid: data.uuid || data.id,
    name: data.name || "Unknown",
    image: data.image,
    showName: data.showName !== false,
    flipped: false,
    x: data.x ?? 6 + column * 18,
    y: data.y ?? 52 + row * 9,
    size: DEFAULT_SIZE,
    z: 10 + index
  });
}

export function upsertParticipant(stageState, participantData) {
  const state = normalizeStageState(stageState);
  const index = state.participants.findIndex((participant) => participant.id === participantData.id);

  if (index >= 0) {
    state.participants[index] = normalizeParticipant({
      ...state.participants[index],
      name: participantData.name || state.participants[index].name,
      image: participantData.image || state.participants[index].image,
      uuid: participantData.uuid || state.participants[index].uuid,
      x: participantData.x ?? state.participants[index].x,
      y: participantData.y ?? state.participants[index].y
    });
  } else {
    state.participants.push(createParticipant(participantData, state.participants.length));
  }

  return state;
}

export function removeParticipant(stageState, id) {
  const state = normalizeStageState(stageState);
  state.participants = state.participants.filter((participant) => participant.id !== id);
  if (state.speakerId === id) state.speakerId = null;
  return state;
}

export function updateParticipant(stageState, id, patch) {
  const state = normalizeStageState(stageState);
  state.participants = state.participants.map((participant) => {
    if (participant.id !== id) return participant;
    return normalizeParticipant({ ...participant, ...patch });
  });
  return state;
}

export function normalizeParticipantSizes(stageState, size = NORMALIZED_SIZE) {
  const state = normalizeStageState(stageState);
  state.participants = state.participants.map((participant) => normalizeParticipant({ ...participant, size }));
  return state;
}

export function resizeParticipantSizes(stageState, delta) {
  const state = normalizeStageState(stageState);
  const amount = Number(delta);
  if (!Number.isFinite(amount) || amount === 0) return state;

  state.participants = state.participants.map((participant) => normalizeParticipant({
    ...participant,
    size: participant.size + amount
  }));
  return state;
}

export function markStageLayoutChanged(stageState) {
  const state = normalizeStageState(stageState);
  state.layoutRevision = Math.round(clamp(state.layoutRevision + 1, 0, Number.MAX_SAFE_INTEGER));
  return state;
}

export function syncLocalLayoutRevision(localState, stageState, options = {}) {
  const local = normalizeLocalState(localState);
  const stage = normalizeStageState(stageState);
  if (local.syncedLayoutRevision === stage.layoutRevision) return local;

  return normalizeLocalState({
    ...local,
    syncedLayoutRevision: stage.layoutRevision,
    participants: options.preserveParticipantOverrides ? local.participants : {}
  });
}

export function markStageSpeakerChanged(stageState) {
  const state = normalizeStageState(stageState);
  state.speakerRevision = Math.round(clamp(state.speakerRevision + 1, 0, Number.MAX_SAFE_INTEGER));
  return state;
}

export function syncLocalSpeakerRevision(localState, stageState) {
  const local = normalizeLocalState(localState);
  const stage = normalizeStageState(stageState);
  const localSpeakerExists = !local.localSpeakerId
    || stage.participants.some((participant) => participant.id === local.localSpeakerId);
  if (local.syncedSpeakerRevision === stage.speakerRevision && localSpeakerExists) return local;

  return normalizeLocalState({
    ...local,
    syncedSpeakerRevision: stage.speakerRevision,
    localSpeakerId: null
  });
}

export function clearLocalParticipant(localState, id) {
  const state = normalizeLocalState(localState);
  delete state.participants[id];
  if (state.localSpeakerId === id) state.localSpeakerId = null;
  return state;
}

export function updateLocalParticipant(localState, id, patch) {
  const state = normalizeLocalState(localState);
  state.participants[id] = normalizeLocalParticipant({
    ...(state.participants[id] || {}),
    ...patch
  });
  return state;
}

export function getEffectiveParticipant(participant, localState) {
  const local = normalizeLocalState(localState).participants[participant.id] || {};
  return normalizeParticipant({ ...participant, ...local });
}

function normalizeParticipant(value = {}) {
  if (!value || typeof value !== "object" || typeof value.id !== "string" || !value.id) return null;

  return {
    id: value.id,
    uuid: typeof value.uuid === "string" && value.uuid ? value.uuid : value.id,
    name: typeof value.name === "string" && value.name ? value.name : "Unknown",
    image: typeof value.image === "string" && value.image ? value.image : "icons/svg/mystery-man.svg",
    showName: value.showName !== false,
    flipped: Boolean(value.flipped),
    x: clamp(value.x, 0, 100),
    y: clamp(value.y, 0, 100),
    size: clamp(value.size, MIN_SIZE, MAX_SIZE),
    z: Math.round(clamp(value.z, 0, 999))
  };
}

function normalizeOffset(value = {}) {
  return {
    x: clamp(value?.x, -2000, 2000),
    y: clamp(value?.y, -2000, 2000)
  };
}

function normalizeControlsPosition(value) {
  if (!value || typeof value !== "object") return null;
  return {
    x: clamp(value.x, 0, 5000),
    y: clamp(value.y, 0, 5000)
  };
}

function normalizeLocalParticipants(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([id, participant]) => [id, normalizeLocalParticipant(participant)])
      .filter(([id, participant]) => typeof id === "string" && id && participant)
  );
}

function normalizeLocalParticipant(value = {}) {
  if (!value || typeof value !== "object") return null;
  const output = {};

  if (value.x !== undefined) output.x = clamp(value.x, 0, 100);
  if (value.y !== undefined) output.y = clamp(value.y, 0, 100);
  if (value.size !== undefined) output.size = clamp(value.size, MIN_SIZE, MAX_SIZE);
  if (value.z !== undefined) output.z = Math.round(clamp(value.z, 0, 999));
  if (value.flipped !== undefined) output.flipped = Boolean(value.flipped);
  if (value.showName !== undefined) output.showName = Boolean(value.showName);

  return output;
}

function normalizeSelectedParticipantIds(value = []) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => typeof id === "string" && id))];
}
