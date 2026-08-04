// Offline validation of filter helper logic (mirrors severity_script_0.js hybrid filters)
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
function buildDeviceMetaFilter(activeMeta) {
  const META = [
    { n: 'system.categories', system: true, contains: true },
    { n: 'customer', system: false, contains: false }
  ];
  const andParts = [];
  META.forEach(function (p) {
    const vals = activeMeta[p.n];
    if (!vals || !vals.length) return;
    const pcs = propFilterClause(p.n, vals, p.system, p.contains);
    if (!pcs.length) return;
    andParts.push(pcs.length === 1 ? pcs[0] : '(' + pcs.join(' || ') + ')');
  });
  return andParts.join(',');
}
function propertyMatches(rawValue, wantedValues, useCommaSplit) {
  if (rawValue == null) return false;
  const raw = String(rawValue);
  const wanted = wantedValues.map(function (w) { return String(w).trim().toLowerCase(); }).filter(Boolean);
  if (useCommaSplit) {
    const tokens = raw.split(',').map(function (t) { return t.trim().toLowerCase(); }).filter(Boolean);
    return wanted.some(function (w) {
      return tokens.indexOf(w) >= 0 || tokens.some(function (t) { return t.indexOf(w) >= 0; });
    });
  }
  const lower = raw.toLowerCase().trim();
  return wanted.some(function (w) { return lower === w; });
}

const tests = [];
function assert(name, cond) { tests.push({ name: name, ok: !!cond }); }

assert('All skipped', Object.keys(buildActiveUrlFilters([
  { n: 'system.categories', v: [{ value: '*', isSelected: true }] }
])).length === 0);

const arubaFilter = buildDeviceMetaFilter({ 'system.categories': ['Aruba'] });
assert('Aruba uses contains ~', arubaFilter.indexOf('systemProperties~') === 0);
assert('Aruba uses *wildcards*', arubaFilter.indexOf('*Aruba*') >= 0);
assert('Aruba no outer parens for single', arubaFilter.charAt(0) !== '(');
assert('Old exact colon form avoided', arubaFilter.indexOf('systemProperties:"') < 0);

const customerFilter = buildDeviceMetaFilter({ customer: ['Disney'] });
assert('customer exact match', customerFilter.indexOf('customProperties:"') === 0);

assert('comma category match', propertyMatches('Aruba,snmpudp,http', ['Aruba'], true));
assert('comma category miss', !propertyMatches('Cisco,Linux', ['Aruba'], true));
assert('exact customer', propertyMatches('Disney', ['Disney'], false));
assert('exact customer miss', !propertyMatches('Disney Parks', ['Disney'], false));

const failed = tests.filter(function (t) { return !t.ok; });
tests.forEach(function (t) { console.log(t.ok ? 'PASS' : 'FAIL', t.name); });
console.log(failed.length ? 'FAILED ' + failed.length : 'ALL ' + tests.length + ' PASSED');
console.log('Example Aruba device filter:', arubaFilter);
process.exit(failed.length ? 1 : 0);
