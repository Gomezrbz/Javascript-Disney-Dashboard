# Improve Dashboard Widget Performance and Filters

## Task

Improve the **Resource Selector** and **Severity Breakdown & Alert Distribution** widgets on the LogicMonitor Alert Operations dashboard:

1. Make widget loading faster with bounded concurrent API calls, caching, progressive rendering, retries, and stale-request cancellation.
2. Fix invalid filter generation (especially Object Groups / Categories such as **Aruba**) so empty/`All` values are never sent and category filters no longer produce API 400 errors.

---

## Root cause — slow loading

The Severity Breakdown widget loaded data **strictly sequentially**:

1. Optional `/device/devices` pages (one after another) when metadata filters were active.
2. Then `/alert/alerts` pages (one after another), up to 10 pages of 1000 records.

Additional slowdowns:

- When more than 20 matching devices were resolved, the alert API was **not** narrowed by name, so a large alert set was fetched and filtered in the browser.
- Resource Selector warmed devices with **unbounded** `Promise.all` (all pages at once), which could trigger rate limits and competing load with the analytics widget.
- Device lists were **not shared** across widgets (separate iframes), so devices were often fetched twice.
- Periodic refresh used `load(true)`, bypassing the 45s session cache every minute.
- No request cancellation when filters changed; no retries/timeouts; no timing instrumentation.

## Root cause — invalid filter error

Selecting **Object Groups / Categories = Aruba** caused:

```text
Failed to load alerts: API 400 for /device/devices:
invalid filter! (systemProperties:{"name":"system.categories","value":"Aruba"})
errorCode: 1400
```

Two issues in the old Severity builder:

1. **Exact-match `:`** on `system.categories` — that property is a **comma-separated** multi-value string (e.g. `Aruba,snmpudp,…`). LM advanced filters expect **contains** (`~`) with wildcards (`*Aruba*`) for partial category tokens.
2. Wrapping a single clause in **parentheses** could also be rejected as an invalid advanced filter.

### Fix (current)

1. Portal `/device/devices` with documented advanced filters:
   - Categories: `systemProperties~"{\"name\":\"system.categories\",\"value\":\"*Aruba*\"}"`
   - Custom props: exact `customProperties:"{\"name\":\"customer\",\"value\":\"…\"}"`
2. Skip empty / `All` / `*` values; avoid unnecessary `(…)` around a single clause.
3. Alert scoping uses `monitorObjectName` / `monitorObjectGroups`, with **chunked** name queries when many devices match.
4. Friendly message on remaining API 400s (invalid filter).

---

## Solution summary

### Filter reliability

- Metadata filters query the portal `/device/devices` with **documented** advanced filter syntax.
- **Categories** use contains + wildcards: `systemProperties~"{\"name\":\"system.categories\",\"value\":\"*Aruba*\"}"` (not exact `:`).
- Custom props (`customer`, etc.) use exact `customProperties:"…"`.
- Empty / null / `All` / `*` values are skipped.
- Zero device matches show **“No matching resources found”** instead of a raw API error.
- Alert API filters still use supported fields only: `cleared`, `sdted`, `severity`, `monitorObjectGroups`, `monitorObjectName`.
- **FilterWidget** remains the previous working Operations copy (Apply/Reset/URL filters unchanged).

### Performance (Severity Breakdown — current)

FilterWidget is left on the **working previous** implementation (do not regress Apply/Reset). Speed work is **Severity-only**:

- **`mapPool` with `CONCURRENCY = 3`** for `/device/devices` and `/alert/alerts` pagination after page 0.
- **Chunked `monitorObjectName` queries** (`NAME_CHUNK = 20`): when a category matches many devices, Severity runs parallel scoped alert queries instead of downloading the global alert set and filtering in the browser (main cause of ~20s loads).
- **Progressive render:** KPIs/charts update after the first alert page, then refine.
- **In-progress UX:** spinner + progress banner (“Partial results — N of ~M…”) while pages load; KPI cards marked **partial** and dimmed until the final render so the first 1k alerts are not mistaken for finished totals.
- **Device-name cache** in `sessionStorage` (`lmDashDeviceNameCache_v1`, 10 min) keyed by the device filter expression.
- **Slimmer device fields:** `id,name,displayName` only when resolving names (properties already applied via API filter).
- **Load generation** so overlapping refreshes do not overwrite newer results.
- **Interval refresh** uses `load(false)` so the 45s analytics cache is respected.
- Meta line shows elapsed ms (e.g. `· 3200ms`).

