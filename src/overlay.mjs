import { IMAGE_FRAMING, MODULE_ID } from "./constants.mjs";
import {
  clearLocalParticipant,
  getEffectiveParticipant,
  markStageLayoutChanged,
  markStageSpeakerChanged,
  NORMALIZED_SIZE,
  normalizeParticipantSizes,
  removeParticipant,
  syncLocalLayoutRevision,
  syncLocalSpeakerRevision,
  updateLocalParticipant,
  updateParticipant
} from "./state.mjs";

const SNAP_POSITION_PIXELS = 24;
const SNAP_SIZE_PIXELS = 8;
const COLLISION_GAP_PIXELS = 8;
const GLOBAL_RESIZE_STEP = 16;
const ARRANGE_GAP_PIXELS = 18;
const PORTRAIT_IMAGE_RATIO = 0.8;
const STAGE_REFERENCE_HEIGHT = 1080;
const STAGE_REFERENCE_WIDTH = 1920;
const STAGE_SCALE_MIN = 0.5;
const STAGE_SCALE_MAX = 2;
const FOUNDRY_UI_SELECTORS = [
  "#sidebar",
  "#scene-controls",
  "#scene-navigation",
  "#hotbar",
  "#players"
];

export class CharacterShowOverlay {
  constructor(store) {
    this.store = store;
    this.root = null;
    this.stage = null;
    this.unsubscribe = null;
    this.dragState = null;
    this.suppressedClickId = null;
    this.arrangeMenuOpen = false;
    this.boundDocumentDragOver = (event) => this.handleDocumentDragOver(event);
    this.boundDocumentDrop = (event) => this.handleDocumentDrop(event);
    this.boundDocumentDragLeave = (event) => this.handleDocumentDragLeave(event);
    this.boundDocumentDragEnd = () => this.clearDropTargetState();
    this.boundDocumentPointerDown = (event) => this.handleDocumentPointerDown(event);
    this.boundDocumentKeyDown = (event) => this.handleDocumentKeyDown(event);
    this.boundViewportResize = () => this.scheduleViewportClamp();
    this._viewportResizeTimer = null;
    this._uiObservedElements = [];
    this._uiResizeObserver = null;
    this._uiMutationObservers = [];
    this._bodyObserver = null;
    this._uiRefreshTimer = null;
  }

  mount() {
    this.root = document.createElement("section");
    this.root.id = "character-show-overlay";
    this.root.className = "character-show-overlay";
    this.root.setAttribute("aria-label", game.i18n.localize("CHARACTER_SHOW.ui.stage"));
    document.body.append(this.root);

    this.unsubscribe = this.store.onChange(() => this.render());
    document.addEventListener("dragover", this.boundDocumentDragOver, true);
    document.addEventListener("drop", this.boundDocumentDrop, true);
    document.addEventListener("dragleave", this.boundDocumentDragLeave, true);
    document.addEventListener("dragend", this.boundDocumentDragEnd, true);
    document.addEventListener("pointerdown", this.boundDocumentPointerDown, true);
    document.addEventListener("keydown", this.boundDocumentKeyDown, true);
    window.addEventListener("resize", this.boundViewportResize);
    this.render();
    this.observeFoundryUi();
    if (typeof MutationObserver === "function") {
      this._bodyObserver = new MutationObserver(() => this.scheduleUiRefresh());
      this._bodyObserver.observe(document.body, { childList: true });
    }
  }

  destroy() {
    this.unsubscribe?.();
    document.removeEventListener("dragover", this.boundDocumentDragOver, true);
    document.removeEventListener("drop", this.boundDocumentDrop, true);
    document.removeEventListener("dragleave", this.boundDocumentDragLeave, true);
    document.removeEventListener("dragend", this.boundDocumentDragEnd, true);
    document.removeEventListener("pointerdown", this.boundDocumentPointerDown, true);
    document.removeEventListener("keydown", this.boundDocumentKeyDown, true);
    window.removeEventListener("resize", this.boundViewportResize);
    clearTimeout(this._viewportResizeTimer);
    clearTimeout(this._suppressedClickTimer);
    clearTimeout(this._uiRefreshTimer);
    clearTimeout(this._uiRefreshSettleTimer);
    clearTimeout(this._flipSettleTimer);
    this._uiResizeObserver?.disconnect();
    for (const observer of this._uiMutationObservers) observer.disconnect();
    this._uiMutationObservers = [];
    this._bodyObserver?.disconnect();
    this.root?.remove();
  }

  render() {
    if (!this.root || this._syncingLocal) return;

    const focusTarget = this.captureFocusTarget();
    const miniDockScrollLeft = this.root.querySelector("[data-mini-dock]")?.scrollLeft ?? null;
    const stageState = this.store.stage;
    const localState = this.syncLocalState(stageState, this.store.local);
    const selectedIds = this.getSelectedParticipantIds(stageState, localState);
    if (!stageState.participants.length || !this.canUserAdjustParticipant()) this.arrangeMenuOpen = false;

    this.root.classList.toggle("is-controls-collapsed", localState.controlsCollapsed);
    this.root.classList.toggle("is-stage-minimized", localState.stageMinimized);
    this.root.classList.toggle("is-snap-enabled", localState.snapToGrid);
    this.root.classList.toggle("is-selection-active", selectedIds.length > 0);
    this.root.classList.toggle("is-portrait-framing", this.store.imageFraming === IMAGE_FRAMING.portrait);
    this.root.classList.toggle("is-natural-framing", this.store.imageFraming === IMAGE_FRAMING.natural);
    this.applyControlsPosition(localState.controlsPosition);

    const previousStates = this.captureCardVisualStates();

    this.root.innerHTML = `
      ${this.renderControls(stageState, localState)}
      ${this.renderDropTarget()}
      <div class="character-show-stage" data-stage aria-live="polite">
        ${this.renderParticipants(stageState, localState)}
      </div>
      ${this.renderSelectionDock(stageState, localState)}
      ${this.renderMiniDock(stageState, localState)}
    `;

    this.stage = this.root.querySelector("[data-stage]");
    this.attachControlEvents();
    this.attachParticipantEvents();
    this.attachMiniDockEvents();
    this.attachSelectionDockEvents();
    this.attachToolbarDrag();
    this.attachImageRatioEvents();
    if (miniDockScrollLeft !== null) {
      const miniDock = this.root.querySelector("[data-mini-dock]");
      if (miniDock) miniDock.scrollLeft = miniDockScrollLeft;
    }
    this.restoreFocusTarget(focusTarget);
    this.updateToolbarMetrics();
    this.applyUiSafeArea();
    this.applyFlipShifts(previousStates);
    this.positionSelectionDock();
    this.positionSpeakingLabels();
    this._renderedOnce = true;
  }

  captureFocusTarget() {
    const active = document.activeElement;
    if (!(active instanceof Element) || !this.root?.contains(active)) return null;

    return {
      action: active.closest("[data-action]")?.dataset.action || null,
      miniParticipantId: active.closest("[data-mini-participant-id]")?.dataset.miniParticipantId || null,
      participantId: active.closest("[data-participant-id]")?.dataset.participantId || null,
      selectionDock: Boolean(active.closest("[data-selection-dock]")),
      controls: Boolean(active.closest("[data-controls]"))
    };
  }

  restoreFocusTarget(target) {
    if (!target) return;

    let selector = null;
    if (target.miniParticipantId) {
      selector = `[data-mini-participant-id="${cssEscape(target.miniParticipantId)}"]`;
    } else if (target.participantId && target.action) {
      selector = `[data-participant-id="${cssEscape(target.participantId)}"] [data-action="${cssEscape(target.action)}"]`;
    } else if (target.selectionDock && target.action) {
      selector = `[data-selection-dock] [data-action="${cssEscape(target.action)}"]`;
    } else if (target.controls && target.action) {
      selector = `[data-controls] [data-action="${cssEscape(target.action)}"]`;
    }

    if (selector) this.root?.querySelector(selector)?.focus({ preventScroll: true });
  }

  captureCardVisualStates() {
    const states = new Map();
    if (!this.root) return states;
    for (const card of this.root.querySelectorAll("[data-participant-id]")) {
      const image = card.querySelector(".character-show-card-image");
      states.set(card.dataset.participantId, {
        rect: card.getBoundingClientRect(),
        sizePx: image?.offsetHeight || 0
      });
    }
    return states;
  }

  applyGridInsets() {
    if (!this.root) return;
    const viewport = currentViewport();
    const insets = { top: 0, right: 0, bottom: 0, left: 0 };

    for (const rect of getFoundryUiBlockerRects(viewport)) {
      const tall = rect.height >= viewport.height * 0.5;
      const wide = rect.width >= viewport.width * 0.25;
      if (rect.left <= 8 && tall) insets.left = Math.max(insets.left, rect.right);
      else if (rect.right >= viewport.width - 8 && tall) insets.right = Math.max(insets.right, viewport.width - rect.left);
      else if (rect.top <= 8 && wide) insets.top = Math.max(insets.top, rect.bottom);
      else if (rect.bottom >= viewport.height - 8 && wide) insets.bottom = Math.max(insets.bottom, viewport.height - rect.top);
    }

    this.root.style.setProperty("--character-show-grid-inset-top", `${Math.round(insets.top)}px`);
    this.root.style.setProperty("--character-show-grid-inset-right", `${Math.round(insets.right)}px`);
    this.root.style.setProperty("--character-show-grid-inset-bottom", `${Math.round(insets.bottom)}px`);
    this.root.style.setProperty("--character-show-grid-inset-left", `${Math.round(insets.left)}px`);
  }

  observeFoundryUi() {
    if (typeof MutationObserver !== "function") return;
    const elements = FOUNDRY_UI_SELECTORS
      .map((selector) => document.querySelector(selector))
      .filter((element) => element instanceof Element);
    const unchanged = elements.length === this._uiObservedElements.length
      && elements.every((element, index) => element === this._uiObservedElements[index]);
    if (unchanged) return;

    this._uiResizeObserver?.disconnect();
    for (const observer of this._uiMutationObservers) observer.disconnect();
    this._uiMutationObservers = [];
    this._uiObservedElements = elements;

    if (typeof ResizeObserver === "function") {
      this._uiResizeObserver = new ResizeObserver(() => this.scheduleUiRefresh());
      for (const element of elements) this._uiResizeObserver.observe(element);
    }
    for (const element of elements) {
      const observer = new MutationObserver(() => this.scheduleUiRefresh());
      observer.observe(element, { attributes: true, attributeFilter: ["class", "style"], childList: true, subtree: true });
      this._uiMutationObservers.push(observer);
    }
  }

  scheduleUiRefresh() {
    if (!this._uiRefreshFramePending) {
      this._uiRefreshFramePending = true;
      requestAnimationFrame(() => {
        this._uiRefreshFramePending = false;
        this.refreshUiSafeArea();
      });
    }
    clearTimeout(this._uiRefreshTimer);
    this._uiRefreshTimer = setTimeout(() => this.refreshUiSafeArea(), 120);
  }

  refreshUiSafeArea() {
    if (!this.root) return;
    this.observeFoundryUi();

    const cards = Array.from(this.root.querySelectorAll("[data-participant-id]"));
    if (!cards.length) return;

    const stage = this.store.stage;
    const localState = this.store.local;
    const viewport = currentViewport();
    this.flashClass("is-safe-area-animated", 460);

    for (const card of cards) {
      if (card.classList.contains("is-dragging")) continue;
      const participant = stage.participants.find((entry) => entry.id === card.dataset.participantId);
      if (!participant) continue;
      const effective = getEffectiveParticipant(participant, localState);
      card.style.left = `${stageToScreenX(effective.x, viewport).toFixed(2)}px`;
      card.style.top = `${effective.y}%`;
    }

    this.applyUiSafeArea();
    this.positionSelectionDock();
    this.positionSpeakingLabels();
    clearTimeout(this._uiRefreshSettleTimer);
    this._uiRefreshSettleTimer = setTimeout(() => {
      this.positionSelectionDock();
      this.positionSpeakingLabels();
    }, 430);
  }

