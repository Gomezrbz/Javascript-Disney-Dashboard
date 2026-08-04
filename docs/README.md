# Alert Dashboard | Operations

LogicMonitor operational alert dashboard inspired by the SevOne Alert Dashboard reference. Provides global resource filtering, severity KPIs, distribution charts, a geo status map, and a native active-alert table.

**Import file (only):** [`../import/Alert_Dashboard___Operations_ResourceSelector_Dark_v1.json`](../import/Alert_Dashboard___Operations_ResourceSelector_Dark_v1.json)

**Dashboard name:** `Alert Dashboard | Operations`  
**Description:** Operational overview of active alerts, severity distribution, affected resources, and geographical status.

---

## SevOne → LogicMonitor mapping

| SevOne element | LogicMonitor equivalent | Notes |
| --- | --- | --- |
| Global filter bar (Device Groups, Object Groups, Devices, Device Metadata) | FilterWidget v7 Resource Selector | Cascading multi-select; Apply writes `?filters=` RP JSON |
| Device Groups | `system.groups` | Full group paths; glob `${value}*` for descendants |
| Object Groups | `system.categories` | Closest LM resource property; labeled **Object Groups / Categories** |
| Devices | `system.displayname` | Searchable multi-select |
| Device Metadata | Separate dropdowns: `customer`, `department`, `device_type`, `location` | Same pattern as FilterWidget v7 CapG defaults |
| Tabs (Alert Summary / Alert Details / Tree Map) | Visual section labels only | LM text widgets cannot safely implement true tabs; all sections are stacked |
| Tree Map | Not reproduced on this dashboard | Use the Alerts page header graph (tree map / time series) in the portal |
| Severity cards (Total / Critical / Warning / Notice) | Custom Text: Total / Critical / Error / Warning | LM severity taxonomy (no SevOne “Notice”) |
| Severity donut | Inline SVG donut in Alert Analytics widget | Counts must match Total |
| Top alert sources pie | Horizontal bars by `resourceTemplateName` (LogicModule) | Top 8 + Other |
| Device totals bar chart | Top Resources by Alert Count | Top 10 `monitorObjectName` |
| Location / geo status | Better Map Widget v1.18 (CDN) | Default source: **groups** |
| Active alert details table | Native `alert` widget | Cleared=no, SDT=no, Ack=all, severity critical/error/warn |

---

## Dashboard structure (12-column grid)

| Row | Widget | Type | Size | Source |
| --- | --- | --- | --- | --- |
| 1 | Resource Selector | text | 12×5 | Cloned from `_FilterWidget_v7.json` (config block only changed) |
| 6 | Section Navigation | text | 12×1 | New (visual labels) |
| 7 | Severity Breakdown & Alert Distribution | text | 12×9 | New custom analytics |
| 16 | Location Map \| Active Alert Status | text | 12×8 | Cloned from `_Example_NOC_Dashboard.json` + FilterWidget URL bridge |
| 24 | Active Alert Details | alert | 12×8 | Cloned from `_Example_NOC_Dashboard.json` (filters adjusted) |

Themes use `newBorderGray` for a compact operational look. Map tokens include `MapStyle=dark` and alert-focused ignore flags.

---

## Filters implemented

| Filter | Property | Multi-select | All | Glob / match |
| --- | --- | --- | --- | --- |
| Device Groups | `system.groups` | Yes | `*` | `${value}*` (descendants) |
| Object Groups / Categories | `system.categories` | Yes | `*` | Exact `${value}` |
| Devices | `system.displayname` | Yes | `*` | Exact `${value}` |
| Customer | `customer` | Yes | `*` | Exact |
| Department | `department` | Yes | `*` | Exact |
| Device Type | `device_type` | Yes | `*` | Exact |
| Location | `location` | Yes | `*` | Exact |

**Apply behavior**

1. FilterWidget writes LogicMonitor native resource-property filters into the dashboard URL (`?filters=`).
2. Native widgets (alert table) automatically respect those RP filters after reload.
3. Custom analytics parse the same URL parameter and translate it into `/alert/alerts` (and `/device/devices` when needed).
4. The map reads the URL and applies Device Groups (path) and Devices (resource marker filter); other metadata filters show an explicit banner.

FilterWidget v7 features preserved: cascading options, searchable multi-select, Apply/Reset, tags, URL persistence, shareable URLs, presets, API cache, configuration wizard, sentinel markers, self-update, localStorage fallback.

Sentinel markers (must remain intact):

```text
// %%FWV7_CONFIG_BEGIN%%
const DEFAULT_FILTER_CONFIG = { ... };
// %%FWV7_CONFIG_END%%
```

---

## LogicMonitor APIs used

