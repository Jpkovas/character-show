# Character Show

Character Show is a system-agnostic Foundry VTT module for showing conversation portraits as a movable overlay.

## Current Scope

- Global conversation stage that persists across scenes.
- GM-controlled shared cast, portrait positions, sizes, name visibility, flip state, and active speaker.
- Per-client local offsets and portrait overrides so each player can move the overlay out of the way without changing anyone else's view.
- Per-client toolbar position, toolbar collapse, and full portrait minimization.
- Per-client multi-selection for moving or resizing a chosen group of visible portraits together.
- GM setting to allow or block player-side local portrait movement and resizing.
- GM setting to allow players to mark only owned actors as speaking.
- GM setting to stop syncing portrait organization, keeping only the shared cast and active speaker synchronized.
- GM image-framing setting with a uniform cropped portrait default and a limited natural-aspect option.
- Drag actors from the Actor Directory sidebar into the Foundry screen to add them as conversation portraits without creating scene tokens.
- No emotion or pose system in the MVP.

## Installation

In Foundry, under *Add-on Modules → Install Module*, search for **Character Show** or paste the manifest URL:

`https://github.com/Jpkovas/character-show/releases/latest/download/module.json`

Then enable the module in your world. Foundry's update check picks up new versions.

## Compatibility

- Foundry VTT: minimum 13, verified 14.370.
- Game systems: all systems. The module reads standard Actor and TokenDocument portrait fields only.

## Usage

As GM, drag an actor from the Actor Directory onto the screen to add it as a conversation portrait.

Click a portrait to mark it as the current speaker. Drag portraits to arrange the shared layout. Players can drag portraits or the control bar locally to move the overlay away from important scene art.

Drag the Character Show toolbar to place it without moving the portraits. Use the icon controls to collapse the toolbar or minimize every portrait into miniatures near the toolbar. In collapsed mode, the toolbar keeps only icon buttons with hover titles.

The GM can use `Normalize` to return all shared portraits to the same size, or the `Grow` and `Shrink` toolbar buttons to resize every portrait together. Use the check button in a portrait's action row to select several portraits; the selected group can then be dragged together or resized from the toolbar or from one selected portrait's action row. Any user can resize a single portrait from the `-` and `+` buttons in that portrait's action row; GM resizing changes the shared stage when organization sync is enabled, while player resizing stays local to that player. The `Grid` toggle snaps portrait movement and resizing for the current user on a square pixel grid. Portraits can pass over each other while being dragged, but the final drop position is resolved away from other portraits and the toolbar. Portrait resizing, global growth, selected growth, and toolbar movement still refuse positions that would overlap another portrait or the toolbar.

Use the `Organize` menu to automatically place the current cast side by side, in a 2x2 grid, or in a column. Automatic layouts sort portraits alphabetically by actor name. GM layouts update the shared stage; player layouts stay local to that player.

Whenever the GM changes the shared layout, local player portrait overrides are cleared so every client returns to the GM's current arrangement. Players can reorganize locally again afterward if the GM allows local movement. If the GM disables `Sync portrait organization`, the shared stage syncs only the cast and active speaker; movement, size, name visibility, flipping, arrangement, and minimization stay local for each user.

Players can mark an actor as speaking only when the GM allows player speaker control and the actor belongs to that player. GMs can always set the active speaker.

Whenever the GM changes the active speaker, local player speaker choices are cleared so every client follows the GM's current speaker. Players can claim their own speaker again afterward if the GM allows player speaker control.

By default, Character Show crops artwork into a uniform 4:5 portrait frame so grids stay aligned. GMs can switch image framing to a limited natural aspect mode in module settings when preserving the original artwork shape matters more than uniform layout.

Name labels only change layout when a label is shown and would overlap a neighboring portrait. In that case, lower stacked portraits are pushed down by the minimum needed gap. Hiding a name leaves every portrait in its current position. Viewport edge clamping is visual-only so resizing a browser window does not rewrite the saved stage layout. Showing one actor's name only animates that actor's reveal instead of replaying every visible label.

The UI intentionally uses Foundry color variables where possible so interface-theme modules can influence its appearance.

GMs can disable player-side local portrait movement in Foundry's module settings. When disabled, players can still move their own toolbar, minimize the stage, and reset old local portrait adjustments, but only the GM can move or resize portraits.

## Theme Integration

Character Show reads common Foundry and Carolingian UI variables for its surfaces and controls:

- `--background`, `--control-bg-color`, `--color-bg-button`
- `--button-background-color`, `--button-hover-background-color`, `--button-border-color`, `--button-text-color`
- `--toggle-active-bg-color`, `--toggle-active-border-color`, `--control-active-border-color`
- `--font-primary`, `--font-body`, `--crlngn-font-family`

It also exposes module-specific override variables on `.character-show-overlay`:

- `--character-show-surface-background`
- `--character-show-control`
- `--character-show-control-hover`
- `--character-show-radius-panel`
- `--character-show-radius-control`
- `--character-show-radius-portrait`

## Notes

Character Show intentionally avoids required dependencies such as libWrapper or socketlib. The shared stage is a world setting, and Foundry's own setting updates keep every client in sync.

## Development

- `npm test` runs the state unit tests.
- `npm run test:smoke` runs the browser smoke test against `tests/overlay-harness.html`, which loads the real module with a stubbed Foundry `game`. It needs Playwright's Chromium (`npx playwright install chromium`).
- `npm run harness` serves the harness for manual checks.

## Publishing a new version

1. Bump `version` in `module.json` and the `download` URL (it points to the `v<version>` tag), commit and push.
2. Create a GitHub release with the tag `v<version>`.
3. `.github/workflows/release.yml` checks the tag against `module.json`, builds `module.zip` and attaches `module.json` and `module.zip` to the release. With the `FOUNDRY_RELEASE_TOKEN` repository secret (from the package page on foundryvtt.com), it also registers the version in Foundry's package library.

## License

MIT.