  scheduleUiSafeArea() {
    if (this._uiSafeAreaScheduled) return;
    this._uiSafeAreaScheduled = true;
    requestAnimationFrame(() => {
      this._uiSafeAreaScheduled = false;
      this.applyUiSafeArea();
    });
  }

  applyUiSafeArea() {
    if (!this.root) return;
    const cards = Array.from(this.root.querySelectorAll("[data-participant-id]"));
    if (!cards.length) return;

    const baseBlockers = getFoundryUiBlockerRects();
    const controlsRect = this.root.querySelector("[data-controls]")?.getBoundingClientRect();
    if (controlsRect && controlsRect.width > 0) baseBlockers.push(controlsRect);

    // Display constraint pass, purely visual and per client: every card must
    // clear the Foundry UI and the cards already placed before it. Earlier
    // stage entries act as anchors, so the result is deterministic and the
    // shared layout is never rewritten.
    const viewport = currentViewport();
    const placed = [];
    let adjusted = false;

    for (const card of cards) {
      if (card.classList.contains("is-dragging")) continue;
      const layout = cardLayoutPosition(card, viewport);
      if (layout.left === null || layout.top === null) continue;
      const rect = {
        left: layout.left,
        top: layout.top,
        right: layout.left + card.offsetWidth,
        bottom: layout.top + card.offsetHeight,
        width: card.offsetWidth,
        height: card.offsetHeight
      };

      const blockers = [...baseBlockers, ...placed];
      if (!blockers.some((blocker) => rectanglesOverlap(rect, blocker, 0))) {
        placed.push(rect);
        continue;
      }

      const entry = [{ id: card.dataset.participantId, rect }];
      let resolved = resolveRectsAwayFromBlockers(entry, blockers, viewport);
      if (resolved && !rectEntriesClearBlockers(resolved, blockers, COLLISION_GAP_PIXELS)) resolved = null;
      if (!resolved) resolved = nearestFreeRectEntries(entry, blockers, viewport);
      if (!resolved?.length) {
        placed.push(rect);
        continue;
      }

      const finalRect = resolved[0].rect;
      card.style.left = `${finalRect.left.toFixed(2)}px`;
      card.style.top = `${finalRect.top.toFixed(2)}px`;
      placed.push(finalRect);
      adjusted = true;
    }

    if (adjusted) {
      this.positionSelectionDock();
      this.positionSpeakingLabels();
    }
  }