| Endpoint | Used by | Purpose |
| --- | --- | --- |
| `GET /santaba/rest/functions/dummy` | Analytics, Map, FilterWidget | CSRF bootstrap (`X-Csrf-Token: Fetch`, `X-Version: 3`) |
| `GET /santaba/rest/device/devices` | FilterWidget options; analytics metadata resolution; map (resources mode) | Device/property enumeration |
| `GET /santaba/rest/device/groups` | Better Map (default `MapSourceType=groups`) | Group markers + `alertStatus` |
| `GET /santaba/rest/alert/alerts` | Severity / distribution analytics | Paginated active alerts (`size`≤1000, offset capped at 10000) |

**Alert query baseline (analytics):** `cleared:false`, `sdted:false`, `severity:"4"|"3"|"2"` (critical / error / warn).

**Authentication:** Portal session cookies + CSRF only. No API keys, bearer tokens, or account secrets are embedded.

---

## Map defaults

| Token / setting | Value |
| --- | --- |
| `MapSourceType` | `groups` (switchable via token; use `resources` for smaller device sets) |
| `MapStyle` | `dark` |
| `MapShowWeather` | `no` |
| `MapIgnoreCleared` | `true` |
| `MapIgnoreWarnings` | `false` |
| `MapIgnoreErrors` | `false` |
| `MapIgnoreCriticals` | `false` |
| `MapIgnoreSDT` | `true` |
| `AutoResetMapOnRefresh` | `true` |
| `HideMapOptions` | `false` |
| Location property | `location` (standard Better Map default) |

### Map filter support matrix

| FilterWidget filter | Applied on map? | How |
| --- | --- | --- |
| Device Groups (`system.groups`) | Yes | Sets `groupPathFilter` with descendant wildcards |
| Devices (`system.displayname`) | Yes | Switches source to `resources` and filters `/device/devices` responses |
| Object Groups / Categories | No | Banner message; still applied to table + analytics |
| Customer / Department / Device Type / Location | No | Banner message; still applied to table + analytics |

---

## Active Alert Details table

Cloned from `_Example_NOC_Dashboard.json` with:

- **Severity:** `critical,error,warn`
- **Cleared:** `no`
- **SDT:** `no`
- **Acknowledged:** `all` (closer to SevOne open-alert breadth than ack-only)
- **Sort:** `-startEpoch` (newest first)
- **Font:** `small-font`
- Visible columns prioritize Severity, Reported At, Resource/Website, LogicModule, Instance, Datapoint, Alert Value, thresholds, ServiceNow incident

---

## Configuration requirements (post-import)

1. **Import** `_LM_Alert_Dashboard_SevOne_Style.json` into the target portal.
2. Confirm resources have property values used by filters (`customer`, `department`, `device_type`, `location`, `system.categories` as applicable). Empty properties simply yield empty dropdown options.
3. Ensure mapped groups/resources have a valid **`location`** property (or latitude/longitude) for map pins.
4. Optionally set `MapGroupPathFilter` to a tower root (for example a Capgemini folder path) instead of `*`.
5. Optionally set `MapSourceType` to `resources` if group volume is low and device-level pins are preferred.
6. Open the dashboard, choose filters, click **Apply**, and confirm the URL contains `filters=` and that the table/KPIs/map update.
7. Use FilterWidget’s configuration wizard if the environment uses different property names—only edit within the sentinel block (or via the wizard self-update).

Clone the dashboard per business unit if RBAC or default group roots should differ; permissions still limit what each user can see.

---

## Limitations (SevOne features not reproduced exactly)

- **Interactive tabs** — labels only; sections are stacked for stability.
- **Tree Map tab** — not embedded; use the portal Alerts page tree map.
- **SevOne “Notice” severity** — mapped to LogicMonitor **Warning**.
- **Instant filter-as-you-type dashboard refresh** — FilterWidget requires **Apply** (one extra click), which reloads with URL filters.
- **Alert API custom-property filters** — `/alert/alerts` does not support arbitrary custom properties; analytics resolve matching devices via `/device/devices` first, then scope alerts.
- **Map metadata filters** — categories/customer/department/device_type/location are not silently ignored; the map shows a banner and continues with group/device scope only.
- **Pagination ceiling** — LM alert list offset limit is 10,000; analytics show a truncation warning if hit.
- **Charts** — SVG/CSS (no Chart.js CDN dependency).
- **Better Map** remains a custom CDN widget (limited LM Support coverage, as documented upstream).

---

## Source files (unchanged)

This deliverable was assembled from, without modifying:

- `_FilterWidget_v7.json`
- `_Example_NOC_Dashboard.json`
- `_Example_Exec_Dashboard.json` (theme / layout reference)
- SevOne reference image (`image (22).png`)

---

## Security notes

- No credentials, API keys, or bearer tokens are stored in the dashboard JSON.
- Custom widgets HTML-escape API-returned labels before injection.
- No `eval`, no cross-origin credentialed calls outside the portal origin, and no brittle parent-dashboard DOM repositioning for tabs.