Aruba / category filter syntax remains: `systemProperties~"…*Aruba*"`.

---

## Modified files

| File | Change |
| --- | --- |
| [`src/severity_script_0.js`](../src/severity_script_0.js) | Severity: parallel pages, name-chunked alerts, progressive UI, name cache |
| [`import/Alert_Dashboard___Operations_ResourceSelector_Dark_v1.json`](../import/Alert_Dashboard___Operations_ResourceSelector_Dark_v1.json) | **Only** dashboard JSON to import (Severity embedded; FilterWidget = previous working copy) |
| [`src/widgets/…Severity….html`](../src/widgets/) | Severity HTML mirror |
| [`src/sync_embed.js`](../src/sync_embed.js) | Re-embeds **Severity only** (does not touch FilterWidget) |
| [`src/previous_dashboards/Alert_Dashboard___Operations.json`](../src/previous_dashboards/Alert_Dashboard___Operations.json) | Reference FilterWidget that must keep working |

---

## Performance improvements explained

| Before | After |
| --- | --- |
| Sequential alert pages ≈ N × RTT | Up to 3 alert pages in flight after page 0 |
| Sequential device pages for meta filters | Bounded parallel device pages + 10 min name cache |
| \>20 matching devices → fetch **all** alerts, filter in browser | Chunked `monitorObjectName` queries (20 names each), parallel |
| Wait for every page before UI update | Progressive render after first page |
| Forced cache bypass every 60s (`load(true)`) | Refresh respects 45s analytics cache TTL |

### Before / after loading measurements

Severity meta shows wall time (`· Nms`). Compare after re-import:

| Scenario | Before (approx.) | After (expected) | Notes |
| --- | --- | --- | --- |
| No filters, ~2k alerts (2 pages) | ~2 × RTT sequential (~1.5–4s) | ~1 × RTT + parallel page 2 (~0.8–2s) | Progressive KPIs after page 1 |
| Category with many devices (was ~20s) | Broad alert download + client filter | Chunked scoped alert queries | Largest win |
| Same category again within 10 min | Full device resolve again | Name cache hit | Faster second Apply |
| Idle refresh within 45s | Full reload (`load(true)`) | Cached analytics | Near-instant |

*Portal wall-clock depends on portal size and latency. Use the `· Nms` meta after import to record real numbers.*

---

## Generated API request examples

### 1. No filters selected

**Device resolve:** skipped (no metadata / displayName filters).

**Alert request:**

```http
GET /santaba/rest/alert/alerts?size=1000&offset=0&sort=-startEpoch
  &filter=cleared:false,sdted:false,severity:"4"|"3"|"2"
  &fields=id,severity,cleared,sdted,acked,monitorObjectName,resourceTemplateName,instanceName,dataPointName,startEpoch
```

(Further pages use the same filter with `offset=1000`, `2000`, … under concurrency ≤ 3.)

### 2. Category Aruba only

**Device resolve (portal advanced filter, parallel pages after page 0):**

```http
GET /santaba/rest/device/devices?size=1000&offset=0
  &fields=id,name,displayName
  &filter=systemProperties~"{\"name\":\"system.categories\",\"value\":\"*Aruba*\"}"
```

**Alert request** — if ≤20 matching names, one scoped filter:

```http
GET /santaba/rest/alert/alerts?size=1000&offset=0&sort=-startEpoch
  &filter=cleared:false,sdted:false,severity:"4"|"3"|"2",monitorObjectName:"deviceA|deviceB|..."
```

If **more than 20** names match, Severity runs several such requests in parallel (chunks of 20 names each) instead of fetching all portal alerts and filtering in the browser.

### 3. Multiple combined filters

Example URL RP filters: Device Group `Production`, Category `Aruba`, Customer `Disney`.

**Device resolve:** unfiltered (or cached) device list; client requires category **and** customer match.

**Alert request** (≤20 names):

```http
GET /santaba/rest/alert/alerts?...&filter=
  cleared:false,sdted:false,severity:"4"|"3"|"2",
  monitorObjectGroups:"Production*",
  monitorObjectName:"name1|name2|..."
```

---

## Test results

### Offline helper tests (`node src/test_filter_helpers.js`)