  applyFlipShifts(previousStates) {
    const cardsToAnimate = [];

    for (const card of this.root.querySelectorAll("[data-participant-id]")) {
      const previous = previousStates.get(card.dataset.participantId);
      if (!previous) {
        if (this._renderedOnce) card.classList.add("is-entering");
        continue;
      }

      const image = card.querySelector(".character-show-card-image");
      const rect = card.getBoundingClientRect();
      const dx = previous.rect.left - rect.left;
      const dy = previous.rect.top - rect.top;
      const targetSize = image?.offsetHeight || 0;
      const hasMove = Math.abs(dx) >= 0.6 || Math.abs(dy) >= 0.6;
      const hasResize = previous.sizePx > 0 && targetSize > 0 && Math.abs(previous.sizePx - targetSize) >= 0.6;
      if (!hasMove && !hasResize) continue;

      card.style.transition = "none";
      if (hasMove) {
        card.style.setProperty("--character-show-shift-x", `${dx.toFixed(2)}px`);
        card.style.setProperty("--character-show-shift-y", `${dy.toFixed(2)}px`);
      }
      if (hasResize) {
        card.style.setProperty("--character-show-card-size", `${previous.sizePx.toFixed(2)}px`);
      }
      cardsToAnimate.push({ card, hasMove, hasResize, targetSize });
    }

    if (cardsToAnimate.length) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          for (const entry of cardsToAnimate) {
            entry.card.style.transition = "";
            if (entry.hasMove) {
              entry.card.style.removeProperty("--character-show-shift-x");
              entry.card.style.removeProperty("--character-show-shift-y");
            }
            if (entry.hasResize) {
              entry.card.style.setProperty("--character-show-card-size", `${entry.targetSize.toFixed(2)}px`);
            }
          }
        });
      });
      clearTimeout(this._flipSettleTimer);
      this._flipSettleTimer = setTimeout(() => {
        this.positionSelectionDock();
        this.positionSpeakingLabels();
      }, 420);
    }
  }

  renderControls(stageState, localState) {
    if (!this.store.showControls) return "";

    if (localState.controlsCollapsed) {
      const minimizeKey = localState.stageMinimized ? "CHARACTER_SHOW.controls.restoreAll" : "CHARACTER_SHOW.controls.minimizeAll";
      const canEditGlobal = game.user?.isGM;
      const arrangeMenu = stageState.participants.length && this.canUserAdjustParticipant()
        ? this.renderArrangeMenu({ compact: true })
        : "";
      const resizeButtons = canEditGlobal && stageState.participants.length
        ? `
          ${this.renderControlButton("resize-all-down", "CHARACTER_SHOW.controls.resizeAllDown", "fa-minus", { compact: true })}
          ${this.renderControlButton("resize-all-up", "CHARACTER_SHOW.controls.resizeAllUp", "fa-plus", { compact: true })}
        `
        : "";

      return `
        <nav class="character-show-controls is-minimized" data-controls>
          <strong class="character-show-brand is-icon-only" title="${escapeAttribute(this.localize("CHARACTER_SHOW.ui.stage"))}" aria-label="${escapeAttribute(this.localize("CHARACTER_SHOW.ui.stage"))}">
            <i class="fas fa-theater-masks" aria-hidden="true"></i>
            <span>${this.localize("CHARACTER_SHOW.ui.stage")}</span>
          </strong>
          ${arrangeMenu}
          ${resizeButtons}
          ${this.renderControlButton("toggle-stage-minimized", minimizeKey, localState.stageMinimized ? "fa-window-restore" : "fa-compress", { compact: true })}
          ${this.renderControlButton("toggle-snap", "CHARACTER_SHOW.controls.snapToGrid", "fa-magnet", { compact: true, active: localState.snapToGrid })}
          ${this.renderControlButton("toggle-collapse", "CHARACTER_SHOW.controls.expandToolbar", "fa-chevron-down", { compact: true })}
        </nav>
      `;
    }

    const canEditGlobal = game.user?.isGM;
    const clearButton = canEditGlobal
      ? this.renderControlButton("clear", "CHARACTER_SHOW.controls.clear", "fa-trash")
      : "";
    const normalizeButton = canEditGlobal && stageState.participants.length
      ? this.renderControlButton("normalize-sizes", "CHARACTER_SHOW.controls.normalizeSizes", "fa-ruler-combined")
      : "";
    const resizeButtons = canEditGlobal && stageState.participants.length
      ? `
        ${this.renderControlButton("resize-all-down", "CHARACTER_SHOW.controls.resizeAllDown", "fa-minus")}
        ${this.renderControlButton("resize-all-up", "CHARACTER_SHOW.controls.resizeAllUp", "fa-plus")}
      `
      : "";
    const arrangeMenu = stageState.participants.length && this.canUserAdjustParticipant()
      ? this.renderArrangeMenu()
      : "";
    const namesKey = this.areNamesVisible(stageState, localState) ? "CHARACTER_SHOW.controls.namesOff" : "CHARACTER_SHOW.controls.namesOn";
    const minimizeKey = localState.stageMinimized ? "CHARACTER_SHOW.controls.restoreAll" : "CHARACTER_SHOW.controls.minimizeAll";

    return `
      <nav class="character-show-controls" data-controls>
        <strong class="character-show-brand">
          <i class="fas fa-theater-masks" aria-hidden="true"></i>
          <span>${this.localize("CHARACTER_SHOW.ui.stage")}</span>
        </strong>
        <div class="character-show-control-group">
          ${clearButton}
          ${normalizeButton}
          ${arrangeMenu}
          ${resizeButtons}
        </div>
        <div class="character-show-control-group">
          ${canEditGlobal ? this.renderControlButton("toggle-names", namesKey, this.areNamesVisible(stageState, localState) ? "fa-eye-slash" : "fa-eye") : ""}
          ${this.renderControlButton("toggle-snap", "CHARACTER_SHOW.controls.snapToGrid", "fa-magnet", { active: localState.snapToGrid })}
          ${stageState.participants.length ? this.renderControlButton("toggle-stage-minimized", minimizeKey, localState.stageMinimized ? "fa-window-restore" : "fa-compress") : ""}
          ${this.renderControlButton("toggle-collapse", "CHARACTER_SHOW.controls.collapseToolbar", "fa-chevron-up")}
        </div>
      </nav>
    `;
  }

  renderDropTarget() {
    return `
      <div class="character-show-drop-target" data-drop-target aria-hidden="true">
        <i class="fas fa-user-plus" aria-hidden="true"></i>
        <span>${escapeHtml(this.localize("CHARACTER_SHOW.ui.dropActor"))}</span>
      </div>
    `;
  }

  renderSelectionDock(stageState, localState) {
    const selectedCount = this.getSelectedParticipantIds(stageState, localState).length;
    if (!selectedCount || localState.stageMinimized) return "";

    return `
      <div class="character-show-selection-dock" data-selection-dock>
        ${this.renderSelectionControls(selectedCount)}
      </div>
    `;
  }

  renderSelectionControls(selectedCount) {
    const label = game.i18n.format
      ? game.i18n.format("CHARACTER_SHOW.controls.selectedCount", { count: selectedCount })
      : this.localize("CHARACTER_SHOW.controls.selectedCount").replace("{count}", selectedCount);

    return `
      <span class="character-show-selection-count"><i class="fas fa-object-group" aria-hidden="true"></i>${escapeHtml(label)}</span>
      ${this.renderControlButton("resize-selection-down", "CHARACTER_SHOW.controls.resizeSelectionDown", "fa-minus")}
      ${this.renderControlButton("resize-selection-up", "CHARACTER_SHOW.controls.resizeSelectionUp", "fa-plus")}
      ${this.renderControlButton("clear-selection", "CHARACTER_SHOW.controls.clearSelection", "fa-times")}
    `;
  }

  renderControlButton(action, labelKey, icon, options = {}) {
    const label = this.localize(labelKey);
    const classNames = [
      "character-show-control-button",
      options.compact ? "is-icon-only" : "",
      options.active ? "is-active" : ""
    ].filter(Boolean).join(" ");

    return `
      <button type="button" class="${classNames}" data-action="${escapeAttribute(action)}" title="${escapeAttribute(label)}" aria-label="${escapeAttribute(label)}">
        <i class="fas ${escapeAttribute(icon)}" aria-hidden="true"></i>
        <span>${escapeHtml(label)}</span>
      </button>
    `;
  }

  renderArrangeMenu(options = {}) {
    const label = this.localize("CHARACTER_SHOW.controls.arrange");
    const classNames = [
      "character-show-arrange-menu",
      this.arrangeMenuOpen ? "is-open" : "",
      options.compact ? "is-compact" : ""
    ].filter(Boolean).join(" ");

    return `
      <div class="${classNames}">
        <button type="button" class="character-show-control-button ${options.compact ? "is-icon-only" : ""}" data-action="toggle-arrange-menu" title="${escapeAttribute(label)}" aria-label="${escapeAttribute(label)}" aria-expanded="${this.arrangeMenuOpen ? "true" : "false"}">
          <i class="fas fa-table-cells" aria-hidden="true"></i>
          <span>${escapeHtml(label)}</span>
        </button>
        <div class="character-show-arrange-options" aria-label="${escapeAttribute(label)}">
          <button type="button" data-action="arrange-row"><i class="fas fa-grip-lines" aria-hidden="true"></i>${escapeHtml(this.localize("CHARACTER_SHOW.controls.arrangeRow"))}</button>
          <button type="button" data-action="arrange-grid"><i class="fas fa-table-cells" aria-hidden="true"></i>${escapeHtml(this.localize("CHARACTER_SHOW.controls.arrangeGrid"))}</button>
          <button type="button" data-action="arrange-column"><i class="fas fa-bars" aria-hidden="true"></i>${escapeHtml(this.localize("CHARACTER_SHOW.controls.arrangeColumn"))}</button>
        </div>
      </div>
    `;
  }

  renderParticipants(stageState, localState) {
    if (localState.stageMinimized) return "";

    if (!stageState.participants.length) {
      if (localState.emptyHintDismissed) return "";
      return `
        <aside class="character-show-empty">
          <i class="fas fa-theater-masks" aria-hidden="true"></i>
          <span>${this.localize("CHARACTER_SHOW.ui.empty")}</span>
          <button type="button" data-action="dismiss-empty" aria-label="${escapeAttribute(this.localize("CHARACTER_SHOW.controls.close"))}">
            <i class="fas fa-times" aria-hidden="true"></i>
          </button>
        </aside>
      `;
    }

    const activeSpeaker = localState.localSpeakerId || stageState.speakerId;
    const selectedIds = new Set(this.getSelectedParticipantIds(stageState, localState));

    return stageState.participants
      .map((participant) => {
        const effective = getEffectiveParticipant(participant, localState);
        const isSpeaker = activeSpeaker === participant.id;
        const muted = activeSpeaker && !isSpeaker;
        const showName = effective.showName;
        const transform = effective.flipped ? "scaleX(-1)" : "none";
        const justRevealed = showName && this._justRevealedNames?.has(participant.id);
        const selected = selectedIds.has(participant.id);

        return `
          <article
            class="character-show-card ${isSpeaker ? "is-speaking" : ""} ${muted ? "is-muted" : ""} ${selected ? "is-selected" : ""} ${showName ? "has-name" : ""}"
            data-participant-id="${escapeAttribute(participant.id)}"
            style="left:${stageToScreenX(effective.x).toFixed(2)}px; top:${effective.y}%; --character-show-card-size:${this.sizeToPixels(effective.size).toFixed(2)}px; z-index:${effective.z};"
          >
            <button type="button" class="character-show-card-image" data-action="speaker" aria-label="${escapeAttribute(effective.name)}" title="${escapeAttribute(effective.name)}">
              <img src="${escapeAttribute(effective.image)}" alt="${escapeAttribute(effective.name)}" style="transform:${transform};">
              ${showName ? `<div class="character-show-name ${justRevealed ? "is-just-revealed" : ""}">${escapeHtml(effective.name)}</div>` : ""}
            </button>
            ${isSpeaker ? `<div class="character-show-speaking">${this.localize("CHARACTER_SHOW.ui.speaker")}</div>` : ""}
            ${this.renderCardTools(effective, selected)}
          </article>
        `;
      })
      .join("");
  }

  renderMiniDock(stageState, localState) {
    if (!localState.stageMinimized || !stageState.participants.length) return "";

    const activeSpeaker = localState.localSpeakerId || stageState.speakerId;
    const miniatures = stageState.participants
      .map((participant) => {
        const effective = getEffectiveParticipant(participant, localState);
        const isSpeaker = activeSpeaker === participant.id;
        const transform = effective.flipped ? "scaleX(-1)" : "none";

        return `
          <button type="button" class="character-show-mini ${isSpeaker ? "is-speaking" : ""}" data-mini-participant-id="${escapeAttribute(participant.id)}" title="${escapeAttribute(effective.name)}">
            <img src="${escapeAttribute(effective.image)}" alt="${escapeAttribute(effective.name)}" style="transform:${transform};">
          </button>
        `;
      })
      .join("");

    return `<div class="character-show-mini-dock" data-mini-dock>${miniatures}</div>`;
  }

  renderCardToolButton(action, labelKey, icon, options = {}) {
    const label = this.localize(labelKey);
    const classNames = [
      "is-icon-only",
      options.active ? "is-active" : "",
      options.danger ? "is-danger" : ""
    ].filter(Boolean).join(" ");
    const pressed = options.pressed === undefined ? "" : ` aria-pressed="${options.pressed ? "true" : "false"}"`;

    return `
      <button type="button" class="${classNames}" data-action="${escapeAttribute(action)}" title="${escapeAttribute(label)}" aria-label="${escapeAttribute(label)}"${pressed}>
        <i class="fas ${escapeAttribute(icon)}" aria-hidden="true"></i>
      </button>
    `;
  }

  renderCardTools(participant, selected = false) {
    const canResize = this.canUserAdjustParticipant();
    const selectTool = this.renderCardToolButton(
      "toggle-select",
      selected ? "CHARACTER_SHOW.controls.deselectActor" : "CHARACTER_SHOW.controls.selectActor",
      "fa-check",
      { active: selected, pressed: selected }
    );
    const resizeTools = canResize
      ? `
        ${this.renderCardToolButton("resize-down", "CHARACTER_SHOW.controls.resizeDown", "fa-minus")}
        ${this.renderCardToolButton("resize-up", "CHARACTER_SHOW.controls.resizeUp", "fa-plus")}
      `
      : "";
    const globalTools = game.user?.isGM
      ? `
        ${selectTool}
        ${resizeTools}
        ${this.renderCardToolButton("toggle-name", "CHARACTER_SHOW.controls.toggleName", "fa-tag")}
        ${this.renderCardToolButton("flip", "CHARACTER_SHOW.controls.flip", "fa-arrows-alt-h")}
        ${this.renderCardToolButton("remove", "CHARACTER_SHOW.controls.remove", "fa-trash", { danger: true })}
      `
      : `
        ${selectTool}
        ${resizeTools}
        ${this.renderCardToolButton("reset-card", "CHARACTER_SHOW.controls.resetCard", "fa-undo")}
      `;

    return `<div class="character-show-card-tools" aria-label="${escapeAttribute(participant.name)}">${globalTools}</div>`;
  }

  attachControlEvents() {
    const controls = this.root.querySelector("[data-controls]");
    if (!controls) return;

    controls.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      const action = button.dataset.action;

      if (action === "clear") return this.setSharedStage({ ...this.store.stage, participants: [], speakerId: null });
      if (action === "normalize-sizes") return this.normalizeVisibleParticipantSizes();
      if (action === "resize-all-down") return this.resizeAllParticipants(-GLOBAL_RESIZE_STEP);
      if (action === "resize-all-up") return this.resizeAllParticipants(GLOBAL_RESIZE_STEP);
      if (action === "resize-selection-down") return this.resizeSelectedParticipants(-GLOBAL_RESIZE_STEP);
      if (action === "resize-selection-up") return this.resizeSelectedParticipants(GLOBAL_RESIZE_STEP);
      if (action === "clear-selection") return this.clearSelection();
      if (action === "toggle-arrange-menu") return this.setArrangeMenuOpen(!this.arrangeMenuOpen);
      if (action === "arrange-row") {
        this.setArrangeMenuOpen(false);
        return this.arrangeParticipants("row");
      }
      if (action === "arrange-grid") {
        this.setArrangeMenuOpen(false);
        return this.arrangeParticipants("grid");
      }
      if (action === "arrange-column") {
        this.setArrangeMenuOpen(false);
        return this.arrangeParticipants("column");
      }
      if (action === "toggle-names") {
        const next = !this.areNamesVisible(this.store.stage, this.store.local);
        return this.setAllNameVisibility(next);
      }
      if (action === "toggle-stage-minimized") return this.store.setLocal({ ...this.store.local, stageMinimized: !this.store.local.stageMinimized });
      if (action === "toggle-snap") return this.store.setLocal({ ...this.store.local, snapToGrid: !this.store.local.snapToGrid });
      if (action === "toggle-collapse") {
        this.setArrangeMenuOpen(false);
        this.flashClass("is-controls-morphing", 180);
        await this.store.setLocal({ ...this.store.local, controlsCollapsed: !this.store.local.controlsCollapsed });
        requestAnimationFrame(() => this.clampControlsToViewport());
        return;
      }
    });
  }

  attachParticipantEvents() {
    for (const card of this.root.querySelectorAll("[data-participant-id]")) {
      const id = card.dataset.participantId;
      card.addEventListener("pointerdown", (event) => this.startCardDrag(event, card, id));
      card.addEventListener("click", (event) => this.handleCardClick(event, id));
    }

    this.root.querySelector("[data-action='dismiss-empty']")?.addEventListener("click", async (event) => {
      event.preventDefault();
      await this.store.setLocal({ ...this.store.local, emptyHintDismissed: true });
    });
  }

  attachMiniDockEvents() {
    this.root.querySelector("[data-mini-dock]")?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-mini-participant-id]");
      if (!button) return;
      const id = button.dataset.miniParticipantId;
      const participant = this.store.stage.participants.find((entry) => entry.id === id);
      if (!participant) return;
      if (game.user?.isGM) return this.setStageSpeaker(this.store.stage.speakerId === id ? null : id);
      if (!(await this.canPlayerSetSpeaker(participant))) {
        return ui.notifications?.warn(game.i18n.localize("CHARACTER_SHOW.notifications.speakerNotOwned"));
      }
      return this.store.setLocal({ ...this.store.local, localSpeakerId: this.store.local.localSpeakerId === id ? null : id });
    });
  }

  attachSelectionDockEvents() {
    const dock = this.root.querySelector("[data-selection-dock]");
    if (!dock) return;

    dock.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();

      const action = button.dataset.action;
      if (action === "resize-selection-down") return this.resizeSelectedParticipants(-GLOBAL_RESIZE_STEP);
      if (action === "resize-selection-up") return this.resizeSelectedParticipants(GLOBAL_RESIZE_STEP);
      if (action === "clear-selection") return this.clearSelection();
    });
  }

  async handleCardClick(event, id) {
    if (this.suppressedClickId === id) {
      this.suppressedClickId = null;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      return this.toggleParticipantSelection(id);
    }

    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    event.stopPropagation();

    const participant = this.store.stage.participants.find((entry) => entry.id === id);
    if (!participant) return;

    if (action === "speaker") {
      if (game.user?.isGM) return this.setStageSpeaker(this.store.stage.speakerId === id ? null : id);
      if (!(await this.canPlayerSetSpeaker(participant))) {
        return ui.notifications?.warn(game.i18n.localize("CHARACTER_SHOW.notifications.speakerNotOwned"));
      }
      return this.store.setLocal({ ...this.store.local, localSpeakerId: this.store.local.localSpeakerId === id ? null : id });
    }

    if (action === "toggle-select") return this.toggleParticipantSelection(id);
    if (action === "reset-card") return this.store.setLocal(clearLocalParticipant(this.store.local, id));
    if (action === "resize-down") return this.resizeParticipant(id, -GLOBAL_RESIZE_STEP);
    if (action === "resize-up") return this.resizeParticipant(id, GLOBAL_RESIZE_STEP);
    if (!game.user?.isGM) return ui.notifications?.warn(game.i18n.localize("CHARACTER_SHOW.notifications.gmOnly"));

    if (action === "toggle-name") {
      const next = !participant.showName;
      return this.setParticipantNameVisibility(id, next);
    }
    if (action === "flip") return this.updateParticipantOrganization(id, { flipped: !getEffectiveParticipant(participant, this.store.local).flipped });
    if (action === "remove") return this.setSharedStage(removeParticipant(this.store.stage, id));
  }

  startCardDrag(event, card, id) {
    if (!this.canStartDrag(event)) return;
    if (event.target.closest(".character-show-card-tools")) return;
    if (event.shiftKey) return;
    if (!this.canUserAdjustParticipant()) return;
    event.preventDefault();

    const dragIds = this.getDragParticipantIds(id);
    const dragItems = this.getDragItems(dragIds);
    if (!dragItems.length) return;
    const primary = dragItems.find((entry) => entry.id === id);
    if (!primary) return;

    const start = { x: event.clientX, y: event.clientY };
    const viewport = { width: window.innerWidth || document.documentElement.clientWidth, height: window.innerHeight || document.documentElement.clientHeight };
    const startPositions = new Map(dragItems.map((entry) => [entry.id, { x: entry.effective.x, y: entry.effective.y }]));
    let moved = false;
    for (const item of dragItems) item.card.classList.add("is-dragging");
    const dragMetrics = this.createDragMetrics(dragItems);
    if (this.store.local.snapToGrid) {
      this.applyGridInsets();
      this.root.classList.add("is-grid-active");
    }

    const onMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - start.x;
      const deltaY = moveEvent.clientY - start.y;
      moved = moved || Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4;
      const positions = this.resolveGroupDragPositions(dragItems, deltaX, deltaY, viewport, dragMetrics, id);
      for (const item of dragItems) {
        const position = positions.get(item.id);
        item.card.style.left = `${stageToScreenX(position.x, viewport).toFixed(2)}px`;
        item.card.style.top = `${position.y}%`;
      }
      this.positionSelectionDockDuringDrag(dragItems, positions, viewport, dragMetrics);
    };

    const finish = () => {
      this.root?.classList.remove("is-grid-active");
      for (const item of dragItems) item.card.classList.remove("is-dragging");
    };

    const onUp = async (upEvent) => {
      finish();
      const deltaX = upEvent.clientX - start.x;
      const deltaY = upEvent.clientY - start.y;
      const proposedPositions = this.resolveGroupDragPositions(dragItems, deltaX, deltaY, viewport, dragMetrics, id);
      const positions = this.resolveGroupDropPositions(dragItems, proposedPositions, viewport, dragMetrics, startPositions);
      if (moved) {
        this.suppressedClickId = id;
        clearTimeout(this._suppressedClickTimer);
        this._suppressedClickTimer = setTimeout(() => {
          if (this.suppressedClickId === id) this.suppressedClickId = null;
        }, 120);
      }
      const updates = new Map();
      for (const [participantId, position] of positions) updates.set(participantId, { ...position });
      if (moved) this.raiseParticipants(updates, dragIds);
      await this.updateParticipantOrganizations(updates);
    };

    this.trackPointerDrag(event, {
      move: onMove,
      end: onUp,
      cancel: () => {
        finish();
        this.render();
      }
    });
  }

  async resizeParticipant(id, delta) {
    const selectedIds = this.getSelectedParticipantIds();
    const ids = selectedIds.length > 1 && selectedIds.includes(id) ? selectedIds : [id];
    return this.resizeParticipants(ids, delta);
  }

  async resizeSelectedParticipants(delta) {
    const selectedIds = this.getSelectedParticipantIds();
    if (!selectedIds.length) return;
    return this.resizeParticipants(selectedIds, delta);
  }

  async resizeParticipants(ids, delta) {
    if (!this.canUserAdjustParticipant()) {
      return ui.notifications?.warn(game.i18n.localize("CHARACTER_SHOW.notifications.localMovementDisabled"));
    }

    const idSet = new Set(ids);
    const entries = [];
    for (const participant of this.store.stage.participants) {
      if (!idSet.has(participant.id)) continue;
      const card = this.root.querySelector(`[data-participant-id="${cssEscape(participant.id)}"]`);
      if (!card) continue;
      const effective = getEffectiveParticipant(participant, this.store.local);
      entries.push({
        id: participant.id,
        card,
        effective,
        size: this.applySnapToSize(clampSize(effective.size + delta))
      });
    }

    const changed = entries.filter((entry) => entry.size !== entry.effective.size);
    if (!changed.length) return;

    if (delta <= 0) {
      return this.updateParticipantOrganizations(new Map(changed.map((entry) => [entry.id, { size: entry.size }])));
    }

    const viewport = currentViewport();
    const blockers = this.getBlockerRectsExcluding(idSet);
    for (const entry of entries) {
      if (entry.size === entry.effective.size) blockers.push(entry.card.getBoundingClientRect());
    }

    const updates = new Map();
    const ordered = [...changed].sort((a, b) => a.effective.x - b.effective.x || a.effective.y - b.effective.y);
    for (const entry of ordered) {
      const rect = projectedResizeRect(entry.card, this.sizeToPixels(entry.size, viewport), viewport);
      let finalRect = rect;
      if (blockers.some((blocker) => rectanglesOverlap(rect, blocker, COLLISION_GAP_PIXELS))) {
        const resolved = resolveRectsAwayFromBlockers([{ id: entry.id, rect }], blockers, viewport);
        if (!resolved?.length) {
          return ui.notifications?.warn(game.i18n.localize("CHARACTER_SHOW.notifications.resizeBlocked"));
        }
        finalRect = resolved[0].rect;
      }
      blockers.push(finalRect);

      const patch = { size: entry.size };
      if (Math.abs(finalRect.left - rect.left) > 0.5 || Math.abs(finalRect.top - rect.top) > 0.5) {
        patch.x = screenToStageX(clampPosition(finalRect.left, 0, Math.max(0, viewport.width - finalRect.width)), viewport);
        patch.y = clampPosition((finalRect.top / viewport.height) * 100, 0, Math.max(0, ((viewport.height - finalRect.height) / viewport.height) * 100));
      }
      updates.set(entry.id, patch);
    }
    return this.updateParticipantOrganizations(updates);
  }

  async arrangeParticipants(layout) {
    if (!this.canUserAdjustParticipant()) {
      return ui.notifications?.warn(game.i18n.localize("CHARACTER_SHOW.notifications.localMovementDisabled"));
    }

    const placements = this.calculateArrangement(layout);
    if (!placements.length) return;

    if (this.shouldShareOrganization()) {
      const updates = new Map(placements.map((placement, index) => [placement.id, { x: placement.x, y: placement.y, z: 10 + index }]));
      return this.setStageLayout({
        ...this.store.stage,
        participants: this.store.stage.participants.map((participant) => {
          const update = updates.get(participant.id);
          return update ? { ...participant, ...update } : participant;
        })
      });
    }

    let localState = this.store.local;
    for (const [index, placement] of placements.entries()) {
      localState = updateLocalParticipant(localState, placement.id, { x: placement.x, y: placement.y, z: 10 + index });
    }
    return this.store.setLocal(localState);
  }

  calculateArrangement(layout) {
    const stageState = this.store.stage;
    const localState = this.store.local;
    const participants = [...stageState.participants].sort(compareParticipantsByName);
    if (!participants.length) return [];

    const items = participants.map((participant) => {
      const effective = getEffectiveParticipant(participant, localState);
      const card = Array.from(this.root.querySelectorAll("[data-participant-id]"))
        .find((entry) => entry.dataset.participantId === participant.id);
      const sizePx = this.sizeToPixels(effective.size);
      const fallbackWidth = Math.min(sizePx * PORTRAIT_IMAGE_RATIO, (window.innerWidth || document.documentElement.clientWidth || 1) - 24);
      return {
        id: participant.id,
        width: Math.max(48, card?.offsetWidth || fallbackWidth),
        height: Math.max(60, card?.offsetHeight || sizePx)
      };
    });

    const viewport = {
      width: window.innerWidth || document.documentElement.clientWidth || 1,
      height: window.innerHeight || document.documentElement.clientHeight || 1
    };
    const positioned = buildArrangement(layout, items, viewport);
    const controlsRect = this.root.querySelector("[data-controls]")?.getBoundingClientRect();
    const blockers = [...(controlsRect ? [controlsRect] : []), ...getFoundryUiBlockerRects()];
    const adjusted = moveArrangementAwayFromBlockers(positioned, blockers, viewport);

    return adjusted.map((item) => {
      const position = snapPosition({
        x: screenToStageX(item.left, viewport),
        y: (item.top / viewport.height) * 100
      });
      return { id: item.id, ...position };
    });
  }

  canUserAdjustParticipant() {
    return game.user?.isGM || this.store.allowPlayerLocalMovement !== false;
  }

  sizeToPixels(units, viewport = currentViewport()) {
    return units * stageScale(viewport);
  }

  areNamesVisible(stageState = this.store.stage, localState = this.store.local) {
    if (!stageState.participants.length) return stageState.showNames !== false;
    return stageState.participants.every((participant) => getEffectiveParticipant(participant, localState).showName !== false);
  }

  getSelectedParticipantIds(stageState = this.store.stage, localState = this.store.local) {
    const validIds = new Set(stageState.participants.map((participant) => participant.id));
    return (localState.selectedParticipantIds || []).filter((id) => validIds.has(id));
  }

  async toggleParticipantSelection(id) {
    const selected = new Set(this.getSelectedParticipantIds());
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    await this.store.setLocal({ ...this.store.local, selectedParticipantIds: Array.from(selected) });
  }

  clearSelection() {
    return this.store.setLocal({ ...this.store.local, selectedParticipantIds: [] });
  }

  getDragParticipantIds(id) {
    const selected = this.getSelectedParticipantIds();
    if (selected.length > 1 && selected.includes(id)) return selected;
    return [id];
  }

  getDragItems(ids) {
    const selected = new Set(ids);
    return this.store.stage.participants
      .filter((participant) => selected.has(participant.id))
      .map((participant) => {
        const card = this.root.querySelector(`[data-participant-id="${cssEscape(participant.id)}"]`);
        if (!card) return null;
        return {
          id: participant.id,
          card,
          effective: getEffectiveParticipant(participant, this.store.local)
        };
      })
      .filter(Boolean);
  }

  createDragMetrics(items) {
    const ids = new Set(items.map((item) => item.id));
    const selectedRects = new Map(items.map((item) => [item.id, item.card.getBoundingClientRect()]));
    const blockerRects = Array.from(this.root.querySelectorAll("[data-participant-id]"))
      .filter((card) => !ids.has(card.dataset.participantId))
      .map((card) => card.getBoundingClientRect());
    blockerRects.push(...getFoundryUiBlockerRects());
    const dockRect = this.root.querySelector("[data-selection-dock]")?.getBoundingClientRect() || null;
    const controlsRect = this.root.querySelector("[data-controls]")?.getBoundingClientRect() || null;

    return { blockerRects, controlsRect, dockRect, selectedRects };
  }

  resolveGroupDragPositions(items, deltaX, deltaY, viewport, metrics = null, anchorId = null) {
    const anchor = items.find((item) => item.id === anchorId) || items[0];
    let dx = deltaX;
    let dy = deltaY;

    if (this.store.local.snapToGrid && anchor) {
      const anchorLeft = stageToScreenX(anchor.effective.x, viewport);
      const anchorTop = (anchor.effective.y / 100) * viewport.height;
      dx = snap(anchorLeft + deltaX, SNAP_POSITION_PIXELS) - anchorLeft;
      dy = snap(anchorTop + deltaY, SNAP_POSITION_PIXELS) - anchorTop;
    }

    for (const item of items) {
      const rect = this.dragItemRect(item, metrics);
      const left = stageToScreenX(item.effective.x, viewport);
      const top = (item.effective.y / 100) * viewport.height;
      dx = clampPosition(dx, -left, Math.max(-left, viewport.width - rect.width - left));
      dy = clampPosition(dy, -top, Math.max(-top, viewport.height - rect.height - top));
    }

    return new Map(items.map((item) => {
      const left = stageToScreenX(item.effective.x, viewport) + dx;
      const top = (item.effective.y / 100) * viewport.height + dy;
      return [item.id, {
        x: screenToStageX(left, viewport),
        y: (top / viewport.height) * 100
      }];
    }));
  }

  dragItemRect(item, metrics = null) {
    return metrics?.selectedRects?.get(item.id) || item.card.getBoundingClientRect();
  }

  resolveGroupDropPositions(items, positions, viewport, metrics = null, fallback = positions) {
    const blockers = this.getMovementBlockerRects(items, metrics);
    const projected = items.map((item) => {
      const position = positions.get(item.id);
      const baseRect = metrics?.selectedRects?.get(item.id);
      return {
        id: item.id,
        rect: baseRect
          ? projectedRectFromPosition(baseRect, position, viewport)
          : projectedMoveRect(item.card, position)
      };
    });

    let resolved = resolveRectsAwayFromBlockers(projected, blockers, viewport);
    if (resolved && !rectEntriesClearBlockers(resolved, blockers, COLLISION_GAP_PIXELS)) resolved = null;
    if (!resolved) resolved = nearestFreeRectEntries(projected, blockers, viewport);
    if (!resolved) return fallback;

    return new Map(resolved.map((entry) => [
      entry.id,
      {
        x: screenToStageX(clampPosition(entry.rect.left, 0, Math.max(0, viewport.width - entry.rect.width)), viewport),
        y: clampPosition((entry.rect.top / viewport.height) * 100, 0, Math.max(0, ((viewport.height - entry.rect.height) / viewport.height) * 100))
      }
    ]));
  }

  getMovementBlockerRects(items, metrics = null) {
    const blockers = metrics ? [...metrics.blockerRects] : [];
    if (metrics?.controlsRect) blockers.push(metrics.controlsRect);
    if (metrics) return blockers;

    const ids = new Set(items.map((item) => item.id));
    for (const card of this.root.querySelectorAll("[data-participant-id]")) {
      if (!ids.has(card.dataset.participantId)) blockers.push(card.getBoundingClientRect());
    }
    const controls = this.root.querySelector("[data-controls]");
    if (controls) blockers.push(controls.getBoundingClientRect());
    blockers.push(...getFoundryUiBlockerRects());
    return blockers;
  }

  positionSelectionDockDuringDrag(items, positions, viewport, metrics) {
    const dock = this.root?.querySelector("[data-selection-dock]");
    const dockRect = metrics?.dockRect;
    if (!dock || !dockRect || !items.length) return;

    const anchor = items[0];
    const position = positions.get(anchor.id);
    if (!position) return;
    const deltaX = stageToScreenX(position.x, viewport) - stageToScreenX(anchor.effective.x, viewport);
    const deltaY = ((position.y - anchor.effective.y) / 100) * viewport.height;
    const x = clampPosition(dockRect.left + deltaX, 12, Math.max(12, viewport.width - dockRect.width - 12));
    const y = clampPosition(dockRect.top + deltaY, 12, Math.max(12, viewport.height - dockRect.height - 12));

    dock.style.left = `${x}px`;
    dock.style.top = `${y}px`;
  }

  setStageLayout(stageState) {
    return this.store.setStage(markStageLayoutChanged(stageState));
  }

  setSharedStage(stageState) {
    return this.setStageLayout(stageState);
  }

  shouldShareOrganization() {
    return game.user?.isGM && this.store.syncOrganization !== false;
  }

  updateParticipantOrganization(id, patch) {
    return this.updateParticipantOrganizations(new Map([[id, patch]]));
  }

  async updateParticipantOrganizations(updates) {
    const entries = updates instanceof Map ? Array.from(updates.entries()) : Array.from(updates || []);
    if (!entries.length) return;

    if (this.shouldShareOrganization()) {
      let stage = this.store.stage;
      for (const [id, patch] of entries) stage = updateParticipant(stage, id, patch);
      return this.setStageLayout(stage);
    }

    let localState = this.store.local;
    for (const [id, patch] of entries) localState = updateLocalParticipant(localState, id, patch);
    return this.store.setLocal(localState);
  }

  raiseParticipants(updates, ids) {
    const raisedSet = new Set(ids);
    const participants = this.store.stage.participants;
    const others = participants.filter((participant) => !raisedSet.has(participant.id));
    if (!others.length) return;

    const effectiveZ = (participant) => getEffectiveParticipant(participant, this.store.local).z;
    const maxOther = Math.max(...others.map(effectiveZ));
    const raised = participants
      .filter((participant) => raisedSet.has(participant.id))
      .sort((a, b) => effectiveZ(a) - effectiveZ(b));
    if (raised.every((participant) => effectiveZ(participant) > maxOther)) return;

    if (maxOther + raised.length > 999) {
      const ordered = participants
        .map((participant) => ({ id: participant.id, z: effectiveZ(participant), raised: raisedSet.has(participant.id) }))
        .sort((a, b) => (a.raised === b.raised ? a.z - b.z : a.raised ? 1 : -1));
      ordered.forEach((entry, index) => {
        updates.set(entry.id, { ...(updates.get(entry.id) || {}), z: 10 + index });
      });
      return;
    }

    raised.forEach((participant, index) => {
      updates.set(participant.id, { ...(updates.get(participant.id) || {}), z: maxOther + 1 + index });
    });
  }

  async normalizeVisibleParticipantSizes() {
    if (!this.canUserAdjustParticipant()) {
      return ui.notifications?.warn(game.i18n.localize("CHARACTER_SHOW.notifications.localMovementDisabled"));
    }

    if (this.shouldShareOrganization()) return this.setStageLayout(normalizeParticipantSizes(this.store.stage));

    const updates = new Map(this.store.stage.participants.map((participant) => [participant.id, { size: NORMALIZED_SIZE }]));
    return this.updateParticipantOrganizations(updates);
  }

  async setAllNameVisibility(showName) {
    if (!this.shouldShareOrganization()) {
      if (showName) {
        for (const entry of this.store.stage.participants) {
          const effective = getEffectiveParticipant(entry, this.store.local);
          if (!effective.showName) this.markNameRevealed(entry.id);
        }
      }
      const updates = new Map(this.store.stage.participants.map((entry) => [entry.id, { showName }]));
      return this.updateParticipantOrganizations(updates);
    }

    if (showName) {
      for (const entry of this.store.stage.participants) {
        if (!entry.showName) this.markNameRevealed(entry.id);
      }
    }

    const participants = this.store.stage.participants.map((entry) => ({ ...entry, showName }));
    return this.setStageLayout({ ...this.store.stage, showNames: showName, participants });
  }

  async setParticipantNameVisibility(id, showName) {
    if (showName) this.markNameRevealed(id);

    if (!this.shouldShareOrganization()) {
      return this.updateParticipantOrganization(id, { showName });
    }

    const stage = updateParticipant(this.store.stage, id, { showName });
    return this.setStageLayout(stage);
  }

  setStageSpeaker(speakerId) {
    return this.store.setStage(markStageSpeakerChanged({ ...this.store.stage, speakerId }));
  }

  syncLocalState(stageState, localState) {
    const layoutSynced = syncLocalLayoutRevision(localState, stageState, {
      preserveParticipantOverrides: this.store.syncOrganization === false
    });
    const synced = syncLocalSpeakerRevision(layoutSynced, stageState);
    const localParticipants = Object.keys(localState.participants || {}).length;
    const selected = this.getSelectedParticipantIds(stageState, synced);
    const selectionChanged = selected.length !== (synced.selectedParticipantIds || []).length;
    const nextLocal = selectionChanged ? { ...synced, selectedParticipantIds: selected } : synced;
    if (
      nextLocal.syncedLayoutRevision !== localState.syncedLayoutRevision ||
      nextLocal.syncedSpeakerRevision !== localState.syncedSpeakerRevision ||
      nextLocal.localSpeakerId !== localState.localSpeakerId ||
      localParticipants !== Object.keys(nextLocal.participants || {}).length ||
      selectionChanged
    ) {
      // Client settings are written (and onChange fired) synchronously: keep this render from re-entering itself.
      this._syncingLocal = true;
      try {
        this.store.setLocal(nextLocal).catch((error) => console.error(error));
      } finally {
        this._syncingLocal = false;
      }
    }
    return nextLocal;
  }

  async canPlayerSetSpeaker(participant) {
    if (game.user?.isGM) return true;
    if (this.store.allowPlayerOwnedSpeaker === false) return false;

    const actor = await resolveParticipantActor(participant);
    if (!actor) return false;
    const ownerPermission = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? "OWNER";
    if (typeof actor.testUserPermission === "function") return actor.testUserPermission(game.user, ownerPermission);
    return actor.isOwner === true;
  }

  attachImageRatioEvents() {
    for (const image of this.root.querySelectorAll(".character-show-card-image img")) {
      const applyRatio = () => {
        if (this.store.imageFraming === IMAGE_FRAMING.portrait) {
          image.closest(".character-show-card")?.style.setProperty("--character-show-image-ratio", PORTRAIT_IMAGE_RATIO.toFixed(3));
          return;
        }

        const ratio = image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : PORTRAIT_IMAGE_RATIO;
        image.closest(".character-show-card")?.style.setProperty("--character-show-image-ratio", clampRatio(ratio).toFixed(3));
        this.scheduleUiSafeArea();
      };

      if (image.complete) applyRatio();
      else image.addEventListener("load", applyRatio, { once: true });
    }
  }

  handleDocumentDragOver(event) {
    const dropData = readFoundryDropData(event);
    if (dropData && dropData.type !== "Actor") return;
    if (!dropData && !couldContainFoundryDropData(event)) return;

    this.root?.classList.add("is-drop-target");
    const overDropTarget = this.isPointerInDropTarget(event);
    this.root?.classList.toggle("is-drop-target-active", overDropTarget);
    if (!overDropTarget) return;

    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  async handleDocumentDrop(event) {
    this.clearDropTargetState();
    const dropData = readFoundryDropData(event);
    if (!dropData || dropData.type !== "Actor") return;
    if (!this.isPointerInDropTarget(event)) return;

    event.preventDefault();
    event.stopPropagation();
    const placement = this.resolveDroppedParticipantPlacement(dropData, this.applySnapToPosition(pointerToPercent(event)));
    await game.modules.get(MODULE_ID).api.addDroppedDocument(dropData, placement);
  }

  handleDocumentDragLeave(event) {
    if (event.relatedTarget) return;
    this.clearDropTargetState();
  }

  isPointerInDropTarget(event) {
    const target = this.root?.querySelector("[data-drop-target]");
    const rect = target?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  }

  clearDropTargetState() {
    this.root?.classList.remove("is-drop-target", "is-drop-target-active");
  }

  localize(key) {
    return game.i18n.localize(key);
  }

  applySnapToPosition(position) {
    if (!this.store.local.snapToGrid) return position;
    return snapPosition(position);
  }

  applySnapToSize(size) {
    if (!this.store.local.snapToGrid) return size;
    return snap(size, SNAP_SIZE_PIXELS);
  }

  overlapsFoundryUi(rect, uiRects = getFoundryUiBlockerRects()) {
    return uiRects.some((blocker) => rectanglesOverlap(rect, blocker, COLLISION_GAP_PIXELS));
  }

  overlapsParticipantCards(rect) {
    return Array.from(this.root.querySelectorAll("[data-participant-id]"))
      .some((card) => rectanglesOverlap(rect, card.getBoundingClientRect(), COLLISION_GAP_PIXELS));
  }

  resolveDroppedParticipantPlacement(dropData, placement) {
    const viewport = currentViewport();
    const sizePx = this.sizeToPixels(NORMALIZED_SIZE, viewport);
    const width = Math.min(sizePx * PORTRAIT_IMAGE_RATIO, viewport.width - 24);
    const height = sizePx;
    const maxLeftPx = Math.max(0, viewport.width - width);
    const maxY = Math.max(0, ((viewport.height - height) / viewport.height) * 100);
    const position = this.applySnapToPosition({
      x: screenToStageX(clampPosition(stageToScreenX(Number(placement?.x), viewport), 0, maxLeftPx), viewport),
      y: clampPosition(placement?.y, 0, maxY)
    });
    const id = participantIdFromDropData(dropData);
    const blockers = this.getNewParticipantBlockerRects(id);
    const projected = [{
      id: id || "__new-participant__",
      rect: rectFromPositionAndSize(position, { width, height }, viewport)
    }];
    let resolved = resolveRectsAwayFromBlockers(projected, blockers, viewport);
    if (resolved && !rectEntriesClearBlockers(resolved, blockers, COLLISION_GAP_PIXELS)) resolved = null;
    if (!resolved) resolved = nearestFreeRectEntries(projected, blockers, viewport);

    if (!resolved?.length) return position;

    return {
      x: screenToStageX(clampPosition(resolved[0].rect.left, 0, maxLeftPx), viewport),
      y: clampPosition((resolved[0].rect.top / viewport.height) * 100, 0, maxY)
    };
  }

  getBlockerRectsExcluding(excludedIds) {
    const blockers = [];
    for (const card of this.root.querySelectorAll("[data-participant-id]")) {
      if (excludedIds.has(card.dataset.participantId)) continue;
      blockers.push(card.getBoundingClientRect());
    }
    const controls = this.root.querySelector("[data-controls]");
    if (controls) blockers.push(controls.getBoundingClientRect());
    blockers.push(...getFoundryUiBlockerRects());
    return blockers;
  }

  getNewParticipantBlockerRects(id) {
    return this.getBlockerRectsExcluding(new Set(id ? [id] : []));
  }

  scheduleViewportClamp(delay = 180) {
    clearTimeout(this._viewportResizeTimer);
    this._viewportResizeTimer = setTimeout(() => this.handleViewportResize(), delay);
  }

  async handleViewportResize() {
    if (!this.root) return;
    this.render();
    await this.clampControlsToViewport();
    await this.clampParticipantsToViewport();
    this.applyUiSafeArea();
    this.positionSelectionDock();
  }

  async clampControlsToViewport() {
    const position = this.store.local.controlsPosition;
    if (!position) return;
    const controls = this.root?.querySelector("[data-controls]");
    const rect = controls?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    const viewport = {
      width: window.innerWidth || document.documentElement.clientWidth || 1,
      height: window.innerHeight || document.documentElement.clientHeight || 1
    };
    const maxX = Math.max(0, viewport.width - rect.width);
    const maxY = Math.max(0, viewport.height - rect.height);
    const x = clampPosition(position.x, 0, maxX);
    const y = clampPosition(position.y, 0, maxY);
    if (Math.abs(x - position.x) < 1 && Math.abs(y - position.y) < 1) return;
    await this.store.setLocal({ ...this.store.local, controlsPosition: { x, y } });
  }

  async clampParticipantsToViewport() {
    const stage = this.store.stage;
    const localState = this.store.local;
    const viewport = {
      width: window.innerWidth || document.documentElement.clientWidth || 1,
      height: window.innerHeight || document.documentElement.clientHeight || 1
    };

    const cards = Array.from(this.root.querySelectorAll("[data-participant-id]"));
    const dimensionFor = (id, effective) => {
      const card = cards.find((entry) => entry.dataset.participantId === id);
      const sizePx = this.sizeToPixels(effective.size, viewport);
      return {
        width: card?.offsetWidth || sizePx * PORTRAIT_IMAGE_RATIO,
        height: card?.offsetHeight || sizePx
      };
    };

    for (const participant of stage.participants) {
      const effective = getEffectiveParticipant(participant, localState);
      const card = cards.find((entry) => entry.dataset.participantId === participant.id);
      if (!card) continue;
      const { width, height } = dimensionFor(participant.id, effective);
      const savedLeft = stageToScreenX(effective.x, viewport);
      const savedTop = (effective.y / 100) * viewport.height;
      const left = clampPosition(savedLeft, 0, Math.max(0, viewport.width - width));
      const top = clampPosition(savedTop, 0, Math.max(0, viewport.height - height));

      card.style.left = `${left.toFixed(2)}px`;
      card.style.top = Math.abs(top - savedTop) >= 0.5 ? `${top}px` : `${effective.y}%`;
    }
  }

  markNameRevealed(id) {
    this._justRevealedNames = this._justRevealedNames || new Set();
    this._justRevealedNames.add(id);
    this._justRevealedTimers = this._justRevealedTimers || new Map();
    clearTimeout(this._justRevealedTimers.get(id));
    this._justRevealedTimers.set(id, setTimeout(() => {
      this._justRevealedNames?.delete(id);
      this._justRevealedTimers?.delete(id);
    }, 420));
  }

  flashClass(className, durationMs) {
    if (!this.root) return;
    this.root.classList.add(className);
    clearTimeout(this._flashTimers?.[className]);
    this._flashTimers = this._flashTimers || {};
    this._flashTimers[className] = setTimeout(() => {
      this.root?.classList.remove(className);
    }, durationMs);
  }

  positionSpeakingLabels() {
    if (!this.root) return;
    const cards = Array.from(this.root.querySelectorAll(".character-show-card"));
    if (!cards.length) return;

    const gap = 7;
    const cardRects = new Map(cards.map((card) => [card, card.getBoundingClientRect()]));

    for (const card of cards) {
      card.classList.remove("is-speaking-below");
      const label = card.querySelector(".character-show-speaking");
      if (!label) continue;

      label.classList.remove("is-above", "is-inside");
      const cardRect = cardRects.get(card);
      const labelRect = label.getBoundingClientRect();
      const labelWidth = labelRect.width || 80;
      const labelHeight = labelRect.height || 24;
      const centerX = (cardRect.left + cardRect.right) / 2;
      const labelLeft = centerX - labelWidth / 2;
      const labelRight = centerX + labelWidth / 2;

      const belowZone = {
        left: labelLeft,
        right: labelRight,
        top: cardRect.bottom + gap,
        bottom: cardRect.bottom + gap + labelHeight
      };
      const aboveZone = {
        left: labelLeft,
        right: labelRight,
        top: cardRect.top - gap - labelHeight,
        bottom: cardRect.top - gap
      };

      const others = cards.filter((other) => other !== card);
      const collidesBelow = others.some((other) => rectanglesOverlap(belowZone, cardRects.get(other), 0));
      const collidesAbove = others.some((other) => rectanglesOverlap(aboveZone, cardRects.get(other), 0));

      if (!collidesBelow) {
        card.classList.add("is-speaking-below");
      } else if (!collidesAbove) {
        label.classList.add("is-above");
      } else {
        label.classList.add("is-inside");
      }
    }
  }

  positionSelectionDock() {
    const dock = this.root?.querySelector("[data-selection-dock]");
    if (!dock) return;

    const selectedIds = new Set(this.getSelectedParticipantIds());
    const selectedCards = Array.from(this.root.querySelectorAll("[data-participant-id]"))
      .filter((card) => selectedIds.has(card.dataset.participantId));
    if (!selectedCards.length) return;

    const rects = selectedCards.map((card) => card.getBoundingClientRect());
    const bounds = {
      left: Math.min(...rects.map((rect) => rect.left)),
      top: Math.min(...rects.map((rect) => rect.top)),
      right: Math.max(...rects.map((rect) => rect.right)),
      bottom: Math.max(...rects.map((rect) => rect.bottom))
    };
    const viewport = {
      width: window.innerWidth || document.documentElement.clientWidth || 1,
      height: window.innerHeight || document.documentElement.clientHeight || 1
    };
    const dockRect = dock.getBoundingClientRect();
    const gap = 12;
    const x = clampPosition((bounds.left + bounds.right) / 2 - dockRect.width / 2, 12, Math.max(12, viewport.width - dockRect.width - 12));
    const preferredY = bounds.bottom + gap;
    const lowestSelectedTop = Math.max(...rects.map((rect) => rect.top));
    const fallbackY = lowestSelectedTop - dockRect.height - gap;
    const y = preferredY + dockRect.height <= viewport.height - 12
      ? preferredY
      : clampPosition(fallbackY, 12, Math.max(12, viewport.height - dockRect.height - 12));

    dock.style.left = `${x}px`;
    dock.style.top = `${y}px`;
  }

  resizeAllParticipants(delta) {
    if (!game.user?.isGM) return ui.notifications?.warn(game.i18n.localize("CHARACTER_SHOW.notifications.gmOnly"));
    return this.resizeParticipants(this.store.stage.participants.map((participant) => participant.id), delta);
  }

  attachToolbarDrag() {
    const controls = this.root.querySelector("[data-controls]");
    if (!controls) return;

    controls.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button") || !this.canStartDrag(event)) return;
      event.preventDefault();

      const rect = controls.getBoundingClientRect();
      const start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      let lastValid = { x: rect.left, y: rect.top };
      let moved = false;

      const onMove = (moveEvent) => {
        const proposed = {
          x: clampPosition(start.left + moveEvent.clientX - start.x, 0, window.innerWidth - rect.width),
          y: clampPosition(start.top + moveEvent.clientY - start.y, 0, window.innerHeight - rect.height)
        };
        const position = this.rejectOverlappingControls(rect, proposed, lastValid);
        lastValid = position;
        moved = true;
        this.root.style.setProperty("--character-show-controls-x", `${position.x}px`);
        this.root.style.setProperty("--character-show-controls-y", `${position.y}px`);
        this.root.style.setProperty("--character-show-controls-anchor-x", "calc(var(--character-show-controls-x, 0px) + var(--character-show-controls-width, 0px) / 2)");
        this.root.style.setProperty("--character-show-controls-transform", "none");
        this.root.classList.add("is-toolbar-dragging");
      };

      const onUp = async (upEvent) => {
        this.root.classList.remove("is-toolbar-dragging");
        if (!moved) return;
        const proposed = {
          x: clampPosition(start.left + upEvent.clientX - start.x, 0, window.innerWidth - rect.width),
          y: clampPosition(start.top + upEvent.clientY - start.y, 0, window.innerHeight - rect.height)
        };
        await this.store.setLocal({ ...this.store.local, controlsPosition: this.rejectOverlappingControls(rect, proposed, lastValid) });
      };

      this.trackPointerDrag(event, {
        move: onMove,
        end: onUp,
        cancel: () => {
          this.root.classList.remove("is-toolbar-dragging");
          this.render();
        }
      });
    });
  }

  /**
   * Follow one pointer from pointerdown until it is released or lost; only one drag runs at a time. Pointer cancel
   * and window blur end the drag through `cancel` (nothing is committed); other pointers are ignored.
   */
  /** A second pointer cannot start a parallel drag. The same pointer going down again means its last drag lost its end. */
  canStartDrag(event) {
    if (!this.dragState) return true;
    if (this.dragState.pointerId !== event.pointerId) return false;
    this.dragState.cancel({});
    return true;
  }

  trackPointerDrag(startEvent, { move, end, cancel }) {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const samePointer = (event) => event.pointerId === startEvent.pointerId;
    const stop = (callback) => (event) => {
      if (event.pointerId !== undefined && !samePointer(event)) return;
      controller.abort();
      this.dragState = null;
      callback(event);
    };
    this.dragState = { pointerId: startEvent.pointerId, cancel: stop(cancel) };
    document.addEventListener("pointermove", (event) => { if (samePointer(event)) move(event); }, options);
    document.addEventListener("pointerup", stop(end), options);
    document.addEventListener("pointercancel", stop(cancel), options);
    window.addEventListener("blur", stop(cancel), options);
  }

  rejectOverlappingControls(startRect, position, fallback) {
    const rect = projectedControlsRect(startRect, position);
    return this.overlapsParticipantCards(rect) || this.overlapsFoundryUi(rect) ? fallback : position;
  }

  handleDocumentPointerDown(event) {
    if (!this.arrangeMenuOpen || !this.root) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target && this.root.contains(target) && target.closest(".character-show-arrange-menu")) return;
    this.setArrangeMenuOpen(false);
  }

  handleDocumentKeyDown(event) {
    if (event.key !== "Escape") return;
    if (this.arrangeMenuOpen) {
      event.preventDefault();
      this.setArrangeMenuOpen(false);
      return;
    }
    if (this.getSelectedParticipantIds().length) this.clearSelection();
  }

  setArrangeMenuOpen(open) {
    this.arrangeMenuOpen = Boolean(open);
    if (this.arrangeMenuOpen) this.applyToolbarMetrics();

    const menu = this.root?.querySelector(".character-show-arrange-menu");
    const trigger = menu?.querySelector("[data-action='toggle-arrange-menu']");
    menu?.classList.toggle("is-open", this.arrangeMenuOpen);
    trigger?.setAttribute("aria-expanded", this.arrangeMenuOpen ? "true" : "false");
  }

  applyControlsPosition(position) {
    if (position) {
      this.root.style.setProperty("--character-show-controls-x", `${position.x}px`);
      this.root.style.setProperty("--character-show-controls-y", `${position.y}px`);
      this.root.style.setProperty("--character-show-controls-anchor-x", "calc(var(--character-show-controls-x, 0px) + var(--character-show-controls-width, 0px) / 2)");
      this.root.style.setProperty("--character-show-controls-transform", "none");
    } else {
      this.root.style.setProperty("--character-show-controls-x", "50%");
      this.root.style.setProperty("--character-show-controls-y", "12px");
      this.root.style.setProperty("--character-show-controls-anchor-x", "50%");
      this.root.style.setProperty("--character-show-controls-transform", "translateX(-50%)");
    }
  }

  updateToolbarMetrics() {
    const controls = this.root.querySelector("[data-controls]");
    if (!controls) return;
    requestAnimationFrame(() => this.applyToolbarMetrics());
  }

  applyToolbarMetrics() {
    const controls = this.root?.querySelector("[data-controls]");
    if (!controls) return;

    const rect = controls.getBoundingClientRect();
    const arrangeMenu = controls.querySelector(".character-show-arrange-menu");
    const arrangeRect = arrangeMenu?.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1;
    const panelWidth = Math.min(168, Math.max(96, viewportWidth - 24));
    const centerX = arrangeRect ? arrangeRect.left + arrangeRect.width / 2 : rect.left + rect.width / 2;
    const desiredPanelLeft = centerX - panelWidth / 2;
    const panelShift = desiredPanelLeft < 12
      ? 12 - desiredPanelLeft
      : Math.min(0, viewportWidth - 12 - (desiredPanelLeft + panelWidth));

    this.root?.style.setProperty("--character-show-controls-height", `${Math.ceil(rect.height)}px`);
    this.root?.style.setProperty("--character-show-controls-width", `${Math.ceil(rect.width)}px`);
    this.root?.style.setProperty("--character-show-arrange-menu-offset-y", `${arrangeRect ? Math.max(0, Math.round(arrangeRect.top - rect.top)) : 0}px`);
    this.root?.style.setProperty("--character-show-arrange-menu-shift-x", `${Math.round(panelShift)}px`);
    this.root?.style.setProperty("--character-show-arrange-menu-width", `${Math.round(panelWidth)}px`);
  }
}

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

