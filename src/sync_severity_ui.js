const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const severityJs = fs.readFileSync(path.join(__dirname, 'severity_script_0.js'), 'utf8').replace(/\r\n/g, '\n').trim();
const IMPORT = path.join(ROOT, 'import', 'Alert_Dashboard___Operations_ResourceSelector_Dark_v1.json');
const HTML = path.join(__dirname, 'widgets', 'Alert_Dashboard___Operations_ResourceSelector_Dark_v1__Severity_Breakdown_Alert_Distribution.html');

const SHELL = `<style>
.aa-root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#14171b;color:#e8eaed;padding:10px 12px;box-sizing:border-box;height:100%;overflow:auto;}
.aa-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;gap:12px;}
.aa-title{font-size:13px;font-weight:700;color:#d1d5db;letter-spacing:.03em;text-transform:uppercase;}
.aa-meta{font-size:11px;color:#8b949e;}
.aa-meta.is-loading{color:#7dd3fc;}
.aa-warn{font-size:11px;color:#f5ca1d;margin:0 0 8px;}
.aa-err{font-size:12px;color:#ff8a80;background:#3b1d1d;border:1px solid #7f2a2a;padding:8px 10px;border-radius:4px;}
.aa-progress{display:none;align-items:center;gap:10px;margin:0 0 10px;padding:8px 10px;border-radius:4px;border:1px solid #1e3a5f;background:#152033;color:#b6d4f0;font-size:12px;}
.aa-progress.is-visible{display:flex;}
.aa-progress-spinner{width:14px;height:14px;border:2px solid rgba(125,211,252,.25);border-top-color:#7dd3fc;border-radius:50%;flex:0 0 auto;animation:aa-spin .7s linear infinite;}
.aa-progress-track{flex:1;height:4px;background:#243044;border-radius:2px;overflow:hidden;min-width:80px;}
.aa-progress-bar{height:100%;width:35%;background:linear-gradient(90deg,#38bdf8,#7dd3fc,#38bdf8);background-size:200% 100%;border-radius:2px;animation:aa-indeterminate 1.2s ease-in-out infinite;}
.aa-progress-bar.is-determinate{animation:none;background:#38bdf8;transition:width .25s ease;}
@keyframes aa-spin{to{transform:rotate(360deg);}}
@keyframes aa-indeterminate{0%{transform:translateX(-120%);}100%{transform:translateX(320%);}}
.aa-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;}
.aa-kpis.is-partial .aa-card{opacity:.72;position:relative;}
.aa-kpis.is-partial .aa-card::after{content:"partial";position:absolute;top:6px;right:8px;font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;opacity:.75;}
.aa-card{border-radius:4px;padding:14px 16px;border:1px solid #3a3f46;min-height:72px;display:flex;flex-direction:column;justify-content:center;}
.aa-card .lbl{font-size:12px;font-weight:600;opacity:.9;margin-bottom:6px;}
.aa-card .val{font-size:28px;font-weight:700;line-height:1;}
.aa-total{background:#f3f4f6;color:#111827;border-color:#d1d5db;}
.aa-crit{background:#e0351b;color:#fff;}
.aa-errc{background:#ff8c00;color:#111;}
.aa-warnc{background:#f5ca1d;color:#111;}
.aa-charts{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}
.aa-charts.is-partial .aa-panel{opacity:.8;}
.aa-panel{background:#1b1f24;border:1px solid #3a3f46;border-radius:4px;padding:10px 12px;min-height:220px;}
.aa-panel h3{margin:0 0 8px;font-size:12px;font-weight:700;color:#c8cdd3;text-transform:uppercase;letter-spacing:.03em;}
.aa-panel-body{display:flex;gap:10px;align-items:center;justify-content:center;min-height:180px;}
.aa-legend{list-style:none;margin:0;padding:0;font-size:11px;color:#c8cdd3;}
.aa-legend li{display:flex;align-items:center;gap:6px;margin:4px 0;}
.aa-swatch{width:10px;height:10px;border-radius:2px;flex:0 0 auto;}
.aa-bars{width:100%;}
.aa-bar-row{display:grid;grid-template-columns:110px 1fr 36px;gap:6px;align-items:center;margin:5px 0;font-size:11px;}
.aa-bar-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c8cdd3;}
.aa-bar-track{background:#2a2f36;height:12px;border-radius:2px;overflow:hidden;}
.aa-bar-fill{height:100%;background:#ff8c00;border-radius:2px;}
.aa-bar-n{text-align:right;color:#9aa3ad;}
.aa-empty{color:#8b949e;font-size:12px;text-align:center;padding:24px 8px;}
.aa-loading{color:#8b949e;font-size:12px;padding:20px;text-align:center;}
@media(max-width:1100px){.aa-charts{grid-template-columns:1fr;}.aa-kpis{grid-template-columns:repeat(2,1fr);}}
</style><div class="aa-root" id="aaRoot"><div class="aa-head"><div class="aa-title">Severity Breakdown</div><div class="aa-meta" id="aaMeta">Loading&hellip;</div></div><div id="aaProgress" class="aa-progress" aria-live="polite"><span class="aa-progress-spinner" aria-hidden="true"></span><div class="aa-progress-msg" id="aaProgressMsg">Loading alerts…</div><div class="aa-progress-track" aria-hidden="true"><div class="aa-progress-bar" id="aaProgressBar"></div></div></div><div id="aaTruncWarn" class="aa-warn" style="display:none;"><br></div><div id="aaError" class="aa-err" style="display:none;"><br></div><div class="aa-kpis" id="aaKpis"><div class="aa-card aa-total"><div class="lbl">Total Active Alerts</div><div class="val" id="aaTotal">&mdash;</div></div><div class="aa-card aa-crit"><div class="lbl">Critical</div><div class="val" id="aaCrit">&mdash;</div></div><div class="aa-card aa-errc"><div class="lbl">Error</div><div class="val" id="aaErrorCnt">&mdash;</div></div><div class="aa-card aa-warnc"><div class="lbl">Warning</div><div class="val" id="aaWarn">&mdash;</div></div></div><div class="aa-title" style="margin:4px 0 8px;">Alert Distribution</div><div class="aa-charts" id="aaCharts"><div class="aa-panel"><h3>Severity Distribution</h3><div class="aa-panel-body" id="aaDonut"><br></div></div><div class="aa-panel"><h3>Top Alert Sources</h3><div class="aa-panel-body" id="aaSources"><br></div></div><div class="aa-panel"><h3>Top Resources by Alert Count</h3><div class="aa-panel-body" id="aaResources"><br></div></div></div></div><script>
${severityJs}
</script>
`;

const content = SHELL.replace('${severityJs}', severityJs);
fs.writeFileSync(HTML, content);

const j = JSON.parse(fs.readFileSync(IMPORT, 'utf8'));
let updated = false;
for (const w of j.widgets || []) {
  const c = w.config;
  if (!c || typeof c.content !== 'string') continue;
  if (String(c.name).indexOf('Severity') >= 0 || c.content.includes("CACHE_KEY = 'lmAlertDashAnalytics_v1'")) {
    c.content = content;
    updated = true;
    console.log('Updated severity widget:', c.name);
  }
}
if (!updated) throw new Error('Severity widget not found');
fs.writeFileSync(IMPORT, JSON.stringify(j, null, 2) + '\n');
console.log('OK — has aaProgress:', content.includes('aaProgress'));
console.log('OK — has setLoadingState:', content.includes('setLoadingState') || severityJs.includes('setLoadingState'));
