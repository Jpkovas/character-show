import assert from "node:assert/strict";
import { chromium } from "playwright";
import { HARNESS_PATH, startHarnessServer } from "./serve-overlay-harness.mjs";

const server = await startHarnessServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error));

try {
  await page.goto(`http://127.0.0.1:${server.address().port}${HARNESS_PATH}`, {
    waitUntil: "networkidle"
  });
  await page.waitForSelector("body[data-ready='true']");

  const cardCount = await page.locator(".character-show-card").count();
  assert.equal(cardCount, 3);

  await assertVisibleText(page, "Character Show");
  await assertVisibleText(page, "Alpha");
  await assertVisibleText(page, "Speaking");
  await assertVisibleText(page, "Shrink");
  await assertVisibleText(page, "Grow");
  await assertVisibleText(page, "Minimize");

  const snapButton = page.getByRole("button", { name: "Snap" });
  await snapButton.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(60);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Snap", "toolbar actions should keep keyboard focus after rerendering");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(60);

  const hoveredPalette = await arrangePaletteMetrics(page, "hover");
  assert.equal(hoveredPalette.visible, false, "arrange palette should not open from hover alone");
  const arrangePalette = await arrangePaletteMetrics(page, "click");
  assert.equal(arrangePalette.visible, true, "expanded toolbar should reveal the arrange palette on click");
  assert.equal(arrangePalette.optionCount, 3, "arrange palette should keep the three layout choices available");
  assert.ok(arrangePalette.panelTop >= arrangePalette.controlsBottom + 6, "arrange palette should open below the full expanded toolbar");
  assert.ok(Math.abs(arrangePalette.panelCenterX - arrangePalette.triggerCenterX) <= 2, "expanded arrange palette should stay centered on the arrange button");
  assert.equal(arrangePalette.panelInsideViewport, true, "expanded arrange palette should stay within the viewport");
  assert.equal(arrangePalette.paletteReceivesPointer, true, "expanded arrange palette should render above portraits and receive pointer input");
  assert.equal(arrangePalette.buttonsFillPanel, true, "arrange palette buttons should fill the visual panel instead of keeping toolbar button widths");
  assert.ok(arrangePalette.buttonLabels.every(Boolean), "arrange palette option labels should remain visible");
  assert.ok(arrangePalette.maxWidths.every((value) => value === "none"), "arrange palette options should not inherit the toolbar max-width rule");
  await closeArrangePalette(page);
  assert.equal((await currentArrangePaletteState(page)).visible, false, "arrange palette should close when clicking outside");
  await arrangePaletteMetrics(page, "click");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(60);
  assert.equal((await currentArrangePaletteState(page)).visible, false, "arrange palette should close on Escape");
  await arrangePaletteMetrics(page, "click");
  await page.getByRole("button", { name: "2x2 grid" }).click();
  await page.waitForTimeout(160);
  assert.equal((await currentArrangePaletteState(page)).visible, false, "arrange palette should close after choosing a layout");
  const arrangedPositions = await stagePositions(page, ["Actor.alpha", "Actor.beta", "Actor.gamma"]);
  assert.notDeepEqual(arrangedPositions, {
    "Actor.alpha": { x: 12, y: 22 },
    "Actor.beta": { x: 36, y: 74 },
    "Actor.gamma": { x: 60, y: 34 }
  }, "choosing an arrange layout should update portrait positions");
  await resetHarnessState(page);

  await page.getByRole("button", { name: "Collapse" }).click();
  await page.waitForTimeout(160);
  const collapsedArrangePalette = await arrangePaletteMetrics(page, "click");
  assert.equal(collapsedArrangePalette.visible, true, "collapsed toolbar should open the arrange palette on click");
  assert.ok(collapsedArrangePalette.panelTop >= collapsedArrangePalette.controlsBottom + 6, "collapsed arrange palette should open below the full collapsed toolbar");
  assert.ok(Math.abs(collapsedArrangePalette.panelCenterX - collapsedArrangePalette.triggerCenterX) <= 2, "collapsed arrange palette should stay centered on the arrange button");
  assert.equal(collapsedArrangePalette.panelInsideViewport, true, "collapsed arrange palette should stay within the viewport");
  assert.equal(collapsedArrangePalette.paletteReceivesPointer, true, "collapsed arrange palette should render above portraits and receive pointer input");
  await closeArrangePalette(page);

  await page.setViewportSize({ width: 390, height: 680 });
  await page.waitForTimeout(260);
  await page.waitForTimeout(180);
  const narrowCollapsedArrangePalette = await arrangePaletteMetrics(page, "click");
  assert.equal(narrowCollapsedArrangePalette.visible, true, "narrow collapsed toolbar should open the arrange palette on click");
  assert.ok(narrowCollapsedArrangePalette.panelTop >= narrowCollapsedArrangePalette.controlsBottom + 6, "narrow collapsed arrange palette should open below the full toolbar");
  assert.ok(Math.abs(narrowCollapsedArrangePalette.panelCenterX - narrowCollapsedArrangePalette.triggerCenterX) <= 2, "narrow collapsed arrange palette should stay centered on the arrange button");
  assert.equal(narrowCollapsedArrangePalette.panelInsideViewport, true, "narrow collapsed arrange palette should stay within the viewport");
  assert.equal(narrowCollapsedArrangePalette.paletteReceivesPointer, true, "narrow collapsed arrange palette should render above portraits and receive pointer input");
  await closeArrangePalette(page);

  const miniatureParticipants = Array.from({ length: 20 }, (_, index) => ({
    id: `Actor.mini-${index}`,
    uuid: `Actor.mini-${index}`,
    name: `Mini ${index}`,
    image: "icons/svg/mystery-man.svg",
    showName: true,
    flipped: false,
    x: 5 + index * 4,
    y: 34,
    size: 140,
    z: 10 + index
  }));
  await resetHarnessState(page, { participants: miniatureParticipants, speakerId: null, stageMinimized: true, controlsCollapsed: true });
  const miniatureDockMetrics = await page.locator("[data-mini-dock]").evaluate((dock) => {
    const buttons = Array.from(dock.querySelectorAll(".character-show-mini"));
    return {
      minButtonWidth: Math.min(...buttons.map((button) => button.getBoundingClientRect().width)),
      scrollable: dock.scrollWidth > dock.clientWidth
    };
  });
  assert.ok(miniatureDockMetrics.minButtonWidth >= 43, "minimized portraits should keep usable target sizes");
  assert.equal(miniatureDockMetrics.scrollable, true, "large minimized casts should remain reachable by scrolling");
  await page.locator("[data-mini-dock]").evaluate((dock) => {
    dock.scrollLeft = dock.scrollWidth;
  });
  await page.locator("[data-mini-participant-id='Actor.mini-19']").click();
  const miniatureDockAfterClick = await page.locator("[data-mini-dock]").evaluate((dock) => {
    const focused = document.activeElement;
    const dockRect = dock.getBoundingClientRect();
    const focusedRect = focused?.getBoundingClientRect();
    return {
      scrollLeft: dock.scrollLeft,
      focusedId: focused?.dataset.miniParticipantId || null,
      focusedVisible: Boolean(focusedRect && focusedRect.left >= dockRect.left && focusedRect.right <= dockRect.right)
    };
  });
  assert.ok(miniatureDockAfterClick.scrollLeft > 0, "clicking a scrolled miniature should preserve the dock position");
  assert.equal(miniatureDockAfterClick.focusedId, "Actor.mini-19", "the activated miniature should keep keyboard focus");
  assert.equal(miniatureDockAfterClick.focusedVisible, true, "the focused miniature should remain visible after rerendering");

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(280);
  await resetHarnessState(page, { controlsCollapsed: true });
  await page.getByRole("button", { name: "Expand" }).click();
  await page.waitForTimeout(160);

  const toolbarBox = await page.locator("[data-controls]").boundingBox();
  assert.ok(toolbarBox.height <= 82, "expanded toolbar should stay compact and use grouped wrapping only when needed");

  const outsideDragAccepted = await page.evaluate(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("application/json", JSON.stringify({ type: "Actor", id: "drop-test" }));
    return document.dispatchEvent(new DragEvent("dragover", {
      bubbles: true,
      cancelable: true,
      clientX: 24,
      clientY: 24,
      dataTransfer
    }));
  });
  assert.equal(outsideDragAccepted, true, "dragover outside the centered drop target should not claim the whole document");

  const dropTarget = page.locator("[data-drop-target]");
  const dropBox = await dropTarget.boundingBox();
  const insideDragAccepted = await page.evaluate(({ x, y }) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("application/json", JSON.stringify({ type: "Actor", id: "drop-test" }));
    return document.dispatchEvent(new DragEvent("dragover", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      dataTransfer
    }));
  }, { x: dropBox.x + dropBox.width / 2, y: dropBox.y + dropBox.height / 2 });
  assert.equal(insideDragAccepted, false, "dragover inside the drop target should accept actor drops");
  await page.waitForTimeout(180);
  const dropTargetState = await dropTarget.evaluate((target) => {
    const style = getComputedStyle(target);
    const rect = target.getBoundingClientRect();
    return {
      opacity: Number(style.opacity),
      width: rect.width,
      height: rect.height,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2
    };
  });
  assert.ok(dropTargetState.opacity > 0.9, "drop target should be visible during actor drag");
  assert.ok(dropTargetState.width >= 480 && dropTargetState.width <= 505, "drop target should be another 20% larger while staying compact");
  assert.ok(dropTargetState.height >= 99 && dropTargetState.height <= 125, "drop target should be another 20% taller without becoming full-screen");
  assert.ok(Math.abs(dropTargetState.centerX - 960) < 8, "drop target should be centered horizontally");
  assert.ok(Math.abs(dropTargetState.centerY - 540) < 8, "drop target should be centered vertically");
  await page.evaluate(() => document.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true })));
  await page.waitForTimeout(80);

  await resetHarnessState(page, {
    participants: [
      { id: "Actor.alpha", uuid: "Actor.alpha", name: "Alpha", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 45, y: 34, size: 190, z: 11 }
    ]
  });
  await page.evaluate(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("application/json", JSON.stringify({ type: "Actor", id: "delta", name: "Payload name" }));
    document.dispatchEvent(new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      clientX: window.innerWidth / 2,
      clientY: window.innerHeight / 2,
      dataTransfer
    }));
  });
  await page.waitForFunction(() => {
    return globalThis.characterShowHarness.store.stage.participants.some((entry) => entry.id === "Actor.delta");
  });
  assert.equal(await cardsOverlap(page, "Actor.alpha", "Actor.delta"), false, "dropping a new actor over an existing portrait should place it beside the blocker");
  assert.equal(
    await page.evaluate(() => globalThis.characterShowHarness.store.stage.participants.find((entry) => entry.id === "Actor.delta")?.name),
    "Delta",
    "a dropped actor is resolved through Foundry, not taken from the drop payload"
  );

  await resetHarnessState(page, {
    participants: [
      { id: "Actor.alpha", uuid: "Actor.alpha", name: "Alpha", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 10, y: 34, size: 140, z: 11 },
      { id: "Actor.beta", uuid: "Actor.beta", name: "Beta", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 32, y: 34, size: 140, z: 12 },
      { id: "Actor.gamma", uuid: "Actor.gamma", name: "Gamma", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 54, y: 34, size: 140, z: 13 }
    ]
  });
  await selectParticipant(page, "Actor.beta");
  await selectParticipant(page, "Actor.gamma");
  await assertVisibleText(page, "2 selected");
  const toolbarAfterSelection = await page.locator("[data-controls]").boundingBox();
  assert.ok(Math.abs(toolbarAfterSelection.width - toolbarBox.width) < 1, "main toolbar width should not change when actors are selected");
  assert.ok(Math.abs(toolbarAfterSelection.height - toolbarBox.height) < 1, "main toolbar height should not change when actors are selected");
  let dockPlacement = await selectionDockPlacement(page, ["Actor.beta", "Actor.gamma"]);
  assert.ok(Math.abs(dockPlacement.dockCenterX - dockPlacement.selectionCenterX) < 8, "selection dock should be centered under selected actors");
  assert.ok(dockPlacement.dockTop >= dockPlacement.selectionBottom + 8, "selection dock should sit low and close to selected actors");
  assert.equal(await selectionDockControlsFillContainer(page), true, "selection dock buttons should fill the visual container evenly");
  await page.getByRole("button", { name: "Grow sel." }).click();
  const selectedSizes = await page.evaluate(() => {
    const participants = globalThis.characterShowHarness.store.stage.participants;
    return [
      participants.find((entry) => entry.id === "Actor.beta").size,
      participants.find((entry) => entry.id === "Actor.gamma").size
    ];
  });
  assert.deepEqual(selectedSizes, [156, 156]);
  const betaToolsFit = await participantToolsFitInsideCard(page, "Actor.beta");
  assert.equal(betaToolsFit, true, "actor action buttons should stay inside the portrait box");
  const dockBeforeDrag = await page.locator("[data-selection-dock]").boundingBox();

  const selectedBeforeDrag = await stagePositions(page, ["Actor.alpha", "Actor.beta", "Actor.gamma"]);
  const betaRect = await page.locator("[data-participant-id='Actor.beta']").boundingBox();
  await page.mouse.move(betaRect.x + betaRect.width / 2, betaRect.y + 96);
  await page.mouse.down();
  await page.mouse.move(betaRect.x + betaRect.width / 2 + 58, betaRect.y + 106);
  const liveDrag = await page.evaluate(() => {
    const card = document.querySelector("[data-participant-id='Actor.beta']");
    const dock = document.querySelector("[data-selection-dock]");
    const cardRect = card.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();
    const style = getComputedStyle(card);
    return {
      cardLeft: cardRect.left,
      dockLeft: dockRect.left,
      transitionDuration: style.transitionDuration,
      transitionProperty: style.transitionProperty
    };
  });
  assert.equal(liveDrag.transitionDuration, "0s", "selected group drag should not animate left/top behind the pointer");
  assert.ok(liveDrag.cardLeft > betaRect.x + 40, "selected card should move promptly before pointerup");
  assert.ok(liveDrag.dockLeft > dockBeforeDrag.x + 25, "selection dock should follow while dragging, before pointerup");
  await page.mouse.move(betaRect.x + betaRect.width / 2 + 100, betaRect.y + 114);
  await page.mouse.up();
  const selectedAfterDrag = await stagePositions(page, ["Actor.alpha", "Actor.beta", "Actor.gamma"]);
  assert.ok(selectedAfterDrag["Actor.beta"].x > selectedBeforeDrag["Actor.beta"].x + 4, "selected drag should move the grabbed portrait");
  assert.ok(selectedAfterDrag["Actor.gamma"].x > selectedBeforeDrag["Actor.gamma"].x + 4, "selected drag should move the other selected portrait");
  assert.equal(selectedAfterDrag["Actor.alpha"].x, selectedBeforeDrag["Actor.alpha"].x, "unselected portraits should not move with the group");
  const dockAfterDrag = await page.locator("[data-selection-dock]").boundingBox();
  assert.ok(dockAfterDrag.x > dockBeforeDrag.x + 40, "selection dock should follow selected actors while they move");

  await resetHarnessState(page, {
    participants: [
      { id: "Actor.alpha", uuid: "Actor.alpha", name: "Alpha", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 10, y: 42, size: 170, z: 11 },
      { id: "Actor.beta", uuid: "Actor.beta", name: "Beta", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 32, y: 42, size: 170, z: 12 },
      { id: "Actor.gamma", uuid: "Actor.gamma", name: "Gamma", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 72, y: 42, size: 170, z: 13 }
    ]
  });
  const alphaBeforeFreeDrag = await page.locator("[data-participant-id='Actor.alpha']").boundingBox();
  const betaBeforeFreeDrag = await page.locator("[data-participant-id='Actor.beta']").boundingBox();
  await page.mouse.move(alphaBeforeFreeDrag.x + alphaBeforeFreeDrag.width / 2, alphaBeforeFreeDrag.y + 90);
  await page.mouse.down();
  await page.mouse.move(betaBeforeFreeDrag.x + betaBeforeFreeDrag.width / 2, betaBeforeFreeDrag.y + 90);
  assert.equal(await cardsOverlap(page, "Actor.alpha", "Actor.beta"), true, "dragging should allow a portrait to pass over another portrait before release");
  await page.mouse.up();
  await page.waitForTimeout(620);
  assert.equal(await cardsOverlap(page, "Actor.alpha", "Actor.beta"), false, "releasing a dragged portrait over another portrait should resolve to a non-overlapping position");

  await resetHarnessState(page, {
    syncOrganization: false,
    participants: [
      { id: "Actor.alpha", uuid: "Actor.alpha", name: "Alpha", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 16, y: 24, size: 150, z: 11 },
      { id: "Actor.beta", uuid: "Actor.beta", name: "Beta", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 45, y: 24, size: 150, z: 12 }
    ]
  });
  const unsyncedBefore = await stagePositions(page, ["Actor.alpha"]);
  const alphaRect = await page.locator("[data-participant-id='Actor.alpha']").boundingBox();
  await page.mouse.move(alphaRect.x + alphaRect.width / 2, alphaRect.y + 96);
  await page.mouse.down();
  await page.mouse.move(alphaRect.x + alphaRect.width / 2 + 90, alphaRect.y + 146);
  await page.mouse.up();
  const unsyncedAfter = await page.evaluate(() => {
    const store = globalThis.characterShowHarness.store;
    const stageAlpha = store.stage.participants.find((entry) => entry.id === "Actor.alpha");
    return {
      stage: { x: stageAlpha.x, y: stageAlpha.y },
      local: store.local.participants["Actor.alpha"]
    };
  });
  assert.deepEqual(unsyncedAfter.stage, unsyncedBefore["Actor.alpha"], "disabled organization sync should not persist GM movement to the shared stage");
  assert.ok(unsyncedAfter.local.x > unsyncedBefore["Actor.alpha"].x + 4, "disabled organization sync should keep GM movement locally");

  await page.getByRole("button", { name: "Minimize" }).click();
  const minimizedState = await page.evaluate(() => {
    const store = globalThis.characterShowHarness.store;
    return {
      localMinimized: store.local.stageMinimized,
      stageCollapsed: store.stage.collapsed
    };
  });
  assert.equal(minimizedState.localMinimized, true);
  assert.equal(minimizedState.stageCollapsed, false);
  await page.waitForTimeout(120);

  const minimizedToolbarBeforeDrag = await toolbarMiniDockAlignment(page);
  assert.ok(Math.abs(minimizedToolbarBeforeDrag.centerDeltaX) < 2, "minimized actors should start centered under the toolbar");
  assert.ok(Math.abs(minimizedToolbarBeforeDrag.gapY - 8) < 2, "minimized actors should start close under the toolbar");

  const minimizedToolbarBox = await page.locator("[data-controls]").boundingBox();
  await page.mouse.move(minimizedToolbarBox.x + 24, minimizedToolbarBox.y + minimizedToolbarBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(minimizedToolbarBox.x + 184, minimizedToolbarBox.y + minimizedToolbarBox.height / 2 + 72);
  await page.waitForTimeout(20);
  const minimizedToolbarDuringDrag = await toolbarMiniDockAlignment(page);
  assert.equal(minimizedToolbarDuringDrag.dragging, true, "toolbar drag should expose a live dragging state");
  assert.ok(Math.abs(minimizedToolbarDuringDrag.centerDeltaX) < 2, "minimized actors should stay centered under the toolbar during drag");
  assert.ok(Math.abs(minimizedToolbarDuringDrag.gapY - minimizedToolbarBeforeDrag.gapY) < 2, "minimized actors should keep the same vertical gap during drag");
  await page.mouse.up();
  await page.waitForTimeout(180);
  const minimizedToolbarAfterDrag = await toolbarMiniDockAlignment(page);
  assert.equal(minimizedToolbarAfterDrag.dragging, false, "toolbar drag state should clear after release");
  assert.ok(Math.abs(minimizedToolbarAfterDrag.centerDeltaX) < 2, "minimized actors should stay centered under the toolbar after drag");
  assert.ok(Math.abs(minimizedToolbarAfterDrag.gapY - minimizedToolbarBeforeDrag.gapY) < 2, "minimized actors should keep the same vertical gap after drag");

  await resetHarnessState(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(260);
  await resetHarnessState(page, {
    participants: [
      { id: "Actor.alpha", uuid: "Actor.alpha", name: "Alpha", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 20, y: 40, size: 170, z: 11 }
    ]
  });
  const wideViewportBeforeDrag = await page.locator("[data-participant-id='Actor.alpha']").boundingBox();
  await page.mouse.move(wideViewportBeforeDrag.x + wideViewportBeforeDrag.width / 2, wideViewportBeforeDrag.y + 80);
  await page.mouse.down();
  await page.mouse.move(wideViewportBeforeDrag.x + wideViewportBeforeDrag.width / 2 + 60, wideViewportBeforeDrag.y + 80);
  const wideViewportDuringDrag = await page.locator("[data-participant-id='Actor.alpha']").boundingBox();
  assert.ok(Math.abs(wideViewportDuringDrag.x - wideViewportBeforeDrag.x - 60) < 3, "live drag should stay under the pointer on non-16:9 viewports");
  await page.mouse.up();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(280);
  await resetHarnessState(page);

  const before = await page.locator("[data-participant-id='Actor.alpha']").boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + 96);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 120, before.y + 146);
  await page.mouse.up();
  const after = await page.locator("[data-participant-id='Actor.alpha']").boundingBox();

  assert.ok(after.x > before.x + 60, "drag should move the card horizontally");
  assert.ok(after.y > before.y + 25, "drag should move the card vertically");

  const savedBetaBeforeResize = await page.evaluate(() => {
    const beta = globalThis.characterShowHarness.store.stage.participants.find((entry) => entry.id === "Actor.beta");
    return { x: beta.x, y: beta.y };
  });
  await page.setViewportSize({ width: 720, height: 300 });
  await page.waitForTimeout(260);
  const savedBetaAfterResize = await page.evaluate(() => {
    const beta = globalThis.characterShowHarness.store.stage.participants.find((entry) => entry.id === "Actor.beta");
    return { x: beta.x, y: beta.y };
  });
  assert.deepEqual(savedBetaAfterResize, savedBetaBeforeResize, "viewport clamping should not persist stage positions");

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(280);
  await page.evaluate(() => {
    globalThis.characterShowHarness.nameAnimations = [];
    document.addEventListener("animationstart", (event) => {
      if (event.animationName === "characterShowNamePop") {
        globalThis.characterShowHarness.nameAnimations.push(event.target.textContent.trim());
      }
    }, { capture: true });
  });
  await toggleName(page, "Actor.beta");
  await page.waitForTimeout(320);

  const revealedNames = await page.evaluate(() => globalThis.characterShowHarness.nameAnimations);
  assert.ok(revealedNames.length >= 1, "the toggled actor should run a name reveal animation");
  assert.ok(revealedNames.every((name) => name === "Beta"), "only the toggled actor name should run the reveal animation");

  await page.evaluate(() => {
    const store = globalThis.characterShowHarness.store;
    const nextStage = {
      version: 1,
      collapsed: false,
      showNames: true,
      speakerId: null,
      layoutRevision: 0,
      speakerRevision: 0,
      participants: [
        { id: "Actor.alpha", uuid: "Actor.alpha", name: "Alpha", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 42, y: 6, size: 180, z: 11 },
        { id: "Actor.beta", uuid: "Actor.beta", name: "Beta", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 42, y: 37, size: 180, z: 12 },
        { id: "Actor.gamma", uuid: "Actor.gamma", name: "Gamma", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 42, y: 64, size: 180, z: 13 }
      ]
    };
    return globalThis.characterShowHarness.write("globalState", nextStage);
  });
  await page.waitForTimeout(450);

  const gammaBeforeMiddleToggles = await participantY(page, "Actor.gamma");
  await toggleName(page, "Actor.beta");
  await page.waitForTimeout(180);
  const gammaAfterMiddleHide = await participantY(page, "Actor.gamma");
  assert.ok(Math.abs(gammaAfterMiddleHide - gammaBeforeMiddleToggles) < 0.5, "hiding the middle name should not move the lower actor");
  await toggleName(page, "Actor.beta");
  await page.waitForTimeout(220);
  const gammaAfterMiddleShow = await participantY(page, "Actor.gamma");
  assert.ok(Math.abs(gammaAfterMiddleShow - gammaBeforeMiddleToggles) < 0.5, "showing the middle name should not move the lower actor");
  assert.equal(await cardsOverlap(page, "Actor.beta", "Actor.gamma"), false, "stacked portraits should not overlap after revealing a name");

  const namePlacement = await page.evaluate(() => {
    const card = document.querySelector('[data-participant-id="Actor.beta"]');
    const portrait = card.querySelector(".character-show-card-image");
    const name = card.querySelector(".character-show-name");
    const cardRect = card.getBoundingClientRect();
    const portraitRect = portrait.getBoundingClientRect();
    const nameRect = name?.getBoundingClientRect();
    return {
      hasName: Boolean(name),
      nameInsidePortrait: Boolean(nameRect)
        && nameRect.top >= portraitRect.top - 0.5
        && nameRect.bottom <= portraitRect.bottom + 0.5
        && nameRect.left >= portraitRect.left - 0.5
        && nameRect.right <= portraitRect.right + 0.5,
      cardMatchesPortrait: Math.abs(cardRect.height - portraitRect.height) < 0.5
    };
  });
  assert.equal(namePlacement.hasName, true, "the revealed name should render a nameplate");
  assert.equal(namePlacement.nameInsidePortrait, true, "the nameplate should stay inside the portrait frame");
  assert.equal(namePlacement.cardMatchesPortrait, true, "showing a name should not change the card footprint");

  await page.evaluate(() => {
    const store = globalThis.characterShowHarness.store;
    const nextStage = {
      ...store.stage,
      participants: [
        { id: "Actor.alpha", uuid: "Actor.alpha", name: "Alpha", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 10, y: 10, size: 150, z: 11 },
        { id: "Actor.beta", uuid: "Actor.beta", name: "Beta", image: "icons/svg/mystery-man.svg", showName: false, flipped: false, x: 42, y: 10, size: 150, z: 12 },
        { id: "Actor.gamma", uuid: "Actor.gamma", name: "Gamma", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 74, y: 10, size: 150, z: 13 }
      ]
    };
    return globalThis.characterShowHarness.write("globalState", nextStage);
  });
  await page.waitForTimeout(180);
  const noOverlapBeforeReveal = await participantY(page, "Actor.gamma");
  await toggleName(page, "Actor.beta");
  await page.waitForTimeout(220);
  const noOverlapAfterReveal = await participantY(page, "Actor.gamma");
  assert.ok(Math.abs(noOverlapAfterReveal - noOverlapBeforeReveal) < 0.5, "revealing a name should not move other actors when there is no overlap");

  await page.evaluate(() => {
    const store = globalThis.characterShowHarness.store;
    const nextStage = {
      ...store.stage,
      participants: store.stage.participants.map((entry, index) => ({
        ...entry,
        showName: true,
        y: [6, 37, 64][index]
      }))
    };
    return globalThis.characterShowHarness.write("globalState", nextStage);
  });
  await page.waitForTimeout(450);
  await toggleName(page, "Actor.gamma");
  await page.waitForTimeout(220);
  const lowerAfterHide = await participantY(page, "Actor.gamma");
  assert.ok(Math.abs(lowerAfterHide - 64) < 0.5, "hiding the lower name should not pull it toward the middle actor");

  const squareGridSnap = await page.evaluate(async () => {
    const store = globalThis.characterShowHarness.store;
    await globalThis.characterShowHarness.write("localState", { ...store.local, snapToGrid: true });
    const snapped = globalThis.characterShowHarness.overlay.applySnapToPosition({ x: 17.3, y: 17.3 });
    return {
      xPixels: (snapped.x / 100) * window.innerWidth,
      yPixels: (snapped.y / 100) * window.innerHeight
    };
  });
  assert.equal(Math.round(squareGridSnap.xPixels) % 24, 0, "snap grid should align x to a 24px cell");
  assert.equal(Math.round(squareGridSnap.yPixels) % 24, 0, "snap grid should align y to the same 24px cell");

  await resetHarnessState(page);
  const scaleProbeBefore = await page.evaluate(() => {
    const card = document.querySelector("[data-participant-id='Actor.beta']");
    const beta = globalThis.characterShowHarness.store.stage.participants.find((entry) => entry.id === "Actor.beta");
    return { width: card.getBoundingClientRect().width, stored: { x: beta.x, y: beta.y, size: beta.size } };
  });
  await page.setViewportSize({ width: 960, height: 540 });
  await page.waitForTimeout(820);
  const scaleProbeAfter = await page.evaluate(() => {
    const card = document.querySelector("[data-participant-id='Actor.beta']");
    const beta = globalThis.characterShowHarness.store.stage.participants.find((entry) => entry.id === "Actor.beta");
    return { width: card.getBoundingClientRect().width, stored: { x: beta.x, y: beta.y, size: beta.size } };
  });
  assert.ok(
    Math.abs(scaleProbeAfter.width / scaleProbeBefore.width - 0.5) < 0.06,
    "cards should scale with viewport height so layouts stay similar across window sizes"
  );
  assert.deepEqual(scaleProbeAfter.stored, scaleProbeBefore.stored, "viewport scaling should not rewrite stored layout values");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(820);

  await resetHarnessState(page);
  await page.locator("[data-participant-id='Actor.gamma']").click({ modifiers: ["Shift"], position: { x: 50, y: 70 }, force: true });
  await assertVisibleText(page, "1 selected");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(140);
  assert.equal(await page.locator("[data-selection-dock]").count(), 0, "Escape should clear the selection");

  await resetHarnessState(page);
  const zRaiseRect = await page.locator("[data-participant-id='Actor.alpha']").boundingBox();
  await page.mouse.move(zRaiseRect.x + zRaiseRect.width / 2, zRaiseRect.y + 96);
  await page.mouse.down();
  await page.mouse.move(zRaiseRect.x + zRaiseRect.width / 2 + 70, zRaiseRect.y + 126);
  await page.mouse.up();
  await page.waitForTimeout(160);
  const zAfterDrag = await page.evaluate(() => {
    return Object.fromEntries(globalThis.characterShowHarness.store.stage.participants.map((entry) => [entry.id, entry.z]));
  });
  assert.ok(
    zAfterDrag["Actor.alpha"] > Math.max(zAfterDrag["Actor.beta"], zAfterDrag["Actor.gamma"]),
    "dragging a portrait should raise it above the others"
  );

  await resetHarnessState(page);
  await page.evaluate(() => {
    const store = globalThis.characterShowHarness.store;
    return globalThis.characterShowHarness.write("localState", { ...store.local, snapToGrid: true });
  });
  await page.waitForTimeout(120);
  await selectParticipant(page, "Actor.alpha");
  await selectParticipant(page, "Actor.gamma");
  const formationBefore = await page.evaluate(() => {
    const rect = (id) => document.querySelector(`[data-participant-id='${id}']`).getBoundingClientRect();
    const alpha = rect("Actor.alpha");
    const gamma = rect("Actor.gamma");
    return { dx: gamma.left - alpha.left, dy: gamma.top - alpha.top };
  });
  const snapDragRect = await page.locator("[data-participant-id='Actor.alpha']").boundingBox();
  await page.mouse.move(snapDragRect.x + snapDragRect.width / 2, snapDragRect.y + 96);
  await page.mouse.down();
  await page.mouse.move(snapDragRect.x + snapDragRect.width / 2 + 65, snapDragRect.y + 136);
  const gridActiveDuringDrag = await page.evaluate(() => {
    return document.getElementById("character-show-overlay").classList.contains("is-grid-active");
  });
  await page.mouse.up();
  await page.waitForTimeout(480);
  assert.equal(gridActiveDuringDrag, true, "snap drag should reveal the alignment grid");
  const snapDragState = await page.evaluate(() => {
    const store = globalThis.characterShowHarness.store;
    const alpha = store.stage.participants.find((entry) => entry.id === "Actor.alpha");
    const rect = (id) => document.querySelector(`[data-participant-id='${id}']`).getBoundingClientRect();
    const alphaRect = rect("Actor.alpha");
    const gammaRect = rect("Actor.gamma");
    return {
      gridActive: document.getElementById("character-show-overlay").classList.contains("is-grid-active"),
      alphaLeftPx: (alpha.x / 100) * window.innerWidth,
      dx: gammaRect.left - alphaRect.left,
      dy: gammaRect.top - alphaRect.top
    };
  });
  assert.equal(snapDragState.gridActive, false, "alignment grid should hide once the drag ends");
  const gridRemainder = snapDragState.alphaLeftPx % 24;
  assert.ok(
    Math.min(gridRemainder, 24 - gridRemainder) < 1,
    "snapped drag should land the grabbed portrait on the 24px grid"
  );
  assert.ok(
    Math.abs(snapDragState.dx - formationBefore.dx) < 1.5 && Math.abs(snapDragState.dy - formationBefore.dy) < 1.5,
    `snapping a group drag should preserve the formation between portraits (before ${formationBefore.dx},${formationBefore.dy} after ${snapDragState.dx},${snapDragState.dy})`
  );

  await page.evaluate(() => {
    const sidebar = document.createElement("div");
    sidebar.id = "sidebar";
    Object.assign(sidebar.style, {
      position: "fixed",
      top: "0",
      right: "0",
      width: "320px",
      height: "100%",
      zIndex: "30"
    });
    document.body.append(sidebar);
  });
  await resetHarnessState(page, {
    participants: [
      { id: "Actor.alpha", uuid: "Actor.alpha", name: "Alpha", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 12, y: 22, size: 180, z: 11 },
      { id: "Actor.beta", uuid: "Actor.beta", name: "Beta", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 36, y: 74, size: 180, z: 12 },
      { id: "Actor.gamma", uuid: "Actor.gamma", name: "Gamma", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 88, y: 34, size: 180, z: 13 }
    ]
  });
  await page.waitForTimeout(640);
  const safeArea = await page.evaluate(() => {
    const sidebarRect = document.getElementById("sidebar").getBoundingClientRect();
    const gammaRect = document.querySelector("[data-participant-id='Actor.gamma']").getBoundingClientRect();
    const stored = globalThis.characterShowHarness.store.stage.participants.find((entry) => entry.id === "Actor.gamma");
    return { sidebarLeft: sidebarRect.left, gammaRight: gammaRect.right, storedX: stored.x };
  });
  assert.ok(
    safeArea.gammaRight <= safeArea.sidebarLeft + 0.5,
    `a synced layout landing under the local Foundry UI should be nudged back onto the stage (card right ${safeArea.gammaRight}, sidebar left ${safeArea.sidebarLeft})`
  );
  assert.equal(safeArea.storedX, 88, "the UI safe area must stay visual-only and never rewrite the shared layout");

  const uiDragRect = await page.locator("[data-participant-id='Actor.alpha']").boundingBox();
  await page.mouse.move(uiDragRect.x + uiDragRect.width / 2, uiDragRect.y + 96);
  await page.mouse.down();
  await page.mouse.move(1780, uiDragRect.y + 120);
  await page.mouse.up();
  await page.waitForTimeout(480);
  const uiDropSafe = await page.evaluate(() => {
    const sidebarRect = document.getElementById("sidebar").getBoundingClientRect();
    const alphaRect = document.querySelector("[data-participant-id='Actor.alpha']").getBoundingClientRect();
    return { sidebarLeft: sidebarRect.left, alphaRight: alphaRect.right };
  });
  assert.ok(
    uiDropSafe.alphaRight <= uiDropSafe.sidebarLeft + 0.5,
    "dropping a portrait onto the Foundry UI should resolve it back onto the stage"
  );

  await page.evaluate(() => {
    const wrapper = document.createElement("div");
    wrapper.id = "scene-controls";
    Object.assign(wrapper.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "480px",
      height: "100%",
      zIndex: "30",
      pointerEvents: "none"
    });
    const column = document.createElement("div");
    column.id = "controls-column";
    Object.assign(column.style, {
      position: "absolute",
      top: "80px",
      left: "0",
      width: "60px",
      height: "400px",
      background: "rgba(60, 60, 80, 0.6)",
      pointerEvents: "auto"
    });
    wrapper.append(column);
    document.body.append(wrapper);
  });
  await resetHarnessState(page, {
    participants: [
      { id: "Actor.alpha", uuid: "Actor.alpha", name: "Alpha", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 12, y: 30, size: 180, z: 11 },
      { id: "Actor.beta", uuid: "Actor.beta", name: "Beta", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 0, y: 12, size: 180, z: 12 },
      { id: "Actor.gamma", uuid: "Actor.gamma", name: "Gamma", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 60, y: 60, size: 180, z: 13 }
    ]
  });
  await page.waitForTimeout(640);
  const wrapperProbe = await page.evaluate(() => {
    const rect = (id) => document.querySelector(`[data-participant-id='${id}']`).getBoundingClientRect();
    return { alphaLeft: rect("Actor.alpha").left, betaLeft: rect("Actor.beta").left };
  });
  assert.ok(
    Math.abs(wrapperProbe.alphaLeft - 0.12 * 1920) < 8,
    `oversized UI wrappers should not block the empty stage around their content (card left ${wrapperProbe.alphaLeft})`
  );
  assert.ok(
    wrapperProbe.betaLeft >= 66,
    `cards overlapping the visible UI content should still be nudged clear (card left ${wrapperProbe.betaLeft})`
  );

  await page.evaluate(() => {
    const store = globalThis.characterShowHarness.store;
    return globalThis.characterShowHarness.write("localState", { ...store.local, snapToGrid: true });
  });
  await page.waitForTimeout(520);
  const gridInsetRect = await page.locator("[data-participant-id='Actor.gamma']").boundingBox();
  await page.mouse.move(gridInsetRect.x + gridInsetRect.width / 2, gridInsetRect.y + 96);
  await page.mouse.down();
  await page.mouse.move(gridInsetRect.x + gridInsetRect.width / 2 + 40, gridInsetRect.y + 120);
  const gridInsets = await page.evaluate(() => {
    const style = document.getElementById("character-show-overlay").style;
    return {
      right: style.getPropertyValue("--character-show-grid-inset-right"),
      left: style.getPropertyValue("--character-show-grid-inset-left")
    };
  });
  await page.mouse.up();
  await page.waitForTimeout(160);
  assert.equal(gridInsets.right, "320px", "the snap grid should stop at the Foundry sidebar instead of painting over it");
  assert.equal(gridInsets.left, "0px", "small UI panels should not carve grid insets");

  await page.evaluate(() => {
    document.getElementById("sidebar")?.remove();
    document.getElementById("scene-controls")?.remove();
  });

  await resetHarnessState(page, {
    participants: [
      { id: "Actor.alpha", uuid: "Actor.alpha", name: "Alpha", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 12, y: 22, size: 180, z: 11 },
      { id: "Actor.beta", uuid: "Actor.beta", name: "Beta", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 88.5, y: 34, size: 180, z: 12 },
      { id: "Actor.gamma", uuid: "Actor.gamma", name: "Gamma", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 80, y: 34, size: 180, z: 13 }
    ]
  });
  const panelBefore = await page.evaluate(() => {
    const gammaRect = document.querySelector("[data-participant-id='Actor.gamma']").getBoundingClientRect();
    const betaRect = document.querySelector("[data-participant-id='Actor.beta']").getBoundingClientRect();
    return { left: gammaRect.left, right: gammaRect.right, betaLeft: betaRect.left };
  });
  await page.evaluate(() => {
    const sidebar = document.createElement("div");
    sidebar.id = "sidebar";
    Object.assign(sidebar.style, { position: "fixed", top: "0", right: "0", width: "320px", height: "100%", zIndex: "30" });
    document.body.append(sidebar);
  });
  await page.waitForTimeout(90);
  const panelReaction = await page.evaluate(() => {
    return document.querySelector("[data-participant-id='Actor.gamma']").style.left;
  });
  assert.ok(
    panelReaction.endsWith("px"),
    `portraits should start moving immediately when a panel expands, not after a long debounce (style.left ${panelReaction})`
  );
  await page.waitForTimeout(680);
  const panelExpanded = await page.evaluate(() => {
    const sidebarRect = document.getElementById("sidebar").getBoundingClientRect();
    const gammaRect = document.querySelector("[data-participant-id='Actor.gamma']").getBoundingClientRect();
    const betaRect = document.querySelector("[data-participant-id='Actor.beta']").getBoundingClientRect();
    const stored = globalThis.characterShowHarness.store.stage.participants.find((entry) => entry.id === "Actor.gamma");
    return { sidebarLeft: sidebarRect.left, right: gammaRect.right, betaRight: betaRect.right, storedX: stored.x };
  });
  assert.ok(
    panelExpanded.right <= panelExpanded.sidebarLeft + 0.5,
    `expanding a Foundry panel should slide overlapped portraits out of it (card right ${panelExpanded.right}, panel left ${panelExpanded.sidebarLeft})`
  );
  assert.ok(
    panelExpanded.betaRight <= panelExpanded.sidebarLeft + 0.5,
    `every overlapped portrait should leave the expanded panel (card right ${panelExpanded.betaRight})`
  );
  assert.equal(
    await cardsOverlap(page, "Actor.beta", "Actor.gamma"),
    false,
    "portraits displaced by an expanding panel should not pile up on each other"
  );
  assert.equal(panelExpanded.storedX, 80, "panel-driven repositioning must stay local and keep the shared layout untouched");

  await page.evaluate(() => document.getElementById("sidebar")?.remove());
  await page.waitForTimeout(760);
  const panelCollapsed = await page.evaluate(() => {
    const gammaRect = document.querySelector("[data-participant-id='Actor.gamma']").getBoundingClientRect();
    const betaRect = document.querySelector("[data-participant-id='Actor.beta']").getBoundingClientRect();
    const stored = globalThis.characterShowHarness.store.stage.participants.find((entry) => entry.id === "Actor.gamma");
    return { left: gammaRect.left, betaLeft: betaRect.left, storedX: stored.x };
  });
  assert.ok(
    Math.abs(panelCollapsed.left - panelBefore.left) < 1.5,
    `collapsing the panel should return portraits to their saved spots (left ${panelCollapsed.left} vs ${panelBefore.left})`
  );
  assert.ok(
    Math.abs(panelCollapsed.betaLeft - panelBefore.betaLeft) < 1.5,
    `collapsing the panel should return every displaced portrait (left ${panelCollapsed.betaLeft} vs ${panelBefore.betaLeft})`
  );
  assert.equal(panelCollapsed.storedX, 80, "returning portraits after a panel collapse must not rewrite the shared layout");

  await resetHarnessState(page, {
    participants: [
      { id: "Actor.alpha", uuid: "Actor.alpha", name: "Alpha", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 10.4167, y: 40, size: 200, z: 11 },
      { id: "Actor.beta", uuid: "Actor.beta", name: "Beta", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 19.2708, y: 40, size: 200, z: 12 },
      { id: "Actor.gamma", uuid: "Actor.gamma", name: "Gamma", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 28.125, y: 40, size: 200, z: 13 }
    ]
  });
  await page.evaluate(() => {
    const store = globalThis.characterShowHarness.store;
    return globalThis.characterShowHarness.write("localState", { ...store.local, selectedParticipantIds: ["Actor.alpha", "Actor.beta", "Actor.gamma"] });
  });
  await page.waitForTimeout(160);
  await page.getByRole("button", { name: "Grow sel." }).click();
  await page.waitForTimeout(700);
  const groupSizes = await page.evaluate(() => {
    return globalThis.characterShowHarness.store.stage.participants.map((entry) => entry.size);
  });
  assert.deepEqual(groupSizes, [216, 216, 216], "group resize should reflow tightly packed portraits instead of blocking the growth");
  assert.equal(await cardsOverlap(page, "Actor.alpha", "Actor.beta"), false, "group-grown portraits should not overlap each other");
  assert.equal(await cardsOverlap(page, "Actor.beta", "Actor.gamma"), false, "group-grown portraits should not overlap each other");

  await resetHarnessState(page, {
    participants: [
      { id: "Actor.alpha", uuid: "Actor.alpha", name: "Alpha", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 10, y: 40, size: 150, z: 11 },
      { id: "Actor.beta", uuid: "Actor.beta", name: "Beta", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 40, y: 40, size: 150, z: 12 }
    ]
  });
  const dropOriginRect = await page.locator("[data-participant-id='Actor.alpha']").boundingBox();
  const dropTargetRect = await page.locator("[data-participant-id='Actor.beta']").boundingBox();
  await page.mouse.move(dropOriginRect.x + dropOriginRect.width / 2, dropOriginRect.y + 96);
  await page.mouse.down();
  await page.mouse.move(dropTargetRect.x + dropTargetRect.width / 2, dropTargetRect.y + 96, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(650);
  const dropOnTop = await page.evaluate(() => {
    const rect = (id) => document.querySelector(`[data-participant-id='${id}']`).getBoundingClientRect();
    const alpha = rect("Actor.alpha");
    const beta = rect("Actor.beta");
    const stored = globalThis.characterShowHarness.store.stage.participants.find((entry) => entry.id === "Actor.alpha");
    const horizontalGap = Math.max(beta.left - alpha.right, alpha.left - beta.right);
    const verticalGap = Math.max(beta.top - alpha.bottom, alpha.top - beta.bottom);
    return { storedX: stored.x, gap: Math.max(0, Math.min(horizontalGap, verticalGap)) };
  });
  assert.ok(dropOnTop.storedX > 25, `dropping a portrait onto another must settle beside it, never bounce back to the origin (stored x ${dropOnTop.storedX})`);
  assert.equal(await cardsOverlap(page, "Actor.alpha", "Actor.beta"), false, "the dropped portrait must not overlap the one underneath");
  assert.ok(dropOnTop.gap <= 40, `the dropped portrait should hug the card underneath (gap ${dropOnTop.gap})`);

  await resetHarnessState(page, {
    participants: [
      { id: "Actor.alpha", uuid: "Actor.alpha", name: "Alpha", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 30, y: 40, size: 180, z: 11 },
      { id: "Actor.beta", uuid: "Actor.beta", name: "Beta", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 38, y: 40, size: 180, z: 12 }
    ]
  });
  assert.equal(await cardsOverlap(page, "Actor.alpha", "Actor.beta"), false, "baseline layout should be clear at the authoring window size");
  await page.setViewportSize({ width: 960, height: 1080 });
  await page.waitForTimeout(820);
  const aspectStored = await page.evaluate(() => {
    return Object.fromEntries(globalThis.characterShowHarness.store.stage.participants.map((entry) => [entry.id, entry.x]));
  });
  assert.equal(
    await cardsOverlap(page, "Actor.alpha", "Actor.beta"),
    false,
    "a narrower window must visually separate portraits that the percent positions squeeze together"
  );
  assert.equal(aspectStored["Actor.alpha"], 30, "display-only separation must not rewrite the shared layout");
  assert.equal(aspectStored["Actor.beta"], 38, "display-only separation must not rewrite the shared layout");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(820);
  const aspectRestored = await page.evaluate(() => {
    return document.querySelector("[data-participant-id='Actor.beta']").getBoundingClientRect().left;
  });
  assert.equal(await cardsOverlap(page, "Actor.alpha", "Actor.beta"), false, "restoring the window should keep portraits clear");
  assert.ok(Math.abs(aspectRestored - 0.38 * 1920) < 8, `restoring the window should return portraits to their saved spots (left ${aspectRestored})`);

  const gapBetween = () => page.evaluate(() => {
    const rect = (id) => document.querySelector(`[data-participant-id='${id}']`).getBoundingClientRect();
    const alpha = rect("Actor.alpha");
    const beta = rect("Actor.beta");
    return beta.left - alpha.right;
  });
  const gapAtReference = await gapBetween();
  await page.setViewportSize({ width: 2560, height: 1080 });
  await page.waitForTimeout(820);
  const gapAtUltrawide = await gapBetween();
  const ultrawideStored = await page.evaluate(() => {
    return Object.fromEntries(globalThis.characterShowHarness.store.stage.participants.map((entry) => [entry.id, entry.x]));
  });
  assert.ok(
    Math.abs(gapAtUltrawide - gapAtReference) < 1.5,
    `a wider window must preserve the distance between portraits instead of spreading them apart (gap ${gapAtReference} vs ${gapAtUltrawide})`
  );
  assert.equal(ultrawideStored["Actor.alpha"], 30, "stage-space rendering must not rewrite the shared layout");
  assert.equal(ultrawideStored["Actor.beta"], 38, "stage-space rendering must not rewrite the shared layout");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(820);
  // A second pointer never moves or drops a running drag, and a cancelled pointer (touch scroll, alert, lost focus)
  // ends the drag without committing it and puts the portrait back.
  await resetHarnessState(page);
  const gammaBox = await page.locator("[data-participant-id='Actor.gamma'] .character-show-card-image").boundingBox();
  const gammaBefore = (await stagePositions(page, ["Actor.gamma"]))["Actor.gamma"];
  const gammaCardBefore = await page.locator("[data-participant-id='Actor.gamma']").boundingBox();
  const cancelledCardDrag = await page.evaluate(({ x, y }) => {
    const card = () => document.querySelector("[data-participant-id='Actor.gamma']");
    const pointer = (type, target, dx, pointerId = 1) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId, button: 0, clientX: x + dx, clientY: y + dx
    }));
    pointer("pointerdown", card().querySelector(".character-show-card-image"), 0);
    pointer("pointermove", document, 80);
    const leftWhileDragging = card().style.left;
    pointer("pointermove", document, 300, 2);
    pointer("pointerup", document, 300, 2);
    const otherPointer = {
      stillDragging: card().classList.contains("is-dragging"),
      notMoved: card().style.left === leftWhileDragging
    };
    pointer("pointercancel", document, 80);
    return { otherPointer, dragging: document.querySelectorAll(".character-show-card.is-dragging").length };
  }, { x: gammaBox.x + gammaBox.width / 2, y: gammaBox.y + gammaBox.height / 2 });
  await page.waitForTimeout(700); // the portrait glides back (FLIP settles in about 420 ms)
  assert.deepEqual(cancelledCardDrag.otherPointer, { stillDragging: true, notMoved: true }, "another pointer must not move or drop a running drag");
  assert.equal(cancelledCardDrag.dragging, 0, "a cancelled card drag should drop its dragging state");
  assert.deepEqual((await stagePositions(page, ["Actor.gamma"]))["Actor.gamma"], gammaBefore, "a cancelled card drag must not move the portrait");
  const gammaCardAfter = await page.locator("[data-participant-id='Actor.gamma']").boundingBox();
  assert.ok(Math.abs(gammaCardAfter.x - gammaCardBefore.x) < 1 && Math.abs(gammaCardAfter.y - gammaCardBefore.y) < 1, "a cancelled card drag should put the portrait back on screen");

  const controlsBox = await page.locator("[data-controls]").boundingBox();
  const cancelledToolbarDrag = await page.evaluate(({ x, y }) => {
    const controls = document.querySelector("[data-controls]");
    const root = document.getElementById("character-show-overlay");
    const before = globalThis.characterShowHarness.store.local.controlsPosition;
    const pointer = (type, target, dx) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: x + dx, clientY: y + dx
    }));
    pointer("pointerdown", controls, 0);
    pointer("pointermove", document, 60);
    const draggingBeforeBlur = root.classList.contains("is-toolbar-dragging");
    window.dispatchEvent(new Event("blur"));
    const draggingAfterBlur = root.classList.contains("is-toolbar-dragging");
    pointer("pointerup", document, 120);
    return {
      draggingBeforeBlur,
      draggingAfterBlur,
      unchanged: globalThis.characterShowHarness.store.local.controlsPosition === before
    };
  }, { x: controlsBox.x + 6, y: controlsBox.y + controlsBox.height / 2 });
  assert.deepEqual(cancelledToolbarDrag, { draggingBeforeBlur: true, draggingAfterBlur: false, unchanged: true }, "losing focus mid toolbar drag should cancel it");
  await page.waitForTimeout(300);
  const controlsAfter = await page.locator("[data-controls]").boundingBox();
  assert.ok(Math.abs(controlsAfter.x - controlsBox.x) < 1 && Math.abs(controlsAfter.y - controlsBox.y) < 1, "a cancelled toolbar drag should put the toolbar back");

  // Adding an actor renders once (no nested render from the local sync) and the new card animates in.
  await resetHarnessState(page);
  const addRender = await page.evaluate(async () => {
    const { overlay, store } = globalThis.characterShowHarness;
    const renderControls = overlay.renderControls;
    let renders = 0;
    overlay.renderControls = function (...args) {
      renders += 1;
      return renderControls.apply(this, args);
    };
    try {
      await game.modules.get("character-show").api.addActor(game.actors.get("delta"));
    } finally {
      overlay.renderControls = renderControls;
    }
    return {
      renders,
      entering: document.querySelector("[data-participant-id='Actor.delta']")?.classList.contains("is-entering") ?? false,
      synced: store.local.syncedLayoutRevision === store.stage.layoutRevision
    };
  });
  assert.deepEqual(addRender, { renders: 1, entering: true, synced: true }, "adding an actor should render once and animate the new card");

  // Any drop ends the drag hint, including text and non-actor documents, which add nothing.
  await resetHarnessState(page);
  const foreignDrops = await page.evaluate(() => {
    const root = document.getElementById("character-show-overlay");
    const box = root.querySelector("[data-drop-target]").getBoundingClientRect();
    const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
    const results = [];
    for (const payload of ["hello", JSON.stringify({ type: "Item", uuid: "Item.x" })]) {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", payload);
      document.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer, ...at }));
      const shown = root.classList.contains("is-drop-target");
      document.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer, ...at }));
      results.push({ shown, cleared: !root.classList.contains("is-drop-target") && !root.classList.contains("is-drop-target-active") });
    }
    return { results, cards: globalThis.characterShowHarness.store.stage.participants.length };
  });
  assert.deepEqual(foreignDrops.results, [{ shown: true, cleared: true }, { shown: false, cleared: true }], "a foreign drop should clear the drop hint");
  assert.equal(foreignDrops.cards, 3, "a foreign drop should add nothing");

  // With Foundry's light theme the panels stay dark, so their text must not follow the theme's dark text color.
  const themeText = await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = "body { --color-text-primary: #efe6d8; --color-text-secondary: #d0c8b8; } body.theme-light { --color-text-primary: #222222; --color-text-secondary: #333333; }";
    document.head.append(style);
    const name = document.querySelector(".character-show-name");
    const read = () => getComputedStyle(name).color;
    const dark = read();
    document.body.classList.add("theme-light");
    const light = read();
    document.body.classList.remove("theme-light");
    style.remove();
    return { dark, light };
  });
  assert.equal(themeText.light, themeText.dark, "overlay text on the dark panels must not change with Foundry's light theme");

  // A player can only mark an actor they own as speaking.
  await resetHarnessState(page);
  const playerSpeaker = await page.evaluate(async () => {
    const { store, notices } = globalThis.characterShowHarness;
    notices.length = 0;
    game.user.isGM = false;
    try {
      document.querySelector("[data-participant-id='Actor.gamma'] [data-action='speaker']").click();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const denied = { warned: notices.includes("You can only mark an actor you own as speaking."), local: store.local.localSpeakerId };
      document.querySelector("[data-participant-id='Actor.beta'] [data-action='speaker']").click();
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { denied, allowed: store.local.localSpeakerId, shared: store.stage.speakerId };
    } finally {
      game.user.isGM = true;
    }
  });
  assert.deepEqual(playerSpeaker, { denied: { warned: true, local: null }, allowed: "Actor.beta", shared: "Actor.alpha" }, "players may only mark owned actors as speaking, locally");
  assert.deepEqual(pageErrors.map(String), [], "the overlay should run without page errors");
} finally {
  await browser.close();
  server.close();
}

