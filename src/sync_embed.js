const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const severityJs = fs.readFileSync(path.join(__dirname, 'severity_script_0.js'), 'utf8').replace(/\r\n/g, '\n').trim();
const fwJs = fs.readFileSync(path.join(__dirname, 'fw_script_0.js'), 'utf8').replace(/\r\n/g, '\n');

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

function findFunctionEnd(src, fnStart) {
  let i = src.indexOf('{', fnStart);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function replaceWarmDeviceCache(content) {
  const warmStart = content.indexOf('async function warmDeviceCache()');
  if (warmStart < 0) throw new Error('warmDeviceCache not found');

  let blockStart = content.lastIndexOf('// Warm the shared device cache', warmStart);
  if (blockStart < 0) blockStart = warmStart;

  const bounded = content.lastIndexOf('DEVICE_FETCH_CONCURRENCY', warmStart);
  if (bounded > 0 && warmStart - bounded < 900) {
    const bComment = content.lastIndexOf('// Bounded concurrency for parallel page fetches', warmStart);
    if (bComment >= 0) blockStart = bComment;
  }

  const end = findFunctionEnd(content, warmStart);
  if (end < 0) throw new Error('Could not find end of warmDeviceCache');

  const fwWarm = fwJs.indexOf('// Bounded concurrency for parallel page fetches');
  const fwFn = fwJs.indexOf('async function warmDeviceCache()', fwWarm);
  const fend = findFunctionEnd(fwJs, fwFn);
  const replacement = fwJs.slice(fwWarm, fend);
  return content.slice(0, blockStart) + replacement + content.slice(end);
}

const j = JSON.parse(fs.readFileSync(IMPORT_DASHBOARD, 'utf8'));
let changed = 0;
for (const w of (j.widgets || [])) {
  const c = w.config;
  if (!c || typeof c.content !== 'string') continue;
  let content = c.content;
  if (content.includes("CACHE_KEY = 'lmAlertDashAnalytics_v1'")) {
    content = replaceSeverityContent(content);
    changed++;
    console.log('severity updated:', c.name);
  }
  if (content.includes('async function warmDeviceCache()')) {
    content = replaceWarmDeviceCache(content);
    changed++;
    console.log('warmDeviceCache updated:', c.name);
  }
  c.content = content;
}

if (!changed) throw new Error('No widgets updated — check import dashboard content');
fs.writeFileSync(IMPORT_DASHBOARD, JSON.stringify(j, null, 2) + '\n');
JSON.parse(fs.readFileSync(IMPORT_DASHBOARD, 'utf8'));
console.log('OK wrote', IMPORT_DASHBOARD);

// Sync Dark v1 widget HTML mirrors
const widgetDir = path.join(__dirname, 'widgets');
const htmlSev = path.join(widgetDir, 'Alert_Dashboard___Operations_ResourceSelector_Dark_v1__Severity_Breakdown_Alert_Distribution.html');
const htmlFw = path.join(widgetDir, 'Alert_Dashboard___Operations_ResourceSelector_Dark_v1__Resource_Selector.html');
if (fs.existsSync(htmlSev)) {
  fs.writeFileSync(htmlSev, replaceSeverityContent(fs.readFileSync(htmlSev, 'utf8')));
  console.log('OK html severity');
}
if (fs.existsSync(htmlFw)) {
  fs.writeFileSync(htmlFw, replaceWarmDeviceCache(fs.readFileSync(htmlFw, 'utf8')));
  console.log('OK html resource selector');
}

console.log('Done');
