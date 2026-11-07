import { IMAGE_FRAMING, MODULE_ID, SETTINGS, SOCKET_REFRESH } from "./constants.mjs";
import { DEFAULT_LOCAL_STATE, DEFAULT_STAGE_STATE, normalizeLocalState, normalizeStageState } from "./state.mjs";

export class CharacterShowStore {
  constructor() {
    this.listeners = new Set();
  }

  registerSettings() {
    game.settings.register(MODULE_ID, SETTINGS.globalState, {
      name: "CHARACTER_SHOW.settings.globalState.name",
      hint: "CHARACTER_SHOW.settings.globalState.hint",
      scope: "world",
      config: false,
      type: Object,
      default: DEFAULT_STAGE_STATE,
      onChange: () => this.notify()
    });

    game.settings.register(MODULE_ID, SETTINGS.localState, {
      name: "CHARACTER_SHOW.settings.localState.name",
      hint: "CHARACTER_SHOW.settings.localState.hint",
      scope: "client",
      config: false,
      type: Object,
      default: DEFAULT_LOCAL_STATE,
      onChange: () => this.notify()
    });

    game.settings.register(MODULE_ID, SETTINGS.showControls, {
      name: "CHARACTER_SHOW.settings.showControls.name",
      hint: "CHARACTER_SHOW.settings.showControls.hint",
      scope: "client",
      config: true,
      type: Boolean,
      default: true,
      onChange: () => this.notify()
    });

    game.settings.register(MODULE_ID, SETTINGS.allowPlayerLocalMovement, {
      name: "CHARACTER_SHOW.settings.allowPlayerLocalMovement.name",
      hint: "CHARACTER_SHOW.settings.allowPlayerLocalMovement.hint",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      onChange: () => this.notify()
    });

    game.settings.register(MODULE_ID, SETTINGS.syncOrganization, {
      name: "CHARACTER_SHOW.settings.syncOrganization.name",
      hint: "CHARACTER_SHOW.settings.syncOrganization.hint",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      onChange: () => this.notify()
    });

    game.settings.register(MODULE_ID, SETTINGS.allowPlayerOwnedSpeaker, {
      name: "CHARACTER_SHOW.settings.allowPlayerOwnedSpeaker.name",
      hint: "CHARACTER_SHOW.settings.allowPlayerOwnedSpeaker.hint",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      onChange: () => this.notify()
    });

    game.settings.register(MODULE_ID, SETTINGS.imageFraming, {
      name: "CHARACTER_SHOW.settings.imageFraming.name",
      hint: "CHARACTER_SHOW.settings.imageFraming.hint",
      scope: "world",
      config: true,
      type: String,
      choices: {
        [IMAGE_FRAMING.portrait]: "CHARACTER_SHOW.settings.imageFraming.choices.portrait",
        [IMAGE_FRAMING.natural]: "CHARACTER_SHOW.settings.imageFraming.choices.natural"
      },
      default: IMAGE_FRAMING.portrait,
      onChange: () => this.notify()
    });
  }

  registerSocket() {
    game.socket?.on(`module.${MODULE_ID}`, (message) => {
      if (message?.type === SOCKET_REFRESH) this.notify();
    });
  }

  get stage() {
    return normalizeStageState(game.settings.get(MODULE_ID, SETTINGS.globalState));
  }

  get local() {
    return normalizeLocalState(game.settings.get(MODULE_ID, SETTINGS.localState));
  }

  get showControls() {
    return game.settings.get(MODULE_ID, SETTINGS.showControls) !== false;
  }

  get allowPlayerLocalMovement() {
    return game.settings.get(MODULE_ID, SETTINGS.allowPlayerLocalMovement) !== false;
  }

  get syncOrganization() {
    return game.settings.get(MODULE_ID, SETTINGS.syncOrganization) !== false;
  }

  get allowPlayerOwnedSpeaker() {
    return game.settings.get(MODULE_ID, SETTINGS.allowPlayerOwnedSpeaker) !== false;
  }

  get imageFraming() {
    const value = game.settings.get(MODULE_ID, SETTINGS.imageFraming);
    return Object.values(IMAGE_FRAMING).includes(value) ? value : IMAGE_FRAMING.portrait;
  }

  async setStage(state) {
    await game.settings.set(MODULE_ID, SETTINGS.globalState, normalizeStageState(state));
    game.socket?.emit(`module.${MODULE_ID}`, { type: SOCKET_REFRESH });
  }

  async setLocal(state) {
    await game.settings.set(MODULE_ID, SETTINGS.localState, normalizeLocalState(state));
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) listener();
  }
}