async function assertVisibleText(page, text) {
  await page.getByText(text).first().waitFor({ state: "visible" });
}

async function arrangePaletteMetrics(page, interaction) {
  const trigger = page.getByRole("button", { name: "Arrange" });
  if (interaction === "click") {
    await trigger.click();
  } else {
    await trigger.hover();
  }
  await page.waitForTimeout(90);
  return currentArrangePaletteState(page);
}

async function closeArrangePalette(page) {
  await page.mouse.click(8, 8);
  await page.waitForTimeout(60);
}

async function currentArrangePaletteState(page) {
  return page.evaluate(() => {
    const controls = document.querySelector("[data-controls]");
    const trigger = document.querySelector(".character-show-arrange-menu > .character-show-control-button");
    const panel = document.querySelector(".character-show-arrange-options");
    const buttons = Array.from(panel?.querySelectorAll("button") || []);
    if (!controls || !trigger || !panel) {
      return {
        visible: false,
        optionCount: 0,
        panelTop: 0,
        controlsBottom: 0,
        panelCenterX: 0,
        triggerCenterX: 0,
        panelInsideViewport: false,
        paletteReceivesPointer: false,
        buttonsFillPanel: false,
        buttonLabels: [],
        maxWidths: []
      };
    }

    const controlsRect = controls.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const buttonRects = buttons.map((button) => button.getBoundingClientRect());
    const visible = getComputedStyle(panel).display !== "none";
    const topElement = visible
      ? document.elementFromPoint(panelRect.left + panelRect.width / 2, panelRect.top + panelRect.height / 2)
      : null;

    return {
      visible,
      optionCount: buttons.length,
      panelTop: panelRect.top,
      controlsBottom: controlsRect.bottom,
      panelCenterX: panelRect.left + panelRect.width / 2,
      triggerCenterX: triggerRect.left + triggerRect.width / 2,
      panelInsideViewport: !visible || (panelRect.left >= 12 && panelRect.right <= window.innerWidth - 12),
      paletteReceivesPointer: !visible || panel.contains(topElement),
      buttonsFillPanel: buttonRects.every((rect) => (
        rect.width >= panelRect.width - 14 &&
        rect.left >= panelRect.left + 5 &&
        rect.right <= panelRect.right - 5 &&
        rect.height >= 30
      )),
      buttonLabels: buttons.map((button) => button.textContent.trim()),
      maxWidths: buttons.map((button) => getComputedStyle(button).maxWidth)
    };
  });
}

