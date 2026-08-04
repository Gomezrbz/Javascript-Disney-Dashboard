(function () {
  /* Severity Breakdown & Alert Distribution — performance + filter reliability
   * - Metadata filters use LM advanced device filters (portal), with a safe syntax:
   *   categories use contains (~) + *value* (multi-token props); no wrapping () that LM rejects
   * - On API 400 / empty, fall back to unfiltered device pages + client-side match (FilterWidget style)
   * - Bounded parallel pagination (CONCURRENCY), progressive render, retries, AbortController
   */
  const CACHE_KEY = 'lmAlertDashAnalytics_v1';
  const CACHE_TTL_MS = 45000;
  const DEVICE_CACHE_KEY = 'lmDashDeviceCache_v1';
  const DEVICE_CACHE_TTL_MS = 30 * 60 * 1000;
  const PAGE_SIZE = 1000;
  const MAX_OFFSET = 10000;
  const MAX_RECORDS = 10000;
  const REFRESH_MS = 60000;
  const CONCURRENCY = 3; // bounded parallel API pages — do not raise without checking LM rate limits
  const REQUEST_TIMEOUT_MS = 30000;
  const MAX_RETRIES = 3;
  const SEV_COLORS = { critical: '#e0351b', error: '#ff8c00', warn: '#f5ca1d' };
  const SEV_LABELS = { critical: 'Critical', error: 'Error', warn: 'Warning' };
  // system:true → systemProperties; contains:true → ~"*value*" (needed for system.categories)
  const META_PROPS = [
    { n: 'system.categories', system: true, contains: true },
    { n: 'customer', system: false, contains: false },
    { n: 'department', system: false, contains: false },
    { n: 'device_type', system: false, contains: false },
    { n: 'location', system: false, contains: false }
  ];
  const PROP_ARRAYS = ['systemProperties', 'autoProperties', 'customProperties', 'inheritedProperties'];

  let csrfToken = null;
  let csrfFetchedAt = 0;
  const CSRF_TTL = 4 * 60 * 1000;

  let loadGeneration = 0;
  let activeAbort = null;
  let peakConcurrency = 0;
  let inFlight = 0;
  const metrics = {
    apiCalls: 0,
    requestMs: [],
    filterMs: 0,
    aggregateMs: 0,
    totalMs: 0
  };

  function isDebug() {
    try {
      if (localStorage.getItem('lmDashDebug') === '1') return true;
      const loc = (parent && parent.window && parent.window.location) ? parent.window.location : window.location;
      return new URLSearchParams(loc.search).get('debug') === '1';
    } catch (e) {
      return false;
    }
  }

  function debugLog() {
    if (!isDebug()) return;
    const args = Array.prototype.slice.call(arguments);
    args.unshift('[SeverityAnalytics]');
    console.warn.apply(console, args);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function parseFiltersFromURL() {
    try {
      const loc = (parent && parent.window && parent.window.location) ? parent.window.location : window.location;
      const params = new URLSearchParams(loc.search);
      const raw = params.get('filters');
      if (!raw) return [];
      const parsed = JSON.parse(decodeURIComponent(raw));
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function isActiveFilterValue(v) {
    if (v == null) return false;
    const s = String(v).trim();
    if (!s) return false;
    if (s === '*' || s.toLowerCase() === 'all') return false;
    return true;
  }

  function selectedValues(filterEntry) {
    if (!filterEntry || !Array.isArray(filterEntry.v)) return [];
    return filterEntry.v
      .filter(function (x) { return x && (x.isSelected !== false); })
      .map(function (x) { return String(x.value == null ? '' : x.value); })
      .filter(isActiveFilterValue);
  }

  function stripGlob(v) {
    return String(v).replace(/\*+$/, '');
  }

  function isAllOrEmpty(vals) {
    return !vals || !vals.length || vals.every(function (v) { return !isActiveFilterValue(v); });
  }

  /** Build a clean map of active URL filter property → values (skips All/empty). */
  function buildActiveUrlFilters(urlFilters) {
    const byProp = {};
    (urlFilters || []).forEach(function (f) {
      if (!f || !f.n) return;
      const vals = selectedValues(f).map(stripGlob).filter(isActiveFilterValue);
      if (vals.length) byProp[f.n] = vals;
    });
    return byProp;
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /**
   * Run async work items with a fixed concurrency ceiling.
   * Prevents uncontrolled parallel storms against the LogicMonitor API.
   */
  async function mapPool(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const workers = [];
    const n = Math.min(limit, Math.max(1, items.length));
    for (let w = 0; w < n; w++) {
      workers.push((async function () {
        while (true) {
          const i = next++;
          if (i >= items.length) return;
          results[i] = await worker(items[i], i);
        }
      })());
    }
    await Promise.all(workers);
    return results;
  }

  async function fetchCsrf() {
    const now = Date.now();
    if (csrfToken && (now - csrfFetchedAt) < CSRF_TTL) return csrfToken;
    const resp = await fetch('/santaba/rest/functions/dummy', {
      method: 'GET',
      credentials: 'include',
      headers: { 'X-Csrf-Token': 'Fetch', 'X-Version': '3', 'Accept': 'application/json' }
    });
    csrfToken = resp.headers.get('X-Csrf-Token') || resp.headers.get('x-csrf-token');
    csrfFetchedAt = now;
    if (!csrfToken) throw new Error('Unable to obtain CSRF token');
    return csrfToken;
  }

  function friendlyApiError(status, endpoint, bodySnippet) {
    if (status === 400) return 'Unable to apply the current filters. Try resetting filters or choosing different values.';
    if (status === 401 || status === 403) return 'You do not have permission to load alert data.';
    if (status === 429) return 'LogicMonitor rate limit reached. Retrying…';
    if (status >= 500) return 'LogicMonitor is temporarily unavailable. Retrying…';
    return 'Failed to load data from ' + endpoint + (status ? ' (HTTP ' + status + ')' : '');
  }

  /**
   * GET with timeout, AbortSignal, retries/backoff for transient errors, and debug timing.
   * Never logs CSRF tokens or credentials.
   */
  async function lmGet(pathWithQuery, signal) {
    const endpoint = pathWithQuery.split('?')[0];
    const qs = pathWithQuery.indexOf('?') >= 0 ? pathWithQuery.slice(pathWithQuery.indexOf('?') + 1) : '';
    let filterParam = '';
    try {
      filterParam = new URLSearchParams(qs).get('filter') || '';
    } catch (e) { /* ignore */ }

    let lastErr = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal && signal.aborted) {
        const abortErr = new Error('Request cancelled');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      const started = Date.now();
      inFlight++;
      if (inFlight > peakConcurrency) peakConcurrency = inFlight;
      metrics.apiCalls++;
      let timedOut = false;
      const controller = new AbortController();
      const onAbort = function () { controller.abort(); };
      if (signal) signal.addEventListener('abort', onAbort);
      const timer = setTimeout(function () {
        timedOut = true;
        controller.abort();
      }, REQUEST_TIMEOUT_MS);

      try {
        const token = await fetchCsrf();
        const resp = await fetch('/santaba/rest' + pathWithQuery, {
          method: 'GET',
          credentials: 'include',
          signal: controller.signal,
          headers: {
            'X-Csrf-Token': token,
            'X-Version': '3',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        });
        const elapsed = Date.now() - started;
        metrics.requestMs.push(elapsed);
        const bodyText = resp.ok ? '' : await resp.text().catch(function () { return ''; });

        debugLog({
          endpoint: endpoint,
          status: resp.status,
          ms: elapsed,
          retries: attempt,
          filter: filterParam ? filterParam.slice(0, 200) : '(none)',
          params: qs.replace(/filter=[^&]*/, 'filter=<redacted>').slice(0, 240)
        });

        if (resp.ok) {
          return await resp.json();
        }

        const retryable = resp.status === 429 || resp.status >= 500;
        lastErr = new Error(friendlyApiError(resp.status, endpoint, bodyText));
        lastErr.status = resp.status;
        lastErr.endpoint = endpoint;
        lastErr.detail = bodyText.slice(0, 300);
        lastErr.filter = filterParam;
        debugLog('API error', { status: resp.status, endpoint: endpoint, detail: bodyText.slice(0, 200), retries: attempt });

        if (!retryable || attempt === MAX_RETRIES) throw lastErr;
        await sleep(Math.min(8000, 400 * Math.pow(2, attempt)));
      } catch (err) {
        if (err && err.name === 'AbortError') {
          if (timedOut) {
            lastErr = new Error('Request timed out for ' + endpoint);
            lastErr.status = 0;
            lastErr.endpoint = endpoint;
            if (attempt === MAX_RETRIES) throw lastErr;
            await sleep(Math.min(8000, 400 * Math.pow(2, attempt)));
          } else {
            throw err;
          }
        } else if (err && err.status) {
          throw err;
        } else {
          lastErr = err;
          if (attempt === MAX_RETRIES) throw err;
          await sleep(Math.min(8000, 400 * Math.pow(2, attempt)));
        }
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        inFlight--;
      }
    }
    throw lastErr || new Error('Request failed for ' + endpoint);
  }

  function extractItems(data) {
    return (data && data.data && data.data.items) || (data && data.items) || [];
  }

  function extractTotal(data, items) {
    if (data && data.data && typeof data.data.total === 'number') return data.data.total;
    if (typeof data.total === 'number') return data.total;
    return items.length;
  }

  /** Read property value from device (mirrors FilterWidget findProperty). */
  function getDevicePropertyValue(device, propName) {
    for (let i = 0; i < PROP_ARRAYS.length; i++) {
      const arr = device[PROP_ARRAYS[i]];
      if (!Array.isArray(arr)) continue;
      for (let j = 0; j < arr.length; j++) {
        if (arr[j] && arr[j].name === propName && arr[j].value != null && arr[j].value !== '') {
          return String(arr[j].value);
        }
      }
    }
    return null;
  }

  /**
   * Match device property to selected filter values.
   * Categories (and other multi-token props) are comma-delimited like FilterWidget.
   */
  function propertyMatches(rawValue, wantedValues, useCommaSplit) {
    if (rawValue == null) return false;
    const raw = String(rawValue);
    const wanted = wantedValues.map(function (w) { return String(w).trim().toLowerCase(); }).filter(Boolean);
    if (!wanted.length) return true;
    if (useCommaSplit) {
      const tokens = raw.split(',').map(function (t) { return t.trim().toLowerCase(); }).filter(Boolean);
      return wanted.some(function (w) {
        return tokens.indexOf(w) >= 0 || tokens.some(function (t) { return t.indexOf(w) >= 0; });
      });
    }
    const lower = raw.toLowerCase().trim();
    return wanted.some(function (w) { return lower === w; });
  }

  function deviceMatchesMetaFilters(device, activeMeta) {
    for (let i = 0; i < META_PROPS.length; i++) {
      const p = META_PROPS[i];
      const vals = activeMeta[p.n];
      if (!vals || !vals.length) continue;
      const raw = getDevicePropertyValue(device, p.n);
      if (!propertyMatches(raw, vals, !!p.contains)) return false;
    }
    return true;
  }

  function readDeviceCache() {
    try {
      const raw = sessionStorage.getItem(DEVICE_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.ts && (Date.now() - parsed.ts) < DEVICE_CACHE_TTL_MS &&
            Array.isArray(parsed.devices) && parsed.devices.length) {
          return parsed.devices;
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function writeDeviceCache(devices) {
    try {
      sessionStorage.setItem(DEVICE_CACHE_KEY, JSON.stringify({
        ts: Date.now(),
        devices: devices.map(function (d) {
          return {
            id: d.id,
            name: d.name,
            displayName: d.displayName,
            systemProperties: d.systemProperties,
            autoProperties: d.autoProperties,
            customProperties: d.customProperties,
            inheritedProperties: d.inheritedProperties
          };
        })
      }));
    } catch (e) { /* quota */ }
  }

  /**
   * Build LM advanced property filter clauses (documented REST advanced filters).
   * - Skip All/empty
   * - Categories use contains (~) with *value* so multi-value system.categories match
   * - Do NOT wrap a single clause in () — LM returns invalid filter! for that form
   */
  function propFilterClause(propName, values, systemProp, useContains) {
    const parts = [];
    values.forEach(function (v) {
      const clean = stripGlob(v).trim();
      if (!isActiveFilterValue(clean)) return;
      const key = systemProp ? 'systemProperties' : 'customProperties';
      const op = useContains ? '~' : ':';
      const value = useContains ? ('*' + clean.replace(/\*/g, '') + '*') : clean;
      const obj = JSON.stringify({ name: propName, value: value }).replace(/"/g, '\\"');
      parts.push(key + op + '"' + obj + '"');
    });
    return parts;
  }

  /** Combine active meta filters into one device API filter expression (or '' if none). */
  function buildDeviceMetaFilter(activeMeta) {
    const andParts = [];
    META_PROPS.forEach(function (p) {
      const vals = activeMeta[p.n];
      if (!vals || !vals.length) return;
      const pcs = propFilterClause(p.n, vals, p.system, p.contains);
      if (!pcs.length) return;
      // OR within same property; AND across properties (comma). Avoid outer () on single clause.
      andParts.push(pcs.length === 1 ? pcs[0] : '(' + pcs.join(' || ') + ')');
    });
    return andParts.join(',');
  }

  /** Paginate /device/devices with optional filter; bounded concurrency after page 0. */
  async function fetchDevicesPages(filterExpr, signal) {
    const fields = 'id,name,displayName,systemProperties,autoProperties,customProperties,inheritedProperties';
    const filterQs = filterExpr ? '&filter=' + encodeURIComponent(filterExpr) : '';
    const firstQ = '/device/devices?size=' + PAGE_SIZE + '&offset=0&fields=' + fields + filterQs;
    const firstData = await lmGet(firstQ, signal);
    const firstItems = extractItems(firstData);
    const total = extractTotal(firstData, firstItems);
    const devices = firstItems.slice();

    const totalPages = Math.ceil(Math.min(total, MAX_OFFSET) / PAGE_SIZE);
    if (totalPages > 1 && firstItems.length >= PAGE_SIZE) {
      const offsets = [];
      for (let page = 1; page < totalPages; page++) offsets.push(page * PAGE_SIZE);
      const pages = await mapPool(offsets, CONCURRENCY, async function (offset) {
        const q = '/device/devices?size=' + PAGE_SIZE + '&offset=' + offset + '&fields=' + fields + filterQs;
        const data = await lmGet(q, signal);
        return extractItems(data);
      });
      pages.forEach(function (items) {
        for (let i = 0; i < items.length; i++) devices.push(items[i]);
      });
    }
    return devices;
  }

  async function fetchAllDevicesUnfiltered(signal) {
    const cached = readDeviceCache();
    if (cached) {
      debugLog('Using device cache', { count: cached.length });
      return cached;
    }
    const devices = await fetchDevicesPages('', signal);
    writeDeviceCache(devices);
    return devices;
  }

  /**
   * Resolve device names for metadata filters via portal /device/devices when possible.
   * Falls back to client-side property matching if the advanced filter is rejected (400)
   * or returns nothing useful.
   */
  async function resolveDeviceNames(urlFilters, signal) {
    const byProp = buildActiveUrlFilters(urlFilters);
    const displayNames = (byProp['system.displayname'] || []).filter(isActiveFilterValue);

    const activeMeta = {};
    let hasMeta = false;
    META_PROPS.forEach(function (p) {
      if (byProp[p.n] && byProp[p.n].length) {
        activeMeta[p.n] = byProp[p.n];
        hasMeta = true;
      }
    });

    if (!hasMeta && !displayNames.length) {
      return { names: null, forcedNames: null, emptyMatch: false };
    }

    if (displayNames.length && !hasMeta) {
      return { names: displayNames, forcedNames: displayNames, emptyMatch: false };
    }

    const t0 = Date.now();
    const deviceFilter = buildDeviceMetaFilter(activeMeta);
    debugLog('Device meta filter expression', deviceFilter || '(none)');

    let devices = [];
    let usedClientSide = false;

    try {
      devices = await fetchDevicesPages(deviceFilter, signal);
      // Exact-match API filters can miss multi-token categories; if empty, try client-side
      if (!devices.length && deviceFilter) {
        debugLog('API filter returned 0 devices — falling back to client-side match');
        usedClientSide = true;
        const all = await fetchAllDevicesUnfiltered(signal);
        devices = all.filter(function (d) { return deviceMatchesMetaFilters(d, activeMeta); });
      }
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      // Original Aruba bug: invalid advanced filter → 400. Fall back instead of failing the widget.
      if (err && (err.status === 400 || (err.detail && /invalid filter/i.test(err.detail)))) {
        debugLog('API filter rejected — client-side fallback', err.detail || err.message);
        usedClientSide = true;
        try {
          const all = await fetchAllDevicesUnfiltered(signal);
          devices = all.filter(function (d) { return deviceMatchesMetaFilters(d, activeMeta); });
        } catch (err2) {
          if (err2 && err2.name === 'AbortError') throw err2;
          debugLog('Client-side device fetch failed', err2 && err2.message);
          throw new Error('Unable to resolve resources for the selected filters. Please try again.');
        }
      } else {
        debugLog('Device fetch failed', err && err.message);
        throw new Error('Unable to resolve resources for the selected filters. Please try again.');
      }
    }

    // Always verify client-side for contains/categories so *partial* API matches stay accurate
    if (!usedClientSide && hasMeta) {
      devices = devices.filter(function (d) { return deviceMatchesMetaFilters(d, activeMeta); });
    }

    metrics.filterMs += Date.now() - t0;

    let names = [];
    devices.forEach(function (d) {
      if (d.displayName) names.push(d.displayName);
      if (d.name && d.name !== d.displayName) names.push(d.name);
    });
    names = Array.from(new Set(names));

    if (displayNames.length) {
      const allowed = new Set(displayNames);
      names = names.filter(function (n) { return allowed.has(n); });
    }

    debugLog('resolveDeviceNames', {
      meta: activeMeta,
      deviceFilter: deviceFilter,
      usedClientSide: usedClientSide,
      matchedDevices: devices.length,
      names: names.length
    });

    if (hasMeta && !names.length) {
      return { names: [], forcedNames: displayNames.length ? displayNames : null, emptyMatch: true };
    }

    return { names: names, forcedNames: displayNames.length ? displayNames : null, emptyMatch: false };
  }

  function buildAlertFilter(urlFilters, deviceNames) {
    const parts = ['cleared:false', 'sdted:false', 'severity:"4"|"3"|"2"'];
    const byProp = buildActiveUrlFilters(urlFilters);

    const groups = byProp['system.groups'] || [];
    if (groups.length) {
      const gvals = groups.map(function (g) {
        const base = stripGlob(g);
        return base.endsWith('*') ? base : (base + '*');
      }).join('|');
      parts.push('monitorObjectGroups:"' + gvals.replace(/"/g, '') + '"');
    }

    if (deviceNames && deviceNames.length) {
      if (deviceNames.length === 1) {
        parts.push('monitorObjectName:"' + deviceNames[0].replace(/"/g, '') + '"');
      } else if (deviceNames.length <= 20) {
        parts.push('monitorObjectName:"' + deviceNames.map(function (n) { return n.replace(/"/g, ''); }).join('|') + '"');
      }
      // if many names, fetch broadly and filter client-side via nameAllowSet
    }

    const expr = parts.join(',');
    debugLog('buildAlertFilter', expr);
    return expr;
  }

  function normalizeSeverity(a) {
    const s = a.severity;
    if (s === 4 || s === '4' || s === 'critical') return 'critical';
    if (s === 3 || s === '3' || s === 'error') return 'error';
    if (s === 2 || s === '2' || s === 'warn' || s === 'warning') return 'warn';
    return null;
  }

  function pushAlertItems(alerts, items, nameAllowSet) {
    items.forEach(function (a) {
      if (nameAllowSet && nameAllowSet.size) {
        const n = a.monitorObjectName || '';
        if (!nameAllowSet.has(n)) return;
      }
      const sev = normalizeSeverity(a);
      if (!sev) return;
      alerts.push({
        severity: sev,
        monitorObjectName: a.monitorObjectName || 'Unknown',
        resourceTemplateName: a.resourceTemplateName || a.instanceName || 'Unknown'
      });
    });
  }

  /**
   * Fetch alerts with bounded parallel pages after first page; optionally progressive callback.
   */
  async function fetchAllAlerts(filter, nameAllowSet, signal, onProgress) {
    const alerts = [];
    let truncated = false;
    let partialError = false;
    const fields = 'id,severity,cleared,sdted,acked,monitorObjectName,resourceTemplateName,instanceName,dataPointName,startEpoch';
    const firstQ = '/alert/alerts?size=' + PAGE_SIZE + '&offset=0&sort=-startEpoch&filter=' +
      encodeURIComponent(filter) + '&fields=' + fields;

    const firstData = await lmGet(firstQ, signal);
    const firstItems = extractItems(firstData);
    const total = extractTotal(firstData, firstItems);
    pushAlertItems(alerts, firstItems, nameAllowSet);

    if (typeof onProgress === 'function') {
      onProgress({ alerts: alerts.slice(), truncated: false, reportedTotal: total, partial: true });
    }

    const maxPages = Math.ceil(Math.min(total, MAX_OFFSET, MAX_RECORDS) / PAGE_SIZE);
    if (maxPages > 1 && firstItems.length >= PAGE_SIZE) {
      const offsets = [];
      for (let page = 1; page < maxPages; page++) {
        offsets.push(page * PAGE_SIZE);
      }
      try {
        const pages = await mapPool(offsets, CONCURRENCY, async function (offset) {
          const q = '/alert/alerts?size=' + PAGE_SIZE + '&offset=' + offset +
            '&sort=-startEpoch&filter=' + encodeURIComponent(filter) + '&fields=' + fields;
          const data = await lmGet(q, signal);
          return extractItems(data);
        });
        pages.forEach(function (items) {
          pushAlertItems(alerts, items, nameAllowSet);
        });
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        // Keep partial results if we already have some pages
        if (alerts.length) {
          partialError = true;
          truncated = true;
          debugLog('Partial alert fetch failure', err && err.message);
        } else {
          throw err;
        }
      }
    }

    if (total > MAX_RECORDS || total > MAX_OFFSET || alerts.length >= MAX_RECORDS) truncated = true;
    if (alerts.length > MAX_RECORDS) {
      alerts.length = MAX_RECORDS;
      truncated = true;
    }
    return { alerts: alerts, truncated: truncated, reportedTotal: total, partialError: partialError };
  }

  function aggregate(alerts) {
    const t0 = Date.now();
    const counts = { critical: 0, error: 0, warn: 0 };
    const sources = {};
    const resources = {};
    alerts.forEach(function (a) {
      counts[a.severity] = (counts[a.severity] || 0) + 1;
      sources[a.resourceTemplateName] = (sources[a.resourceTemplateName] || 0) + 1;
      resources[a.monitorObjectName] = (resources[a.monitorObjectName] || 0) + 1;
    });
    const total = counts.critical + counts.error + counts.warn;
    function topN(map, n) {
      return Object.keys(map).map(function (k) { return { name: k, count: map[k] }; })
        .sort(function (a, b) { return b.count - a.count; })
        .slice(0, n);
    }
    function topWithOther(map, n) {
      const sorted = Object.keys(map).map(function (k) { return { name: k, count: map[k] }; })
        .sort(function (a, b) { return b.count - a.count; });
      const head = sorted.slice(0, n);
      const rest = sorted.slice(n);
      const other = rest.reduce(function (s, x) { return s + x.count; }, 0);
      if (other > 0) head.push({ name: 'Other', count: other });
      return head;
    }
    const result = {
      total: total,
      counts: counts,
      sources: topWithOther(sources, 8),
      resources: topN(resources, 10)
    };
    metrics.aggregateMs += Date.now() - t0;
    return result;
  }

  function donutSvg(counts, total) {
    if (!total) return '<div class="aa-empty">No active alerts for the current filters</div>';
    const order = ['critical', 'error', 'warn'];
    const r = 42;
    const c = 2 * Math.PI * r;
    let offset = c * 0.25;
    let arcs = '';
    order.forEach(function (k) {
      const n = counts[k] || 0;
      if (!n) return;
      const len = (n / total) * c;
      arcs += '<circle cx="60" cy="60" r="' + r + '" fill="transparent" stroke="' + SEV_COLORS[k] +
        '" stroke-width="16" stroke-dasharray="' + len + ' ' + (c - len) +
        '" stroke-dashoffset="' + offset + '"></circle>';
      offset -= len;
    });
    const legend = order.map(function (k) {
      const n = counts[k] || 0;
      const pct = total ? ((n / total) * 100).toFixed(1) : '0.0';
      return '<li><span class="aa-swatch" style="background:' + SEV_COLORS[k] + '"></span>' +
        esc(SEV_LABELS[k]) + ' — ' + n + ' (' + pct + '%)</li>';
    }).join('');
    return '<svg viewBox="0 0 120 120" width="140" height="140" aria-label="Severity distribution">' +
      '<circle cx="60" cy="60" r="' + r + '" fill="transparent" stroke="#2a2f36" stroke-width="16"></circle>' +
      arcs +
      '<text x="60" y="56" text-anchor="middle" fill="#e8eaed" font-size="18" font-weight="700">' + total + '</text>' +
      '<text x="60" y="72" text-anchor="middle" fill="#9aa3ad" font-size="9">TOTAL</text></svg>' +
      '<ul class="aa-legend">' + legend + '</ul>';
  }

  function pieLikeBars(items, color) {
    if (!items.length) return '<div class="aa-empty">No data</div>';
    const max = Math.max.apply(null, items.map(function (x) { return x.count; })) || 1;
    return '<div class="aa-bars">' + items.map(function (x) {
      const pct = Math.max(2, Math.round((x.count / max) * 100));
      return '<div class="aa-bar-row" title="' + esc(x.name) + ': ' + x.count + '">' +
        '<div class="aa-bar-label">' + esc(x.name) + '</div>' +
        '<div class="aa-bar-track"><div class="aa-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>' +
        '<div class="aa-bar-n">' + x.count + '</div></div>';
    }).join('') + '</div>';
  }

  function render(agg, meta) {
    document.getElementById('aaTotal').textContent = String(agg.total);
    document.getElementById('aaCrit').textContent = String(agg.counts.critical || 0);
    document.getElementById('aaErrorCnt').textContent = String(agg.counts.error || 0);
    document.getElementById('aaWarn').textContent = String(agg.counts.warn || 0);
    document.getElementById('aaDonut').innerHTML = donutSvg(agg.counts, agg.total);
    document.getElementById('aaSources').innerHTML = pieLikeBars(agg.sources, '#2f81f7');
    document.getElementById('aaResources').innerHTML = pieLikeBars(agg.resources, '#ff8c00');
    document.getElementById('aaMeta').textContent = meta;
    const tw = document.getElementById('aaTruncWarn');
    if (meta.indexOf('truncated') >= 0 || meta.indexOf('partial') >= 0) {
      tw.style.display = 'block';
      tw.textContent = meta.indexOf('partial') >= 0
        ? 'Some API pages failed; counts may be incomplete.'
        : 'Results truncated at API pagination limit; counts may be incomplete.';
    } else {
      tw.style.display = 'none';
    }
  }

  function setEmptyMatch() {
    clearError();
    const el = document.getElementById('aaError');
    el.style.display = 'block';
    el.textContent = 'No matching resources found for the selected filters.';
    document.getElementById('aaTotal').textContent = '0';
    document.getElementById('aaCrit').textContent = '0';
    document.getElementById('aaErrorCnt').textContent = '0';
    document.getElementById('aaWarn').textContent = '0';
    document.getElementById('aaDonut').innerHTML = '<div class="aa-empty">No matching resources found</div>';
    document.getElementById('aaSources').innerHTML = '<div class="aa-empty">No data</div>';
    document.getElementById('aaResources').innerHTML = '<div class="aa-empty">No data</div>';
    document.getElementById('aaMeta').textContent = 'No matching resources';
  }

  function setError(msg) {
    const el = document.getElementById('aaError');
    el.style.display = 'block';
    el.textContent = msg;
    document.getElementById('aaTotal').textContent = '0';
    document.getElementById('aaCrit').textContent = '0';
    document.getElementById('aaErrorCnt').textContent = '0';
    document.getElementById('aaWarn').textContent = '0';
  }

  function clearError() {
    const el = document.getElementById('aaError');
    el.style.display = 'none';
    el.textContent = '';
  }

  function resetMetrics() {
    metrics.apiCalls = 0;
    metrics.requestMs = [];
    metrics.filterMs = 0;
    metrics.aggregateMs = 0;
    metrics.totalMs = 0;
    peakConcurrency = 0;
  }

  function formatPerfMeta(base) {
    if (!isDebug()) return base;
    const reqSum = metrics.requestMs.reduce(function (a, b) { return a + b; }, 0);
    return base + ' · ' + metrics.totalMs + 'ms total · ' + metrics.apiCalls + ' calls · peak ' +
      peakConcurrency + ' · filter ' + metrics.filterMs + 'ms · agg ' + metrics.aggregateMs + 'ms · reqΣ ' + reqSum + 'ms';
  }

  async function load(force) {
    const gen = ++loadGeneration;
    if (activeAbort) {
      try { activeAbort.abort(); } catch (e) { /* ignore */ }
    }
    const controller = new AbortController();
    activeAbort = controller;

    clearError();
    document.getElementById('aaMeta').textContent = 'Refreshing…';
    resetMetrics();
    const loadStart = Date.now();

    try {
      const urlFilters = parseFiltersFromURL();
      const cacheKey = CACHE_KEY + ':' + JSON.stringify(urlFilters);
      if (!force) {
        try {
          const raw = sessionStorage.getItem(cacheKey);
          if (raw) {
            const cached = JSON.parse(raw);
            if (cached && cached.ts && (Date.now() - cached.ts) < CACHE_TTL_MS) {
              if (gen !== loadGeneration) return;
              render(cached.agg, 'Cached · last refresh ' + new Date(cached.ts).toLocaleTimeString() + (cached.truncated ? ' · truncated' : ''));
              return;
            }
          }
        } catch (e) { /* ignore cache */ }
      }

      const resolved = await resolveDeviceNames(urlFilters, controller.signal);
      if (gen !== loadGeneration) return;

      if (resolved.emptyMatch) {
        setEmptyMatch();
        return;
      }

      let nameAllowSet = null;
      if (resolved.names && resolved.names.length) {
        nameAllowSet = new Set(resolved.names);
      }
      const apiNames = (resolved.names && resolved.names.length && resolved.names.length <= 20) ? resolved.names : null;
      const filter = buildAlertFilter(urlFilters, apiNames);
      debugLog('Final alert filter expression', filter);

      const result = await fetchAllAlerts(
        filter,
        (apiNames ? null : nameAllowSet),
        controller.signal,
        function (partial) {
          if (gen !== loadGeneration) return;
          const aggPartial = aggregate(partial.alerts);
          render(aggPartial, 'Loading… ' + partial.alerts.length + ' alerts so far');
        }
      );
      if (gen !== loadGeneration) return;

      const agg = aggregate(result.alerts);
      const ts = Date.now();
      metrics.totalMs = ts - loadStart;
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({ ts: ts, agg: agg, truncated: result.truncated }));
      } catch (e) { /* quota */ }

      let meta = 'Last refresh ' + new Date(ts).toLocaleTimeString() +
        (result.truncated ? ' · truncated' : '') +
        (result.partialError ? ' · partial' : '') +
        ' · ' + result.alerts.length + ' alerts';
      meta = formatPerfMeta(meta);
      render(agg, meta);
      debugLog('Load complete', {
        totalMs: metrics.totalMs,
        apiCalls: metrics.apiCalls,
        peakConcurrency: peakConcurrency,
        filterMs: metrics.filterMs,
        aggregateMs: metrics.aggregateMs
      });
    } catch (err) {
      if (gen !== loadGeneration) return;
      if (err && err.name === 'AbortError') return;
      debugLog('Load failed', {
        message: err && err.message,
        status: err && err.status,
        endpoint: err && err.endpoint,
        detail: err && err.detail,
        filter: err && err.filter
      });
      const msg = (err && err.message) ? err.message : 'Unable to load alert analytics.';
      setError(msg);
      document.getElementById('aaMeta').textContent = 'Error';
      document.getElementById('aaDonut').innerHTML = '<div class="aa-empty">Unavailable</div>';
      document.getElementById('aaSources').innerHTML = '<div class="aa-empty">Unavailable</div>';
      document.getElementById('aaResources').innerHTML = '<div class="aa-empty">Unavailable</div>';
    }
  }

  document.getElementById('aaDonut').innerHTML = '<div class="aa-loading">Loading severity distribution…</div>';
  document.getElementById('aaSources').innerHTML = '<div class="aa-loading">Loading…</div>';
  document.getElementById('aaResources').innerHTML = '<div class="aa-loading">Loading…</div>';
  load(false);
  // Respect CACHE_TTL — do not force-bypass cache every tick
  setInterval(function () { load(false); }, REFRESH_MS);
})();