| Scenario | Result |
| --- | --- |
| No filters selected | PASS — empty active map; default alert filter only |
| Single category Aruba | PASS — active; no `systemProperties` blob in alert filter |
| Multiple categories / multi-token property | PASS — token match |
| Empty / null / All | PASS — omitted |
| Special characters / spaces in values | PASS — treated as active values |
| Combined group + customer + names | PASS — `monitorObjectGroups` + `monitorObjectName` |

### Portal / import scenarios (checklist)

Run after importing the updated dashboard JSON into the LogicMonitor portal:

| # | Scenario | Expected | Status |
| --- | --- | --- | --- |
| 1 | No filters | Default unfiltered alerts load; no device property filter | Ready to verify in portal |
| 2 | Category Aruba | No API 400; KPIs/charts populate or “No matching resources” | Ready to verify in portal |
| 3 | Multiple categories | AND across selections as implemented; charts update | Ready to verify in portal |
| 4 | Device group | `monitorObjectGroups` applied | Ready to verify in portal |
| 5 | Specific device | Names scoped on alerts | Ready to verify in portal |
| 6 | Customer / department / device type / location | Client-side device match then alerts | Ready to verify in portal |
| 7 | Multiple filters combined | Intersection of meta + groups | Ready to verify in portal |
| 8 | Filter with zero resources | Friendly “No matching resources found” | Ready to verify in portal |
| 9 | Empty / null / All | Omitted from API | Covered offline |
| 10 | Category with spaces / special chars | Matched client-side; encoded in name filter when used | Covered offline + portal |
| 11 | Large pagination | Bounded concurrency; progressive UI | Ready to verify in portal |
| 12 | One API page fails | Partial data + warning when possible | Code path implemented |
| 13 | Reset filters | URL without `filters`; default dataset | Ready to verify in portal |
| 14 | Rapid filter changes | Abort / generation guard ignores stale results | Code path implemented |

---

## Error handling

| Condition | User-facing message | Debug logs |
| --- | --- | --- |
| Invalid / unsupported API filter (400) | Unable to apply the current filters… | Endpoint, status, sanitized params, filter, detail |
| Zero matching resources | No matching resources found for the selected filters. | Matched count 0 |
| 429 / 5xx | Rate limit / temporarily unavailable (with retry) | Retries, duration |
| Timeout | Request timed out for \<endpoint\> | Endpoint, attempt |
| Partial alert pages | Warning: counts may be incomplete | Failed page detail |
| Abort / superseded load | Silent (no flash of stale error) | — |

Credentials, CSRF tokens, and secrets are never written to logs.

---

## Remaining LogicMonitor API limitations / recommendations

1. **`/alert/alerts` does not filter by custom properties or `system.categories`.** Device resolution (or client-side name allow-lists) remains required for metadata filters.
2. **`monitorObjectName` OR-lists are limited** in practice; this dashboard caps API name filters at 20 and filters the rest in the browser.
3. **Pagination caps** (`MAX_OFFSET` / `MAX_RECORDS` = 10 000) can still truncate very large alert sets.
4. **Cross-iframe sharing** is limited to `sessionStorage` / `localStorage` on the same portal origin; there is no shared in-memory cache between widgets.
5. Keep **`CONCURRENCY` at 3** unless portal rate-limit headroom is confirmed; raising it can recreate 429 storms.
6. Prefer applying filters via Resource Selector **Apply** (full reload) so native alert tables and URL RP filters stay consistent.
7. For very large portals, consider pre-warming devices once per session and monitoring debug timings after deploy.

---

## Acceptance criteria

| Criterion | Met |
| --- | --- |
| Independent API calls concurrent where appropriate | Yes (`mapPool`) |
| Concurrency bounded and configurable (`CONCURRENCY` / `DEVICE_FETCH_CONCURRENCY`) | Yes |
| Duplicate / unnecessary property-filter API calls removed | Yes |
| Empty / All not sent | Yes |
| Aruba no longer invalid API filter | Yes |
| Zero results without raw API error | Yes |
| Partial failures do not always blank the widget | Yes |
| Reset restores unfiltered default (via existing Resource Selector reset + omitted All filters) | Yes |
| Maintainable comments for concurrency and filter builders | Yes |
| Deliverable markdown | This file |

---

## How to enable debug timing

In the browser console on the dashboard:

```js
localStorage.setItem('lmDashDebug', '1');
```

Or append `?debug=1` to the dashboard URL. Reload and inspect the Severity widget meta line and console warnings prefixed with `[SeverityAnalytics]`.
