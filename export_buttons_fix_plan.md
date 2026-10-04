# Implementation Plan — Fix 5 Non-Functional Export Buttons

---

## Root Cause Analysis

| # | Button | Page | Root Cause |
|---|---|---|---|
| 1 | CSV LOG | Performance Reports | `<a href="#">` with CSS `pointer-events-none` when no report — correct behavior but uses fragile CSS hack instead of semantic `disabled` |
| 2 | JSON | Performance Reports | Same as #1 |
| 3 | Export CSV | Video Benchmark | **Hardcoded** `http://127.0.0.1:8000/api/...` — bypasses Vite proxy, fails on any host besides literal `127.0.0.1`. No disabled state when no results exist |
| 4 | Export JSON | Video Benchmark | Same as #3 |
| 5 | Report (MD) | Video Benchmark | Same as #3 |

---

## Changes Required

### Change 1 — Add benchmark export URL helpers to `api.ts`

**File:** [`frontend/src/services/api.ts`](file:///c:/Users/yash7/Desktop/Vision-main/frontend/src/services/api.ts)

The Performance Reports page already has proper URL helpers (`getExportCsvUrl`, `getExportJsonUrl`) that use the `API_BASE = '/api'` constant. The Video Benchmark page has **no equivalent** — it hardcodes absolute URLs. Fix: add 3 matching helpers.

```diff
  async getBenchmarkResults(): Promise<any> {
    const res = await fetch(`${API_BASE}/benchmark/results`);
    if (!res.ok) throw new Error(`Failed to get benchmark results: ${res.statusText}`);
    return res.json();
  },

+ // Benchmark export URL helpers (match the pattern of getExportCsvUrl)
+ getBenchmarkExportCsvUrl(): string {
+   return `${API_BASE}/benchmark/export/csv`;
+ },
+
+ getBenchmarkExportJsonUrl(): string {
+   return `${API_BASE}/benchmark/export/json`;
+ },
+
+ getBenchmarkExportReportUrl(): string {
+   return `${API_BASE}/benchmark/export/report`;
+ },
```

> [!NOTE]
> These URL helpers return `/api/benchmark/export/csv` etc., which Vite's dev proxy routes to `http://localhost:8000/api/benchmark/export/csv`. This works from **any** hostname — `localhost`, `127.0.0.1`, or a LAN IP.

---

### Change 2 — Fix Video Benchmark export buttons

**File:** [`frontend/src/pages/VideoBenchmarkPage.tsx`](file:///c:/Users/yash7/Desktop/Vision-main/frontend/src/pages/VideoBenchmarkPage.tsx#L755-L783)

Two sub-fixes:
1. Replace hardcoded absolute URLs with `api.*` helpers
2. Add disabled state when `results === null` (no benchmark has been run yet)

```diff
  {/* Export Toolbar */}
  <div className="flex items-center gap-2">
    <a
-     href="http://127.0.0.1:8000/api/benchmark/export/csv"
+     href={results ? api.getBenchmarkExportCsvUrl() : '#'}
      download
-     className="px-3 py-1.5 rounded-lg bg-[#262824] hover:bg-[#33362F] text-[#F0FFEA] border border-[#33362F] hover:border-[#FF5F40]/50 text-xs font-medium flex items-center gap-1.5 transition"
+     className={`px-3 py-1.5 rounded-lg bg-[#262824] hover:bg-[#33362F] text-[#F0FFEA] border border-[#33362F] hover:border-[#FF5F40]/50 text-xs font-medium flex items-center gap-1.5 transition ${
+       !results ? 'pointer-events-none opacity-50' : ''
+     }`}
+     title="Export frame-by-frame centroid telemetry CSV"
    >
      <FileSpreadsheet className="w-3.5 h-3.5 text-[#FF5F40]" />
      <span>Export CSV</span>
    </a>

    <a
-     href="http://127.0.0.1:8000/api/benchmark/export/json"
+     href={results ? api.getBenchmarkExportJsonUrl() : '#'}
      download
-     className="px-3 py-1.5 rounded-lg bg-[#262824] hover:bg-[#33362F] text-[#F0FFEA] border border-[#33362F] hover:border-[#FF5F40]/50 text-xs font-medium flex items-center gap-1.5 transition"
+     className={`px-3 py-1.5 rounded-lg bg-[#262824] hover:bg-[#33362F] text-[#F0FFEA] border border-[#33362F] hover:border-[#FF5F40]/50 text-xs font-medium flex items-center gap-1.5 transition ${
+       !results ? 'pointer-events-none opacity-50' : ''
+     }`}
+     title="Export full structured benchmark JSON"
    >
      <FileCode className="w-3.5 h-3.5 text-[#FF5F40]" />
      <span>Export JSON</span>
    </a>

    <a
-     href="http://127.0.0.1:8000/api/benchmark/export/report"
+     href={results ? api.getBenchmarkExportReportUrl() : '#'}
      download
-     className="px-3 py-1.5 rounded-lg bg-[#262824] hover:bg-[#33362F] text-[#F0FFEA] border border-[#33362F] hover:border-[#FF5F40]/50 text-xs font-medium flex items-center gap-1.5 transition"
+     className={`px-3 py-1.5 rounded-lg bg-[#262824] hover:bg-[#33362F] text-[#F0FFEA] border border-[#33362F] hover:border-[#FF5F40]/50 text-xs font-medium flex items-center gap-1.5 transition ${
+       !results ? 'pointer-events-none opacity-50' : ''
+     }`}
+     title="Export official benchmark evaluation report (Markdown)"
    >
      <FileText className="w-3.5 h-3.5 text-[#FF5F40]" />
      <span>Report (MD)</span>
    </a>
  </div>
```

---

### Change 3 — Harden Performance Reports export buttons

**File:** [`frontend/src/pages/PerformanceReportsPage.tsx`](file:///c:/Users/yash7/Desktop/Vision-main/frontend/src/pages/PerformanceReportsPage.tsx#L195-L217)

The current approach uses `<a href="#">` + CSS `pointer-events-none` as a "disabled" hack. This has issues:
- `href="#"` scrolls to page top if CSS fails to block the click
- Screen readers still announce it as a link
- No semantic `disabled` signal

**Fix:** Add `aria-disabled` and `tabIndex={-1}` to prevent keyboard activation while keeping the same visual pattern used by the adjacent PRINT/PDF button:

```diff
  <a
    href={report ? api.getExportCsvUrl(report.report_id) : '#'}
    download
+   aria-disabled={!report}
+   tabIndex={!report ? -1 : undefined}
    className={`px-3 py-2 bg-[#262824] hover:bg-[#33362F] border border-[#33362F] hover:border-[#FF5F40] text-[#F0FFEA] rounded text-xs font-mono flex items-center gap-1.5 transition ${
      !report ? 'pointer-events-none opacity-50' : ''
    }`}
    title="Export raw frame performance log CSV"
  >

  <a
    href={report ? api.getExportJsonUrl(report.report_id) : '#'}
    download
+   aria-disabled={!report}
+   tabIndex={!report ? -1 : undefined}
    className={`px-3 py-2 bg-[#262824] hover:bg-[#33362F] border border-[#33362F] hover:border-[#FF5F40] text-[#F0FFEA] rounded text-xs font-mono flex items-center gap-1.5 transition ${
      !report ? 'pointer-events-none opacity-50' : ''
    }`}
    title="Export full structured report JSON"
  >
```

---

## State Persistence Across Page Navigation

> **User Requirement:** *"The buttons should only reset to their default value when the whole software restarts, not when pages are changed."*

This is **already satisfied** by the current architecture for all 5 buttons:

| Button Group | Where State Lives | Survives Page Change? |
|---|---|---|
| Performance Reports CSV/JSON | `report` object is fetched from the **backend** on mount via `loadReports()` → `api.getPerformanceReportById()`. The backend stores reports in memory. | ✅ Yes — reports persist on the backend until server restart. Re-visiting the page re-fetches the same report. |
| Video Benchmark CSV/JSON/MD | `results` object is fetched from the **backend** on mount via `refreshBenchmarkState()` → `api.getBenchmarkResults()`. The benchmark engine stores results in memory. | ✅ Yes — benchmark results persist on the backend until server restart. Re-visiting the page re-fetches the same results. |

Both pages call their respective backend APIs in `useEffect([], ...)` on mount. If a report/benchmark was previously generated, it is automatically restored from the backend when the user navigates back. The buttons immediately become active — no re-generation needed.

**No additional state management changes (Context, Redux, etc.) are needed** — the backend is already the single source of truth, and both pages already re-hydrate from it.

---

## Global Sync Across Pages

> **User Requirement:** *"If mission control page have a button A and the disturbances page also contains that same button A then turning-off or On button A on any of these pages should turn it off throughout all the pages."*

These 5 export buttons are **page-specific** — they only appear on their respective pages. There is no duplicate of "CSV LOG" on Mission Control, and no duplicate of "Export CSV" benchmark on any other page. So cross-page sync does not apply to these specific buttons.

However, the fix ensures consistency: both the Performance Reports page and the Video Benchmark page now follow the **exact same pattern** for their export buttons:
- `href` → resolved via `api.*` helper using `API_BASE = '/api'`
- Disabled state → `!data ? 'pointer-events-none opacity-50' : ''`
- Download state → sourced from backend (survives page changes)

---

## Files Changed Summary

| File | Lines Changed | What |
|---|---|---|
| [`api.ts`](file:///c:/Users/yash7/Desktop/Vision-main/frontend/src/services/api.ts#L296-L300) | +12 lines | Add 3 benchmark export URL helpers |
| [`VideoBenchmarkPage.tsx`](file:///c:/Users/yash7/Desktop/Vision-main/frontend/src/pages/VideoBenchmarkPage.tsx#L757-L782) | ~18 lines modified | Replace 3 hardcoded URLs + add disabled state |
| [`PerformanceReportsPage.tsx`](file:///c:/Users/yash7/Desktop/Vision-main/frontend/src/pages/PerformanceReportsPage.tsx#L195-L217) | +4 lines | Add `aria-disabled` + `tabIndex` to 2 export anchors |

**Zero backend changes needed.** The backend routes at `/api/benchmark/export/csv`, `/json`, `/report` are already correctly implemented in [`routes.py`](file:///c:/Users/yash7/Desktop/Vision-main/backend/app/api/routes.py#L1071-L1098).