function escapeAttribute(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : String(value).replaceAll('"', '\\"');
}

function readFoundryDropData(event) {
  const transfer = event.dataTransfer;
  if (!transfer) return null;

  for (const type of ["text/plain", "application/json"]) {
    const raw = transfer.getData(type);
    if (!raw) continue;
    try {
      return JSON.parse(raw);
    } catch (_error) {
      continue;
    }
  }

  return null;
}

function couldContainFoundryDropData(event) {
  const types = Array.from(event.dataTransfer?.types ?? []);
  return types.includes("text/plain") || types.includes("application/json");
}

function pointerToPercent(event) {
  const viewport = currentViewport();
  return {
    x: screenToStageX(event.clientX, viewport),
    y: (event.clientY / viewport.height) * 100
  };
}

function currentViewport() {
  return {
    width: window.innerWidth || document.documentElement.clientWidth || 1,
    height: window.innerHeight || document.documentElement.clientHeight || 1
  };
}

function cardLayoutPosition(card, viewport) {
  const parse = (value, axisSize) => {
    if (!value) return null;
    const number = parseFloat(value);
    if (!Number.isFinite(number)) return null;
    return value.trim().endsWith("%") ? (number / 100) * axisSize : number;
  };

  return {
    left: parse(card.style.left, viewport.width),
    top: parse(card.style.top, viewport.height)
  };
}