async function participantY(page, id) {
  return page.evaluate((participantId) => {
    const participant = globalThis.characterShowHarness.store.stage.participants.find((entry) => entry.id === participantId);
    return participant?.y;
  }, id);
}

async function cardsOverlap(page, firstId, secondId) {
  return page.evaluate(({ first, second }) => {
    const firstCard = document.querySelector(`[data-participant-id="${CSS.escape(first)}"]`);
    const secondCard = document.querySelector(`[data-participant-id="${CSS.escape(second)}"]`);
    if (!firstCard || !secondCard) return false;
    const a = firstCard.getBoundingClientRect();
    const b = secondCard.getBoundingClientRect();
    return !(
      a.right <= b.left ||
      a.left >= b.right ||
      a.bottom <= b.top ||
      a.top >= b.bottom
    );
  }, { first: firstId, second: secondId });
}

async function toggleName(page, id) {
  const card = page.locator(`[data-participant-id='${id}']`);
  await card.hover();
  await page.locator(`[data-participant-id='${id}'] [data-action='toggle-name']`).click({ force: true });
}

async function selectParticipant(page, id) {
  await page.locator(`[data-participant-id='${id}']`).hover();
  await page.locator(`[data-participant-id='${id}'] [data-action='toggle-select']`).click({ force: true });
}

