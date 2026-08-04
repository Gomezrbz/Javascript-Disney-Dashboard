// Offline validation of filter helper logic (mirrors severity_script_0.js)
function isActiveFilterValue(v) {
  if (v == null) return false;
  const s = String(v).trim();
  if (!s) return false;
  if (s === '*' || s.toLowerCase() === 'all') return false;
  return true;
}
function stripGlob(v) { return String(v).replace(/\*+$/, ''); }
function selectedValues(filterEntry) {
  if (!filterEntry || !Array.isArray(filterEntry.v)) return [];
  return filterEntry.v
    .filter(function (x) { return x && x.isSelected !== false; })
    .map(function (x) { return String(x.value == null ? '' : x.value); })
    .filter(isActiveFilterValue);
}
function buildActiveUrlFilters(urlFilters) {
  const byProp = {};
  (urlFilters || []).forEach(function (f) {
    if (!f || !f.n) return;
    const vals = selectedValues(f).map(stripGlob).filter(isActiveFilterValue);
    if (vals.length) byProp[f.n] = vals;
  });
  return byProp;
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
      parts.push('monitorObjectName:"' + deviceNames.map(function (n) {
        return n.replace(/"/g, '');
      }).join('|') + '"');
    }
  }
  return parts.join(',');
}
function propertyMatches(rawValue, wantedValues, multiToken) {
  if (rawValue == null) return false;
  const raw = String(rawValue);
  const wanted = wantedValues.map(function (w) { return String(w).toLowerCase(); });
  if (multiToken) {
    const tokens = raw.split(/[,;\s]+/).map(function (t) {
      return t.trim().toLowerCase();
    }).filter(Boolean);
    return wanted.some(function (w) {
      return tokens.indexOf(w) >= 0 || raw.toLowerCase().indexOf(w) >= 0;
    });
  }
  const lower = raw.toLowerCase();
  return wanted.some(function (w) { return lower === w || lower.indexOf(w) >= 0; });
}

const tests = [];
function assert(name, cond) { tests.push({ name: name, ok: !!cond }); }

assert('empty filters', Object.keys(buildActiveUrlFilters([])).length === 0);
assert('All skipped', Object.keys(buildActiveUrlFilters([
  { n: 'system.categories', v: [{ value: '*', isSelected: true }] }
])).length === 0);
assert('null skipped', Object.keys(buildActiveUrlFilters([
  { n: 'system.categories', v: [{ value: null, isSelected: true }] }
])).length === 0);
assert('Aruba active', buildActiveUrlFilters([
  { n: 'system.categories', v: [{ value: 'Aruba', isSelected: true }] }
])['system.categories'][0] === 'Aruba');
assert('no filters alert', buildAlertFilter([], null) ===
  'cleared:false,sdted:false,severity:"4"|"3"|"2"');
assert('aruba no systemProperties', !buildAlertFilter([
  { n: 'system.categories', v: [{ value: 'Aruba', isSelected: true }] }
], ['dev1']).includes('systemProperties'));
assert('aruba with name', buildAlertFilter([
  { n: 'system.categories', v: [{ value: 'Aruba', isSelected: true }] }
], ['dev1']).includes('monitorObjectName:"dev1"'));
assert('combined', (function () {
  const f = buildAlertFilter([
    { n: 'system.groups', v: [{ value: 'Production', isSelected: true }] },
    { n: 'customer', v: [{ value: 'Disney', isSelected: true }] }
  ], ['r1', 'r2']);
  return f.includes('monitorObjectGroups') && f.includes('monitorObjectName');
})());
assert('multi category match', propertyMatches('Aruba,Cisco,Linux', ['Aruba'], true));
assert('multi category miss', !propertyMatches('Cisco,Linux', ['Aruba'], true));
assert('special chars value active', isActiveFilterValue('Site A (HQ)'));
assert('space category', propertyMatches('My Category', ['My Category'], true));

const failed = tests.filter(function (t) { return !t.ok; });
tests.forEach(function (t) { console.log(t.ok ? 'PASS' : 'FAIL', t.name); });
console.log(failed.length ? 'FAILED ' + failed.length : 'ALL ' + tests.length + ' PASSED');
process.exit(failed.length ? 1 : 0);