function stageScale(viewport = currentViewport()) {
  const raw = viewport.height / STAGE_REFERENCE_HEIGHT;
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(STAGE_SCALE_MAX, Math.max(STAGE_SCALE_MIN, raw));
}

// Horizontal stage space: stored x percentages address a 1920px-wide virtual
// stage centered on the screen and scaled with the card size (viewport
// height). This keeps the distance between cards proportional to their size
// on every client; windows wider than the stage gain side margins instead of
// stretching the composition apart. On 16:9 windows it is identical to
// mapping percentages straight onto the viewport width.
function stageToScreenX(xPercent, viewport = currentViewport()) {
  const scale = stageScale(viewport);
  return ((xPercent / 100) * STAGE_REFERENCE_WIDTH - STAGE_REFERENCE_WIDTH / 2) * scale + viewport.width / 2;
}

function screenToStageX(px, viewport = currentViewport()) {
  const scale = stageScale(viewport);
  const refX = (px - viewport.width / 2) / scale + STAGE_REFERENCE_WIDTH / 2;
  return (refX / STAGE_REFERENCE_WIDTH) * 100;
}

function getFoundryUiBlockerRects(viewport = currentViewport()) {
  const rects = [];
  for (const selector of FOUNDRY_UI_SELECTORS) {
    const element = document.querySelector(selector);
    if (!element) continue;
    collectUiBlockerRects(element, viewport, rects, 0);
  }
  return rects;
}

