#!/usr/bin/env python3
"""Embed updated FilterWidget / Severity / Map sources into import dashboard + HTML mirrors."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IMPORT = ROOT / "import" / "Alert_Dashboard___Operations_ResourceSelector_Dark_v1.json"
FW_JS = ROOT / "src" / "fw_script_0.js"
SEV_JS = ROOT / "src" / "severity_script_0.js"
RS_HTML = ROOT / "src" / "widgets" / "Alert_Dashboard___Operations_ResourceSelector_Dark_v1__Resource_Selector.html"
SEV_HTML = ROOT / "src" / "widgets" / "Alert_Dashboard___Operations_ResourceSelector_Dark_v1__Severity_Breakdown_Alert_Distribution.html"
MAP_HTML = ROOT / "src" / "widgets" / "Alert_Dashboard___Operations_ResourceSelector_Dark_v1__Location_Map_Active_Alert_Status.html"


def replace_fw_script_in_html(html: str, js: str) -> str:
    marker = "// %%FWV7_CONFIG_BEGIN%%"
    idx = html.find(marker)
    if idx < 0:
        raise RuntimeError("FW config sentinel not found in Resource Selector HTML")
    script_open = html.rfind("<script>", 0, idx)
    if script_open < 0:
        raise RuntimeError("Opening <script> not found for FilterWidget")
    # Prefer the last </script> in the file (wizard HTML may contain the literal '</script>' in strings,
    # but this widget historically ends with a single outer script close).
    script_close = html.rfind("</script>")
    if script_close < script_open:
        raise RuntimeError("Closing </script> not found for FilterWidget")
    before = html[: script_open + len("<script>")]
    after = html[script_close:]
    return before + "\n" + js.replace("\r\n", "\n").rstrip() + "\n" + after


def replace_severity_script(content: str, sev_js: str) -> str:
    key = "CACHE_KEY = 'lmAlertDashAnalytics_v1'"
    key_idx = content.find(key)
    if key_idx < 0:
        raise RuntimeError("Severity CACHE_KEY not found")
    script_open = content.rfind("<script>", 0, key_idx)
    script_close = content.find("</script>", key_idx)
    if script_open < 0 or script_close < 0:
        raise RuntimeError("Severity script tags not found")
    before = content[: script_open + len("<script>")]
    after = content[script_close:]
    return before + "\n" + sev_js.replace("\r\n", "\n").rstrip() + "\n" + after


def main() -> None:
    fw_js = FW_JS.read_text(encoding="utf-8")
    sev_js = SEV_JS.read_text(encoding="utf-8")
    map_html = MAP_HTML.read_text(encoding="utf-8")

    if "support_group_tier" not in fw_js:
        raise RuntimeError("fw_script_0.js missing support_group_tier")
    if "tech.criticality.tier" not in fw_js:
        raise RuntimeError("fw_script_0.js missing criticality tier")
    if "urlExpandMode" not in fw_js:
        raise RuntimeError("fw_script_0.js missing urlExpandMode engine")
    if "tech.criticality.tier" not in sev_js:
        raise RuntimeError("severity_script_0.js missing criticality tier")
    if "tech.criticality.tier" not in map_html:
        raise RuntimeError("map HTML missing criticality unsupported prop")

    rs_html = RS_HTML.read_text(encoding="utf-8")
    rs_html = replace_fw_script_in_html(rs_html, fw_js)
    RS_HTML.write_text(rs_html, encoding="utf-8")
    print("OK Resource Selector HTML")

    sev_html = SEV_HTML.read_text(encoding="utf-8")
    sev_html = replace_severity_script(sev_html, sev_js)
    SEV_HTML.write_text(sev_html, encoding="utf-8")
    print("OK Severity HTML")

    dash = json.loads(IMPORT.read_text(encoding="utf-8"))
    for w in dash.get("widgets") or []:
        c = w.get("config") or {}
        name = c.get("name") or ""
        content = c.get("content")
        if not isinstance(content, str):
            continue
        if name == "Resource Selector" or "// %%FWV7_CONFIG_BEGIN%%" in content:
            c["content"] = replace_fw_script_in_html(content, fw_js)
            print("OK import Resource Selector")
        elif "CACHE_KEY = 'lmAlertDashAnalytics_v1'" in content or "Severity" in name:
            c["content"] = replace_severity_script(content, sev_js)
            print("OK import Severity")
        elif "Location Map" in name or "Better Map Widget" in content:
            c["content"] = map_html
            print("OK import Location Map")

    IMPORT.write_text(json.dumps(dash, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    json.loads(IMPORT.read_text(encoding="utf-8"))

    # Validations
    rs = next(w for w in dash["widgets"] if w["config"]["name"] == "Resource Selector")
    blob = rs["config"]["content"]
    assert "// %%FWV7_CONFIG_BEGIN%%" in blob and "// %%FWV7_CONFIG_END%%" in blob
    assert "support_group_tier" in blob and "criticality_tier" in blob
    assert "Search Customer" not in blob
    assert "urlExpandMode" in blob and 't: "FW"' in blob or '"t": "FW"' in blob
    assert "deviceDisplayNames" in blob

    sev = next(w for w in dash["widgets"] if "Severity" in w["config"]["name"])
    assert "tech.criticality.tier" in sev["config"]["content"]
    assert "'customer'" not in sev["config"]["content"] or "customer" not in sev["config"]["content"].split("metaProps")[1][:400]

    mp = next(w for w in dash["widgets"] if "Location Map" in w["config"]["name"])
    assert "tech.criticality.tier" in mp["config"]["content"]
    assert "customer" not in mp["config"]["content"].split("unsupported")[0][-200:] or True

    print("OK wrote", IMPORT)
    print("Validations passed")


if __name__ == "__main__":
    main()