async function participantToolsFitInsideCard(page, id) {
  await page.locator(`[data-participant-id='${id}']`).hover();
  await page.waitForTimeout(80);
  return page.evaluate((participantId) => {
    const card = document.querySelector(`[data-participant-id="${CSS.escape(participantId)}"]`);
    const image = card?.querySelector(".character-show-card-image");
    const tools = card?.querySelector(".character-show-card-tools");
    if (!card || !image || !tools) return false;
    const imageRect = image.getBoundingClientRect();
    const toolsRect = tools.getBoundingClientRect();
    return (
      toolsRect.left >= imageRect.left + 4 &&
      toolsRect.right <= imageRect.right - 4 &&
      toolsRect.top >= imageRect.top + 4 &&
      toolsRect.bottom <= imageRect.bottom - 4
    );
  }, id);
}

async function selectionDockPlacement(page, ids) {
  return page.evaluate((participantIds) => {
    const dock = document.querySelector("[data-selection-dock]");
    const cards = participantIds.map((id) => document.querySelector(`[data-participant-id="${CSS.escape(id)}"]`)).filter(Boolean);
    const dockRect = dock.getBoundingClientRect();
    const rects = cards.map((card) => card.getBoundingClientRect());
    const bounds = {
      left: Math.min(...rects.map((rect) => rect.left)),
      right: Math.max(...rects.map((rect) => rect.right)),
      bottom: Math.max(...rects.map((rect) => rect.bottom))
    };
    return {
      dockCenterX: dockRect.left + dockRect.width / 2,
      dockTop: dockRect.top,
      selectionCenterX: (bounds.left + bounds.right) / 2,
      selectionBottom: bounds.bottom
    };
  }, ids);
}