export function debugFoundryUiBlockers(durationMs = 4000) {
  const rects = getFoundryUiBlockerRects();
  for (const rect of rects) {
    const marker = document.createElement("div");
    Object.assign(marker.style, {
      position: "fixed",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      background: "rgba(217, 88, 88, 0.22)",
      border: "1px solid rgba(217, 88, 88, 0.9)",
      boxSizing: "border-box",
      pointerEvents: "none",
      zIndex: "99999"
    });
    document.body.append(marker);
    setTimeout(() => marker.remove(), durationMs);
  }
  return rects;
}

function collectUiBlockerRects(element, viewport, rects, depth) {
  if (!(element instanceof Element)) return;
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  // Foundry wraps its UI regions in layout containers far larger than their
  // visible content. Blocking such a wrapper would freeze most of the stage,
  // so recurse into children when the box is non-interactive (pointer-events
  // passthrough) or mostly empty, and only block the rects of real content.
  const children = Array.from(element.children).filter((child) => child instanceof Element);
  const passthrough = style.pointerEvents === "none";

  if (depth >= 3 || !children.length) {
    if (!passthrough) rects.push(rect);
    return;
  }

  const coveredArea = children.reduce((total, child) => {
    const childRect = child.getBoundingClientRect();
    return total + Math.max(0, childRect.width) * Math.max(0, childRect.height);
  }, 0);
  const sparse = coveredArea < rect.width * rect.height * 0.55;

  if (!passthrough && !sparse) {
    rects.push(rect);
    return;
  }
  for (const child of children) collectUiBlockerRects(child, viewport, rects, depth + 1);
}

