const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const severityJs = fs.readFileSync(path.join(__dirname, 'severity_script_0.js'), 'utf8').replace(/\r\n/g, '\n').trim();
const IMPORT_DASHBOARD = path.join(ROOT, 'import', 'Alert_Dashboard___Operations_ResourceSelector_Dark_v1.json');

function replaceSeverityContent(content) {
  const keyIdx = content.indexOf("CACHE_KEY = 'lmAlertDashAnalytics_v1'");
  if (keyIdx < 0) throw new Error('Severity CACHE_KEY not found');
  const scriptOpen = content.lastIndexOf('<script>', keyIdx);
  const scriptClose = content.indexOf('</script>', keyIdx);
  if (scriptOpen < 0 || scriptClose < 0) throw new Error('script tags not found');
  const before = content.slice(0, scriptOpen + '<script>'.length);
  const after = content.slice(scriptClose);
  return before + '\n' + severityJs + '\n' + after;
}

const j = JSON.parse(fs.readFileSync(IMPORT_DASHBOARD, 'utf8'));
let changed = 0;
for (const w of (j.widgets || [])) {
  const c = w.config;
  if (!c || typeof c.content !== 'string') continue;
  // Severity only — do not touch Resource Selector / FilterWidget
  if (c.content.includes("CACHE_KEY = 'lmAlertDashAnalytics_v1'")) {
    c.content = replaceSeverityContent(c.content);
    changed++;
    console.log('severity updated:', c.name);
  }
}

if (!changed) throw new Error('No Severity widget updated');
fs.writeFileSync(IMPORT_DASHBOARD, JSON.stringify(j, null, 2) + '\n');
JSON.parse(fs.readFileSync(IMPORT_DASHBOARD, 'utf8'));
console.log('OK wrote', IMPORT_DASHBOARD);

const htmlSev = path.join(
  __dirname,
  'widgets',
  'Alert_Dashboard___Operations_ResourceSelector_Dark_v1__Severity_Breakdown_Alert_Distribution.html'
);
if (fs.existsSync(htmlSev)) {
  fs.writeFileSync(htmlSev, replaceSeverityContent(fs.readFileSync(htmlSev, 'utf8')));
  console.log('OK html severity');
}

// Verify FilterWidget untouched vs previous (optional)
const prevPath = path.join(__dirname, 'previous_dashboards', 'Alert_Dashboard___Operations.json');
if (fs.existsSync(prevPath)) {
  const prev = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
  const dark = JSON.parse(fs.readFileSync(IMPORT_DASHBOARD, 'utf8'));
  const prevRS = prev.widgets.find(function (w) { return w.config && w.config.name === 'Resource Selector'; });
  const darkRS = dark.widgets.find(function (w) { return w.config && w.config.name === 'Resource Selector'; });
  if (prevRS && darkRS) {
    console.log('FilterWidget unchanged vs previous:', prevRS.config.content === darkRS.config.content);
  }
}

const dark = JSON.parse(fs.readFileSync(IMPORT_DASHBOARD, 'utf8'));
const sev = dark.widgets.find(function (w) {
  return w.config && String(w.config.name).indexOf('Severity') >= 0;
}).config.content;
console.log('has mapPool:', sev.includes('mapPool'));
console.log('has NAME_CHUNK:', sev.includes('NAME_CHUNK'));
console.log('has CONCURRENCY:', sev.includes('CONCURRENCY = 3'));
console.log('categories contains fix:', sev.includes("propName === 'system.categories'"));
console.log('cache-friendly interval:', sev.includes('setInterval(function () { load(false); }'));
console.log('Done');