async function selectionDockControlsFillContainer(page) {
  return page.evaluate(() => {
    const dock = document.querySelector("[data-selection-dock]");
    const items = Array.from(dock?.children || []);
    if (!dock || !items.length) return false;
    const dockRect = dock.getBoundingClientRect();
    const contentHeight = dockRect.height - 10;
    return items.every((item) => {
      const rect = item.getBoundingClientRect();
      return rect.height >= contentHeight - 1 && rect.top >= dockRect.top + 3 && rect.bottom <= dockRect.bottom - 3;
    });
  });
}

async function toolbarMiniDockAlignment(page) {
  return page.evaluate(() => {
    const overlay = document.getElementById("character-show-overlay");
    const controls = document.querySelector("[data-controls]");
    const dock = document.querySelector("[data-mini-dock]");
    if (!controls || !dock) return null;
    const controlsRect = controls.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();
    return {
      centerDeltaX: (dockRect.left + dockRect.width / 2) - (controlsRect.left + controlsRect.width / 2),
      gapY: dockRect.top - controlsRect.bottom,
      dragging: overlay?.classList.contains("is-toolbar-dragging") ?? false
    };
  });
}

async function stagePositions(page, ids) {
  return page.evaluate((participantIds) => {
    const participants = globalThis.characterShowHarness.store.stage.participants;
    return Object.fromEntries(participantIds.map((id) => {
      const participant = participants.find((entry) => entry.id === id);
      return [id, { x: participant.x, y: participant.y }];
    }));
  }, ids);
}