function clampRatio(value) {
  if (!Number.isFinite(value) || value <= 0) return PORTRAIT_IMAGE_RATIO;
  return Math.min(1.35, Math.max(0.62, value));
}

function clampSize(value) {
  if (!Number.isFinite(value)) return 190;
  return Math.min(360, Math.max(110, value));
}

function clampPosition(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(min, value), Math.max(min, max));
}

function snap(value, interval) {
  return Math.round(value / interval) * interval;
}

function snapPosition(position, viewport = currentViewport()) {
  const snappedX = snap(stageToScreenX(position.x, viewport), SNAP_POSITION_PIXELS);
  const snappedY = snap((position.y / 100) * viewport.height, SNAP_POSITION_PIXELS);

  return {
    x: screenToStageX(snappedX, viewport),
    y: (snappedY / viewport.height) * 100
  };
}

function participantIdFromDropData(dropData) {
  if (typeof dropData?.uuid === "string" && dropData.uuid) return dropData.uuid;
  if (typeof dropData?.id !== "string" || !dropData.id) return null;
  return dropData.id.startsWith("Actor.") ? dropData.id : `Actor.${dropData.id}`;
}

async function resolveParticipantActor(participant) {
  if (!participant) return null;
  if (participant.uuid && typeof globalThis.fromUuid === "function") {
    try {
      const document = await globalThis.fromUuid(participant.uuid);
      if (document?.documentName === "Actor" || document?.constructor?.documentName === "Actor") return document;
      if (document?.actor) return document.actor;
    } catch (_error) {
      return null;
    }
  }

  const actorId = typeof participant.id === "string" && participant.id.startsWith("Actor.")
    ? participant.id.slice("Actor.".length)
    : null;
  return actorId ? game.actors?.get(actorId) ?? null : null;
}

function compareParticipantsByName(a, b) {
  return String(a.name || "").localeCompare(String(b.name || ""), game.i18n?.lang || undefined, {
    sensitivity: "base",
    numeric: true
  });
}

function buildArrangement(layout, items, viewport) {
  if (layout === "column") return buildColumnArrangement(items, viewport);
  if (layout === "grid") return buildGridArrangement(items, viewport);
  return buildRowArrangement(items, viewport);
}

function buildRowArrangement(items, viewport) {
  const maxWidth = Math.max(...items.map((item) => item.width));
  const maxHeight = Math.max(...items.map((item) => item.height));
  const totalWidth = maxWidth * items.length + ARRANGE_GAP_PIXELS * Math.max(0, items.length - 1);
  let left = (viewport.width - totalWidth) / 2;
  const top = viewport.height * 0.58 - maxHeight / 2;

  return clampArrangement(items.map((item) => {
    const output = {
      ...item,
      left: left + (maxWidth - item.width) / 2,
      top: top + (maxHeight - item.height) / 2
    };
    left += maxWidth + ARRANGE_GAP_PIXELS;
    return output;
  }), viewport);
}

function buildColumnArrangement(items, viewport) {
  const maxWidth = Math.max(...items.map((item) => item.width));
  const maxHeight = Math.max(...items.map((item) => item.height));
  const totalHeight = maxHeight * items.length + ARRANGE_GAP_PIXELS * Math.max(0, items.length - 1);
  const left = (viewport.width - maxWidth) / 2;
  let top = (viewport.height - totalHeight) / 2;

  return clampArrangement(items.map((item) => {
    const output = {
      ...item,
      left: left + (maxWidth - item.width) / 2,
      top: top + (maxHeight - item.height) / 2
    };
    top += maxHeight + ARRANGE_GAP_PIXELS;
    return output;
  }), viewport);
}

