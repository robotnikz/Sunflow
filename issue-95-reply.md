Thanks a lot for the detailed report and screenshots  very helpful. I went through each requested item and implemented focused UI polish fixes (especially for Light theme and small screens).

## Settings modal: squished tabs
**Fixed**
- Made the settings tab bar height deterministic across all tabs (prevents the squished/jittery look).
- Improved horizontal scrolling behavior to avoid layout height changes (notably on Windows scrollbars).
- Kept icons/labels from shrinking in tight space.

## Legibility (Light mode)
**Improved (targeted fixes applied)**
- Strengthened Light-theme readability for the screenshot-highlighted areas by adjusting contrast and avoiding washed out text.
- Added a small escape hatch so text that must remain white on accent/colored backgrounds stays white in Light mode (prevents accidental remapping).

Examples covered:
- Status timeline labels inside colored bars (forced to stay readable/white).
- Closed-card subtitles in the Scenario Planner and Dynamic Tariff Comparison (now white for better contrast).
- Price add-ons section label contrast improved.

## Text wrap on some items (German longer than English)
**Partially addressed**
- Weekday display is now abbreviated (helps reduce long German strings in the time label).
- Time range selector no longer wraps/squeezes; it scrolls horizontally when needed.

**Still open**
- I did not globally shorten multiple individual German translation strings beyond the weekday abbreviation approach. If you point me to remaining problematic strings, I can trim them surgically.

## Rings (Light mode ring background should be white)
**Fixed**
- The donut remaining/background track now uses theme variables so Light mode can use a clean white track (and readable label color), while Dark mode stays unchanged.
- Battery gauge track was also corrected so its not overly dark/black in Light mode.

## Mobile devices: layout sometimes broken / overflowing inputs
**Improved (targeted fixes applied)**
- Live Power Flow spacing adjusted on small screens to avoid visual clashes.
- Date inputs hardened with responsive sizing so they dont overflow their containers.
- Custom date grids stack on very small widths instead of forcing a 2-column layout.

## overflow-x-auto for the statistics/time selector
**Fixed**
- The time range selector now uses horizontal scrolling instead of wrapping, so it stays clean on narrow screens.

## Extra request: bundle Tailwind + Inter (no CDN) for Docker/frontend
**Addressed**
- Removed Tailwind CDN and Google Fonts usage.
- Inter is now bundled via npm and imported in the frontend entry.
- Tailwind is built via PostCSS as part of the Vite build.

## Anything not implemented yet?
- If there are any remaining Light-theme low-contrast spots beyond the areas shown in the screenshots, please drop one more screenshot (or describe where), and Ill apply the same scoped approach (component-level tweaks + minimal theme overrides).