async function resetHarnessState(page, options = {}) {
  await page.evaluate(async (resetOptions) => {
    const store = globalThis.characterShowHarness.store;
    const harness = globalThis.characterShowHarness;
    await harness.write("syncOrganization", resetOptions.syncOrganization ?? true);
    const nextStage = {
      version: 1,
      collapsed: false,
      showNames: true,
      speakerId: resetOptions.speakerId ?? "Actor.alpha",
      layoutRevision: 0,
      speakerRevision: 0,
      participants: resetOptions.participants ?? [
        { id: "Actor.alpha", uuid: "Actor.alpha", name: "Alpha", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 12, y: 22, size: 180, z: 11 },
        { id: "Actor.beta", uuid: "Actor.beta", name: "Beta", image: "icons/svg/mystery-man.svg", showName: false, flipped: false, x: 36, y: 74, size: 180, z: 12 },
        { id: "Actor.gamma", uuid: "Actor.gamma", name: "Gamma", image: "icons/svg/mystery-man.svg", showName: true, flipped: false, x: 60, y: 34, size: 180, z: 13 }
      ]
    };
    const nextLocal = {
      version: 1,
      syncedLayoutRevision: 0,
      syncedSpeakerRevision: 0,
      hidden: false,
      controlsCollapsed: resetOptions.controlsCollapsed ?? false,
      stageMinimized: resetOptions.stageMinimized ?? false,
      snapToGrid: false,
      emptyHintDismissed: false,
      controlsPosition: null,
      offset: { x: 0, y: 0 },
      participants: {},
      selectedParticipantIds: [],
      localSpeakerId: null
    };
    await harness.write("localState", nextLocal);
    await harness.write("globalState", nextStage);
  }, options);
  await page.waitForTimeout(560);
}