function buildGridArrangement(items, viewport) {
  const columns = Math.min(2, items.length);
  const rows = Math.ceil(items.length / columns);
  const columnWidths = Array.from({ length: columns }, (_, column) => {
    return Math.max(...items.filter((_item, index) => index % columns === column).map((item) => item.width));
  });
  const rowHeights = Array.from({ length: rows }, (_, row) => {
    return Math.max(...items.slice(row * columns, row * columns + columns).map((item) => item.height));
  });
  const totalWidth = columnWidths.reduce((total, width) => total + width, 0) + ARRANGE_GAP_PIXELS * Math.max(0, columns - 1);
  const totalHeight = rowHeights.reduce((total, height) => total + height, 0) + ARRANGE_GAP_PIXELS * Math.max(0, rows - 1);
  const startX = (viewport.width - totalWidth) / 2;
  const startY = (viewport.height - totalHeight) / 2;

  return clampArrangement(items.map((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = startX + columnWidths.slice(0, column).reduce((total, width) => total + width + ARRANGE_GAP_PIXELS, 0);
    const top = startY + rowHeights.slice(0, row).reduce((total, height) => total + height + ARRANGE_GAP_PIXELS, 0);
    return {
      ...item,
      left: left + (columnWidths[column] - item.width) / 2,
      top: top + (rowHeights[row] - item.height) / 2
    };
  }), viewport);
}

function moveArrangementAwayFromBlockers(items, blockers, viewport) {
  const clamped = clampArrangement(items, viewport);
  const usable = (blockers || []).filter((rect) => rect && rect.width > 0 && rect.height > 0);
  if (!usable.length) return clamped;

  const entries = clamped.map((item) => ({
    id: item.id,
    rect: {
      left: item.left,
      top: item.top,
      right: item.left + item.width,
      bottom: item.top + item.height,
      width: item.width,
      height: item.height
    }
  }));
  const resolved = resolveRectsAwayFromBlockers(entries, usable, viewport, ARRANGE_GAP_PIXELS);
  if (!resolved) return clamped;

  const byId = new Map(resolved.map((entry) => [entry.id, entry.rect]));
  return clamped.map((item) => {
    const rect = byId.get(item.id);
    return rect ? { ...item, left: rect.left, top: rect.top } : item;
  });
}

function translateArrangement(items, x, y) {
  return items.map((item) => ({ ...item, left: item.left + x, top: item.top + y }));
}

function clampArrangement(items, viewport) {
  const bounds = arrangementBounds(items);
  const margin = 12;
  let offsetX = 0;
  let offsetY = 0;

  if (bounds.left < margin) offsetX = margin - bounds.left;
  if (bounds.right + offsetX > viewport.width - margin) offsetX = viewport.width - margin - bounds.right;
  if (bounds.top < margin) offsetY = margin - bounds.top;
  if (bounds.bottom + offsetY > viewport.height - margin) offsetY = viewport.height - margin - bounds.bottom;

  return translateArrangement(items, offsetX, offsetY);
}

function arrangementBounds(items) {
  return {
    left: Math.min(...items.map((item) => item.left)),
    top: Math.min(...items.map((item) => item.top)),
    right: Math.max(...items.map((item) => item.left + item.width)),
    bottom: Math.max(...items.map((item) => item.top + item.height))
  };
}

function resolveRectsAwayFromBlockers(entries, blockers, viewport, gap = COLLISION_GAP_PIXELS) {
  const initial = entries.map((entry) => ({ id: entry.id, rect: copyRect(entry.rect) }));
  const blockerRects = blockers.map(copyRect).filter((rect) => rect.width > 0 && rect.height > 0);
  if (!blockerRects.length || rectEntriesClearBlockers(initial, blockerRects, gap)) return initial;

  const validCandidates = [];
  let frontier = [{ entries: initial }];
  const seen = new Set([rectEntriesKey(initial)]);

  for (let depth = 0; depth < 4; depth += 1) {
    const next = [];

    for (const state of frontier) {
      const overlaps = rectBlockerOverlaps(state.entries, blockerRects, gap);
      for (const overlap of overlaps.slice(0, 8)) {
        for (const shift of rectSeparationShifts(overlap.entry.rect, overlap.blocker, gap)) {
          const moved = clampRectEntriesToViewport(translateRectEntries(state.entries, shift.dx, shift.dy), viewport);
          const key = rectEntriesKey(moved);
          if (seen.has(key)) continue;
          seen.add(key);

          if (rectEntriesClearBlockers(moved, blockerRects, gap)) validCandidates.push(moved);
          else next.push({ entries: moved });
        }
      }
    }

    if (validCandidates.length) return bestRectCandidate(validCandidates, initial);
    frontier = next
      .sort((a, b) => rectEntryShiftScore(a.entries, initial) - rectEntryShiftScore(b.entries, initial))
      .slice(0, 48);
  }

  return null;
}

function nearestFreeRectEntries(entries, blockers, viewport, gap = COLLISION_GAP_PIXELS) {
  const step = 16;
  const maxRadius = Math.max(viewport.width, viewport.height);

  const attempt = (dx, dy) => {
    const moved = translateRectEntries(entries, dx, dy);
    const bounds = rectEntryBounds(moved);
    if (bounds.left < 0 || bounds.top < 0 || bounds.right > viewport.width || bounds.bottom > viewport.height) return null;
    return rectEntriesClearBlockers(moved, blockers, gap) ? moved : null;
  };

  for (let radius = step; radius <= maxRadius; radius += step) {
    const offsets = [];
    for (let dx = -radius; dx <= radius; dx += step) {
      offsets.push([dx, -radius], [dx, radius]);
    }
    for (let dy = -radius + step; dy <= radius - step; dy += step) {
      offsets.push([-radius, dy], [radius, dy]);
    }
    offsets.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]));

    for (const [dx, dy] of offsets) {
      const moved = attempt(dx, dy);
      if (moved) return moved;
    }
  }

  return null;
}

function rectBlockerOverlaps(entries, blockers, gap) {
  const overlaps = [];
  for (const entry of entries) {
    for (const blocker of blockers) {
      if (rectanglesOverlap(entry.rect, blocker, gap)) overlaps.push({ entry, blocker });
    }
  }
  return overlaps;
}

function rectEntriesClearBlockers(entries, blockers, gap) {
  return !rectBlockerOverlaps(entries, blockers, gap).length;
}

function rectSeparationShifts(rect, blocker, gap) {
  return [
    { dx: blocker.left - gap - rect.right, dy: 0 },
    { dx: blocker.right + gap - rect.left, dy: 0 },
    { dx: 0, dy: blocker.top - gap - rect.bottom },
    { dx: 0, dy: blocker.bottom + gap - rect.top }
  ]
    .filter((shift) => Math.abs(shift.dx) > 0.5 || Math.abs(shift.dy) > 0.5)
    .sort((a, b) => (Math.abs(a.dx) + Math.abs(a.dy)) - (Math.abs(b.dx) + Math.abs(b.dy)));
}

function translateRectEntries(entries, dx, dy) {
  return entries.map((entry) => ({ id: entry.id, rect: translateRect(entry.rect, dx, dy) }));
}

function translateRect(rect, dx, dy) {
  return {
    left: rect.left + dx,
    top: rect.top + dy,
    right: rect.right + dx,
    bottom: rect.bottom + dy,
    width: rect.width,
    height: rect.height
  };
}

function clampRectEntriesToViewport(entries, viewport) {
  const bounds = rectEntryBounds(entries);
  let dx = 0;
  let dy = 0;

  if (bounds.left < 0) dx = -bounds.left;
  if (bounds.right + dx > viewport.width) dx += viewport.width - (bounds.right + dx);
  if (bounds.top < 0) dy = -bounds.top;
  if (bounds.bottom + dy > viewport.height) dy += viewport.height - (bounds.bottom + dy);

  return dx || dy ? translateRectEntries(entries, dx, dy) : entries;
}

function rectEntryBounds(entries) {
  return {
    left: Math.min(...entries.map((entry) => entry.rect.left)),
    top: Math.min(...entries.map((entry) => entry.rect.top)),
    right: Math.max(...entries.map((entry) => entry.rect.right)),
    bottom: Math.max(...entries.map((entry) => entry.rect.bottom))
  };
}

function bestRectCandidate(candidates, initial) {
  return candidates
    .slice()
    .sort((a, b) => rectEntryShiftScore(a, initial) - rectEntryShiftScore(b, initial))[0];
}

function rectEntryShiftScore(entries, initial) {
  const dx = entries[0].rect.left - initial[0].rect.left;
  const dy = entries[0].rect.top - initial[0].rect.top;
  return dx * dx + dy * dy;
}

function rectEntriesKey(entries) {
  return entries
    .map((entry) => `${entry.id}:${Math.round(entry.rect.left)}:${Math.round(entry.rect.top)}`)
    .join("|");
}

function copyRect(rect) {
  const left = Number(rect.left) || 0;
  const top = Number(rect.top) || 0;
  const width = Number(rect.width) || Math.max(0, (Number(rect.right) || left) - left);
  const height = Number(rect.height) || Math.max(0, (Number(rect.bottom) || top) - top);
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height
  };
}

function rectFromPositionAndSize(position, size, viewport) {
  const left = stageToScreenX(position.x, viewport);
  const top = (position.y / 100) * viewport.height;

  return {
    left,
    top,
    right: left + size.width,
    bottom: top + size.height,
    width: size.width,
    height: size.height
  };
}

function projectedMoveRect(card, position) {
  const current = card.getBoundingClientRect();
  const viewport = {
    width: window.innerWidth || document.documentElement.clientWidth || 1,
    height: window.innerHeight || document.documentElement.clientHeight || 1
  };
  const left = stageToScreenX(position.x, viewport);
  const top = (position.y / 100) * viewport.height;

  return {
    left,
    top,
    right: left + current.width,
    bottom: top + current.height,
    width: current.width,
    height: current.height
  };
}

function projectedRectFromPosition(baseRect, position, viewport) {
  const left = stageToScreenX(position.x, viewport);
  const top = (position.y / 100) * viewport.height;

  return {
    left,
    top,
    right: left + baseRect.width,
    bottom: top + baseRect.height,
    width: baseRect.width,
    height: baseRect.height
  };
}

function projectedResizeRect(card, sizePx, viewport = currentViewport()) {
  // Project in layout space (inline left/top + intrinsic dimensions) so the
  // result is not skewed by visual-only transforms such as the speaker zoom.
  const layout = cardLayoutPosition(card, viewport);
  const current = card.getBoundingClientRect();
  const left = layout.left ?? current.left;
  const top = layout.top ?? current.top;
  const ratio = parseFloat(getComputedStyle(card).getPropertyValue("--character-show-image-ratio")) || PORTRAIT_IMAGE_RATIO;
  const width = Math.min(sizePx * ratio, viewport.width - 24);
  const height = sizePx;

  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height
  };
}

function projectedControlsRect(startRect, position) {
  return {
    left: position.x,
    top: position.y,
    right: position.x + startRect.width,
    bottom: position.y + startRect.height,
    width: startRect.width,
    height: startRect.height
  };
}

function rectanglesOverlap(a, b, gap = 0) {
  return !(
    a.right + gap <= b.left ||
    a.left >= b.right + gap ||
    a.bottom + gap <= b.top ||
    a.top >= b.bottom + gap
  );
}
