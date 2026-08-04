const fs = require('fs');

const prev = JSON.parse(fs.readFileSync('src/previous_dashboards/Alert_Dashboard___Operations.json', 'utf8'));
const dark = JSON.parse(fs.readFileSync('import/Alert_Dashboard___Operations_ResourceSelector_Dark_v1.json', 'utf8'));

function widget(j, pred) {
  return j.widgets.find(function (w) { return pred(w.config || {}); });
}

const prevRS = widget(prev, function (c) { return c.name === 'Resource Selector'; });
const darkRS = widget(dark, function (c) { return c.name === 'Resource Selector'; });
const prevSev = widget(prev, function (c) { return String(c.name).indexOf('Severity') >= 0; });
const darkSev = widget(dark, function (c) { return String(c.name).indexOf('Severity') >= 0; });

// 1) Restore Resource Selector exactly from the first/previous version
darkRS.config.content = prevRS.config.content;
console.log('Resource Selector restored from previous_dashboards');

// 2) Take previous Severity script; patch only the Aruba-safe propFilterClause
let sevHtml = prevSev.config.content;
const keyIdx = sevHtml.indexOf("CACHE_KEY = 'lmAlertDashAnalytics_v1'");
const scriptOpen = sevHtml.lastIndexOf('<script>', keyIdx);
const scriptClose = sevHtml.indexOf('</script>', keyIdx);
let script = sevHtml.slice(scriptOpen + '<script>'.length, scriptClose).trim();

const oldFn = script.indexOf('function propFilterClause');
const oldEnd = script.indexOf('async function resolveDeviceNames');
if (oldFn < 0 || oldEnd < 0) throw new Error('propFilterClause markers not found');

const newPropFilter = [
  'function propFilterClause(propName, values, systemProp) {',
  '    const parts = [];',
  '    values.forEach(function (v) {',
  '      const clean = stripGlob(v);',
  "      if (!clean || clean === '*' || String(clean).toLowerCase() === 'all') return;",
  "      const key = systemProp ? 'systemProperties' : 'customProperties';",
  '      // system.categories is multi-value — use contains (~) + *token*',
  '      // Exact ":" on a single category (e.g. Aruba) caused API 400 / bad results.',
  "      const useContains = (propName === 'system.categories');",
  "      const op = useContains ? '~' : ':';",
  "      const value = useContains ? ('*' + String(clean).replace(/\\*/g, '') + '*') : clean;",
  '      const obj = JSON.stringify({ name: propName, value: value }).replace(/"/g, \'\\\\"\');',
  "      parts.push(key + op + '\"' + obj + '\"');",
  '    });',
  '    return parts;',
  '  }',
  '',
  '  '
].join('\n');

script = script.slice(0, oldFn) + newPropFilter + script.slice(oldEnd);

script = script.replace(
  "if (pcs.length) clauses.push('(' + pcs.join(' || ') + ')');",
  "if (pcs.length) clauses.push(pcs.length === 1 ? pcs[0] : ('(' + pcs.join(' || ') + ')'));"
);

script = script.replace(
  "setError('Failed to load alerts: ' + (err && err.message ? err.message : String(err)));",
  [
    'var msg = (err && err.message) ? err.message : String(err);',
    "      if (/invalid filter|API 400/i.test(msg)) {",
    "        msg = 'Unable to apply the current filters. Try Reset, or pick a different category/value.';",
    '      }',
    '      setError(msg);'
  ].join('\n')
);

darkSev.config.content =
  sevHtml.slice(0, scriptOpen + '<script>'.length) +
  '\n' + script + '\n' +
  sevHtml.slice(scriptClose);

fs.writeFileSync(
  'import/Alert_Dashboard___Operations_ResourceSelector_Dark_v1.json',
  JSON.stringify(dark, null, 2) + '\n'
);

function extractScript(content, marker) {
  const i = content.indexOf(marker);
  const open = content.lastIndexOf('<script>', i);
  const close = content.indexOf('</script>', i);
  return content.slice(open + '<script>'.length, close).trim() + '\n';
}

fs.writeFileSync(
  'src/severity_script_0.js',
  extractScript(darkSev.config.content, "CACHE_KEY = 'lmAlertDashAnalytics_v1'")
);

// Extract FilterWidget main script block into fw_script_0.js (best-effort: full widget HTML also saved)
fs.writeFileSync(
  'src/widgets/Alert_Dashboard___Operations_ResourceSelector_Dark_v1__Resource_Selector.html',
  darkRS.config.content
);
fs.writeFileSync(
  'src/widgets/Alert_Dashboard___Operations_ResourceSelector_Dark_v1__Severity_Breakdown_Alert_Distribution.html',
  darkSev.config.content
);

// Pull JS from RS: between last <script> tags that contain warmDeviceCache
const rsContent = darkRS.config.content;
const warmIdx = rsContent.indexOf('async function warmDeviceCache');
const rsScriptOpen = rsContent.lastIndexOf('<script>', warmIdx);
const rsScriptClose = rsContent.indexOf('</script>', warmIdx);
if (warmIdx >= 0 && rsScriptOpen >= 0 && rsScriptClose > rsScriptOpen) {
  fs.writeFileSync(
    'src/fw_script_0.js',
    rsContent.slice(rsScriptOpen + '<script>'.length, rsScriptClose).trim() + '\n'
  );
}

const j2 = JSON.parse(fs.readFileSync('import/Alert_Dashboard___Operations_ResourceSelector_Dark_v1.json', 'utf8'));
const rs = widget(j2, function (c) { return c.name === 'Resource Selector'; }).config.content;
const sv = widget(j2, function (c) { return String(c.name).indexOf('Severity') >= 0; }).config.content;

console.log('RS DEVICE_FETCH_CONCURRENCY:', rs.includes('DEVICE_FETCH_CONCURRENCY'));
console.log('RS unbounded Promise.all pages:', /promises\.push\(LogicMonitorClient/.test(rs));
console.log('RS equals previous:', rs === prevRS.config.content);
console.log('Sev categories contains fix:', sv.includes("propName === 'system.categories'"));
console.log('Sev mapPool (should be false):', sv.includes('mapPool'));
console.log('Sev original while pagination:', sv.includes('while (offset < total'));
console.log('Done');
