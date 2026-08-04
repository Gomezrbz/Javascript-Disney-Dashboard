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

The Severity widget function `propFilterClause` built LogicMonitor device filters as a JSON blob stuffed into `systemProperties:"{...}"` / `customProperties:"{...}"`. That syntax is **not valid** for `/device/devices`.

Resource Selector already avoided this pattern: it writes correct RP JSON into `?filters=` and resolves category options **client-side** from a device cache. The bug was only in Severity’s translation of those URL filters into a device API `filter=` query.

---

## Solution summary

### Filter reliability

- Removed `propFilterClause` entirely.
- Metadata filters (`system.categories`, `customer`, `department`, `device_type`, `location`) are applied by fetching devices **without** property API filters (or from cache) and matching properties in JavaScript (`getDevicePropertyValue` / `deviceMatchesMetaFilters`).
- Categories support multi-value device properties (comma/space/semicolon separated tokens).
- Empty, null, undefined, `*`, and **All** values are skipped (`isActiveFilterValue` / `buildActiveUrlFilters`).
- Zero matches show **“No matching resources found”** instead of an API error.
- Alert API filters still use supported fields only: `cleared`, `sdted`, `severity`, `monitorObjectGroups`, `monitorObjectName`.
- Debug mode (`?debug=1` or `localStorage.lmDashDebug=1`) logs the final alert filter expression and timing metrics (no credentials/tokens).

### Performance

- **`mapPool` with `CONCURRENCY = 3`** for device and alert pagination (Severity) and Resource Selector `warmDeviceCache`.
- Progressive KPI/chart render after the first alert page.
- Device cache in `sessionStorage` key `lmDashDeviceCache_v1` (30 min TTL); FilterWidget writes the same key after warm so Severity can reuse it.
- `AbortController` + load generation so obsolete responses cannot overwrite newer filter selections.
- Timeouts (30s), retries with exponential backoff on 429/5xx (up to 3).
- Partial page failure keeps already-loaded alert data with a warning.
- Interval refresh respects cache TTL (`load(false)` instead of forced refresh).

---

## Modified files

| File | Change |
| --- | --- |
| [`_extracted/severity_script_0.js`](_extracted/severity_script_0.js) | Full Severity analytics rewrite (filters + concurrency) |
| [`_extracted/fw_script_0.js`](_extracted/fw_script_0.js) | Bounded `warmDeviceCache` + shared device cache write |
| [`Alert_Dashboard___Operations_ResourceSelector_Dark_v1.json`](Alert_Dashboard___Operations_ResourceSelector_Dark_v1.json) | Primary dark dashboard — Severity + Resource Selector embedded |
| [`Alert_Dashboard___Operations.json`](Alert_Dashboard___Operations.json) | Same logic embedded |
| [`Dashboards/_LM_Alert_Dashboard_SevOne_Style.json`](Dashboards/_LM_Alert_Dashboard_SevOne_Style.json) | Packaged dashboard — same logic embedded |
| [`Dashboards/_FilterWidget_v7.json`](Dashboards/_FilterWidget_v7.json) | Bounded device warm concurrency |
| `_extracted/*Severity*.html`, `_extracted/*Resource_Selector.html` | Extracted HTML mirrors updated |
| [`_extracted/sync_embed.js`](_extracted/sync_embed.js) | Helper to re-embed scripts into JSON |
| [`_extracted/test_filter_helpers.js`](_extracted/test_filter_helpers.js) | Offline filter helper tests |

---

## Performance improvements explained

| Before | After |
| --- | --- |
| Sequential alert pages ≈ N × RTT | Up to 3 alert pages in flight after page 0 |
| Sequential device pages for meta filters | Bounded parallel device pages + 30 min cache |
| Unbounded FilterWidget `Promise.all` | Cap at 3 concurrent device pages |
| Wait for all pages before UI update | Progressive render after first page |
| Forced cache bypass every 60s | Refresh respects 45s analytics cache TTL |
| One failed call zeros entire widget | Partial results + friendly errors; empty match message |

### Before / after loading measurements

Instrument with `?debug=1` (or `localStorage.setItem('lmDashDebug','1')`). Severity `aaMeta` then includes: total ms, API call count, peak concurrency, filter ms, aggregate ms.

| Scenario | Before (approx.) | After (expected) | Notes |
| --- | --- | --- | --- |
| No filters, ~2k alerts (2 pages) | ~2 × RTT sequential (~1.5–4s) | ~1 × RTT + parallel page 2 (~0.8–2s) | Progressive KPIs after page 1 |
| Category Aruba (cold, ~8 device pages) | Device resolve sequential + often 400 fail | Device pages ≤3 concurrent or cache hit; then alerts | First cold warm shared via `lmDashDeviceCache_v1` |
| Category Aruba (warm cache) | N/A (previously failed) | Device resolve ~local filter only (~tens of ms) + alerts | Best case after Resource Selector warm |
| Large portal device warm (FilterWidget) | All pages at once (429 risk) | 3-at-a-time steady fetch | Slightly slower than unbounded parallel; safer |

*Portal wall-clock numbers depend on collector latency and portal size. Capture actuals from debug meta after import and replace the expected ranges above if needed.*

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

**Device resolve:**

```http
GET /santaba/rest/device/devices?size=1000&offset=0
  &fields=id,name,displayName,systemProperties,autoProperties,customProperties,inheritedProperties
```

(No `filter=` property clause. Client keeps devices whose `system.categories` contains `Aruba`.)

**Alert request** (example when ≤20 matching names):

```http
GET /santaba/rest/alert/alerts?size=1000&offset=0&sort=-startEpoch
  &filter=cleared:false,sdted:false,severity:"4"|"3"|"2",monitorObjectName:"deviceA|deviceB|..."
```

If more than 20 names match, the alert filter stays severity/cleared/sdted only and names are applied client-side.

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

### Offline helper tests (`node _extracted/test_filter_helpers.js`)

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
