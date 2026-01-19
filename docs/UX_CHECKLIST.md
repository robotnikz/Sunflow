# SunFlow Usability & UX Checklist

This checklist is meant for quick manual validation after changes or upgrades.

## Accessibility & keyboard

- Settings can be opened/closed without a mouse (keyboard reachable controls).
- Modal close works via the close button and `Escape`.
- Important controls have accessible names (buttons, toggles, inputs).
- Tab-like navigation in Settings is clearly labeled and reachable.

## Clarity & error messages

- Error messages are actionable (what happened + what to do next).
- Empty states explain what to configure (e.g., fresh install opens Settings).
- Copy is consistent (units, currency, dates).

## Responsiveness

- Dashboard and Settings remain usable on smaller screens.
- Settings tabs remain reachable on narrow widths (horizontal scroll is acceptable).

## Performance perception

- Loading states appear quickly when data is missing/slow.
- The UI remains responsive while backend polling is active.

## Regression smoke (recommended)

- Run the Playwright smoke suite (see [CONTRIBUTING.md](CONTRIBUTING.md)).
- Open Settings, switch to Notifications, verify toggle is reachable and labeled.
