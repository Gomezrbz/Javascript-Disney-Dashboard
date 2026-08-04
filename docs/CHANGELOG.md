# Alert Dashboard | Operations — Resource Selector Dark Theme Update

## Summary

Updated the LogicMonitor **Resource Selector** (FilterWidget v7) so it matches the dark operational dashboard, removes excess empty vertical space, and defaults every visible filter to **All** (unrestricted) on a clean load.

## Files

| Role | Filename |
| --- | --- |
| Source dashboard (unchanged) | `Alert_Dashboard___Operations.json` |
| Generated dashboard | `Alert_Dashboard___Operations_ResourceSelector_Dark_v1.json` |

Dashboard name remains: **Alert Dashboard | Operations**.

## Layout changes

- Resource Selector height reduced from **sizey 5 → 3** and compact internal spacing applied.
- Status strip changed from `position: fixed` to **relative** so it no longer anchors to the bottom of a tall iframe and create a large empty band.
- Loading banner now uses `display: none` when idle (previously left an empty flex row via `&nbsp;`).
- Downstream widgets shifted up to close the previous gap:
  - Severity Breakdown: row **4** (was 9)
  - Location Map: row **10** (was 15)
  - Active Alert Details: row **18** (was 23)
- Dropdown option panels use `z-index: 5000`, dark backgrounds, and `overflow: visible` on containers to reduce clipping.

Alert summary, charts, map, and alert table widgets were **not** functionally modified (positions only).

## CSS changes (dark theme)

Applied a FilterWidget dark theme using CSS variables and suggested palette values:

| Token / element | Color |
| --- | --- |
| Widget / root background | `#15191f` |
| Elevated surfaces (button bar, menus) | `#181c22` |
| Input backgrounds | `#11151a` |
| Dropdown option panels | `#181d24` |
| Input / panel borders | `#46515f` |
| Primary text | `#f4f6f8` |
| Secondary / labels | `#aeb7c2` |
| Placeholder | `#7d8794` |
| Hover | `#263140` |
| Selected option | `#173a52` |
| Selected-value tags | dark blue-gray chip (`#1a2a3a` / `#d7e6f5`) |

Also themed: Apply/Reset/preset controls, Filter Configuration menu, loading banner, status strip, empty/error messaging, and modal chrome. Light `#f9f9f9` / white dropdown panels were removed from the Resource Selector styles.

## JavaScript / configuration logic (default All)

`DEFAULT_FILTER_CONFIG` sentinel block preserved exactly:

```text
// %%FWV7_CONFIG_BEGIN%%
const DEFAULT_FILTER_CONFIG = { ... };
// %%FWV7_CONFIG_END%%
```

Confirmed for all seven visible filters: `includeAll: true`, `allValue: "*"`. Defaults use the unrestricted **All** wildcard state (not `preselectedValues` enumerating every option).

Logic updates (FilterWidget v7 preserved; helpers added):

1. **`ensureDefaultAll` / `sanitizeSelectionAgainstOptions` / `makeAllOption`** — empty or invalid selections resolve to All.
2. **Restore priority** — URL selections → valid LocalStorage selections → All. Invalid saved/URL values are dropped; if none remain, fall back to All.
3. **`updateDashboard` (Apply)** — no longer requires every filter to have an explicit selection; untouched filters are treated as All/unrestricted.
4. **`buildFilterURL`** — filters set to All are **omitted** from `?filters=` (no blank/`*` RP condition). If every filter is All, the `filters` query param is omitted entirely.
5. **`handleFilterSelection` / tag remove** — All and specific values stay mutually exclusive; clearing the last specific value returns that filter to All.
6. **`resetFilters`** — restores every visible filter to All, clears restrictive LocalStorage filter state, and reloads the dashboard URL **without** resource-property filters.
7. **Cascade cleanup** — when downstream options invalidate prior selections, fall back to All instead of leaving a blank control.

## Validation

- Generated file **parses as valid JSON**.
- Source file `Alert_Dashboard___Operations.json` was **not overwritten** (still sizey 5, light FilterWidget CSS).
- Config sentinels intact; configuration wizard / cascading / multi-select / presets / URL filtering / LocalStorage / API cache paths retained.
- No credentials, API keys, bearer tokens, or secrets introduced.

## Testing notes / limitations

- Full portal import/runtime verification (clean browser with no URL/LocalStorage state) should be done in the target LogicMonitor portal after import.
- LogicMonitor text-widget iframes may still clip very tall open dropdown lists at the widget boundary; height was reduced for empty-space removal while keeping option panels absolutely positioned with a high z-index. If clipping appears on a specific resolution, increase Resource Selector `sizey` by 1 without reverting the dark theme or All defaults.
- Older shareable URLs that embedded explicit `*` “All” RP entries still restore to All via existing URL parse logic; new Applies omit those entries.
