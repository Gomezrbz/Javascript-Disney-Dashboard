const fs = require('fs');

const severityJs = fs.readFileSync('_extracted/severity_script_0.js', 'utf8').replace(/\r\n/g, '\n').trim();
const fwJs = fs.readFileSync('_extracted/fw_script_0.js', 'utf8').replace(/\r\n/g, '\n');

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

const targets = [
  { file: 'Alert_Dashboard___Operations_ResourceSelector_Dark_v1.json', sev: true, fw: true },
  { file: 'Alert_Dashboard___Operations.json', sev: true, fw: true },
  { file: 'Dashboards/_LM_Alert_Dashboard_SevOne_Style.json', sev: true, fw: true },
  { file: 'Dashboards/_FilterWidget_v7.json', sev: false, fw: true },
];

for (const t of targets) {
  const j = JSON.parse(fs.readFileSync(t.file, 'utf8'));
  let changed = 0;
  for (const w of (j.widgets || [])) {
    const c = w.config;
    if (!c || typeof c.content !== 'string') continue;
    let content = c.content;
    if (t.sev && content.includes("CACHE_KEY = 'lmAlertDashAnalytics_v1'")) {
      content = replaceSeverityContent(content);
      changed++;
      console.log(t.file, '-> severity updated:', c.name);
    }
    if (t.fw && content.includes('async function warmDeviceCache()')) {
      content = replaceWarmDeviceCache(content);
      changed++;
      console.log(t.file, '-> warmDeviceCache updated:', c.name);
    }
    c.content = content;
  }
  if (!changed) console.warn('WARNING: no changes for', t.file);
  fs.writeFileSync(t.file, JSON.stringify(j, null, 2) + '\n');
  JSON.parse(fs.readFileSync(t.file, 'utf8'));
  console.log('OK wrote', t.file);
}

const htmlSev = [
  '_extracted/Alert_Dashboard___Operations_ResourceSelector_Dark_v1__Severity_Breakdown_Alert_Distribution.html',
  '_extracted/Alert_Dashboard___Operations__Severity_Breakdown_Alert_Distribution.html',
  '_extracted/_LM_Alert_Dashboard_SevOne_Style__Severity_Breakdown_Alert_Distribution.html'
];
for (const hf of htmlSev) {
  if (!fs.existsSync(hf)) continue;
  let html = fs.readFileSync(hf, 'utf8');
  if (html.includes("CACHE_KEY = 'lmAlertDashAnalytics_v1'")) {
    fs.writeFileSync(hf, replaceSeverityContent(html));
    console.log('OK html', hf);
  }
}

const fwHtml = [
  '_extracted/Alert_Dashboard___Operations_ResourceSelector_Dark_v1__Resource_Selector.html',
  '_extracted/Alert_Dashboard___Operations__Resource_Selector.html',
  '_extracted/_LM_Alert_Dashboard_SevOne_Style__Resource_Selector.html',
  '_extracted/_FilterWidget_v7__Resource_Selector.html'
];
for (const hf of fwHtml) {
  if (!fs.existsSync(hf)) continue;
  let html = fs.readFileSync(hf, 'utf8');
  if (html.includes('async function warmDeviceCache()')) {
    fs.writeFileSync(hf, replaceWarmDeviceCache(html));
    console.log('OK fw html', hf);
  }
}

// Verify embeds
for (const t of targets) {
  const j = JSON.parse(fs.readFileSync(t.file, 'utf8'));
  for (const w of (j.widgets || [])) {
    const c = (w.config && w.config.content) || '';
    if (c.includes('lmAlertDashAnalytics')) {
      const ok = c.includes('mapPool') && c.includes('deviceMatchesMetaFilters') && !c.includes('propFilterClause');
      console.log('verify sev', t.file, ok ? 'PASS' : 'FAIL');
    }
    if (c.includes('warmDeviceCache') && c.includes('FilterWidget')) {
      const ok = c.includes('DEVICE_FETCH_CONCURRENCY') && c.includes('mapPool');
      console.log('verify fw', t.file, ok ? 'PASS' : 'FAIL');
    }
  }
}

console.log('Done');
