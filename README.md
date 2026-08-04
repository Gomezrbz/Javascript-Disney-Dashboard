# Javascript Disney Dashboard

LogicMonitor **Alert Dashboard | Operations** (Resource Selector dark theme).

## Import this file only

```text
import/Alert_Dashboard___Operations_ResourceSelector_Dark_v1.json
```

Import that JSON into your LogicMonitor portal. Do not import anything else from this repo.

## Project layout

| Path | Purpose |
| --- | --- |
| [`import/`](import/) | **Only** dashboard JSON to import |
| [`docs/`](docs/) | README, changelog, performance/filter deliverable |
| [`src/`](src/) | Editable JS sources + widget HTML mirrors |
| [`src/sync_embed.js`](src/sync_embed.js) | Re-embeds `src/*.js` into the import JSON |

## Docs

- [Dashboard README](docs/README.md) — filters, widgets, setup
- [Changelog](docs/CHANGELOG.md) — dark Resource Selector update
- [Performance & filters](docs/improve_dashboard_performance_and_filters.md) — root causes, API examples, tests
- [FilterWidget v7 user guide](docs/FilterWidget_v7_FilterWidgetInfo.html) — paste into a LogicMonitor Text widget if needed

## Dev workflow

1. Edit [`src/severity_script_0.js`](src/severity_script_0.js) and/or [`src/fw_script_0.js`](src/fw_script_0.js).
2. Run `node src/sync_embed.js` to update the import dashboard.
3. Optionally run `node src/test_filter_helpers.js`.
4. Re-import `import/Alert_Dashboard___Operations_ResourceSelector_Dark_v1.json` into LogicMonitor.
