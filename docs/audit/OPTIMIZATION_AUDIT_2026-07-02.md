# VaultSpace Optimization Audit

Date: 2026-07-02
Method: three independent read-only reviews (two Claude audit agents: backend/API and frontend/UI; one Codex architecture-level second opinion), findings deduplicated and ranked. File references verified at audit time. No changes were made; this is the backlog source.

## Master ranking (deduplicated)

| #   | Finding                                                                                                                                                                      | Area                       | Impact   | Effort | Confirmed by     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | -------- | ------ | ---------------- |
| 1   | Session cache written but never read; 3 DB queries + 1 write per authenticated request; per-request sliding-window UPDATE                                                    | Auth hot path              | HIGH     | M      | Backend + Codex  |
| 2   | Dashboard v2 computes ~8 retired widget datasets (~24 queries in one serialized interactive transaction) for a landing that renders 7 fields                                 | API shape                  | HIGH     | M      | Backend + Codex  |
| 3   | `lastLoginAt` mutated on every dashboard GET; freshness counts ("new since last visit") wiped by a refresh; "Last sign-in" is really "last dashboard load"                   | Correctness (user-visible) | HIGH     | S      | Backend + Codex  |
| 4   | Room page is a 3,924-line client component: 73 useState, 39 inline fetches, zero React.memo repo-wide; any keystroke re-renders the full tree                                | Frontend structure         | HIGH     | L      | Frontend         |
| 5   | Dashboard barrel import ships the mothballed widget system (react-grid-layout, react-virtuoso) in the live route chunk; no `sideEffects` field                               | Bundle                     | HIGH     | S      | Frontend         |
| 6   | Search has no tsvector column or GIN index; per-row to_tsvector over all org text, executed twice (results + count); ILIKE fallback defeats indexing                         | Search                     | HIGH     | M      | Backend          |
| 7   | Preview/thumbnail endpoints buffer whole files through the app tier; violates the repo's own 5-minute signed-URL contract                                                    | File serving               | HIGH     | M-L    | Backend          |
| 8   | ~8 missing composite indexes for actual query shapes; PageView.userId and Question.askedByUserId have no index at all                                                        | Schema                     | HIGH     | S      | Backend          |
| 9   | Room open: duplicate documents+folders fetches (two effects fire the same pair), room→contents waterfall, ~7 API calls with per-call auth cost                               | Data fetching              | MED-HIGH | S      | Frontend + Codex |
| 10  | event.groupBy by raw millisecond timestamp streams entire event windows to build 7-point charts (dashboard + room analytics)                                                 | Query shape                | HIGH     | S      | Backend          |
| 11  | Dead dependencies: recharts (0 imports), react-pdf (only importer itself unimported); react-grid-layout/react-virtuoso removable after mothball window                       | Bundle                     | MED-HIGH | S      | Frontend         |
| 12  | Dashboard fetches client-side (skeleton flash, hydrate-then-fetch waterfall) though the layout already resolves the session server-side                                      | Data fetching              | MED      | M      | Frontend         |
| 13  | Export worker buffers entire ZIP in memory, fetches files sequentially; memory blowout risk on large rooms                                                                   | Workers                    | MED      | M      | Codex            |
| 14  | Whole-room folder tree fetched unbounded on every room open, even in grid mode                                                                                               | Data fetching              | MED      | S      | Codex            |
| 15  | No loading.tsx / error.tsx anywhere; render error white-screens the shell                                                                                                    | Resilience                 | MED      | S      | Frontend         |
| 16  | viewCount UPDATE inside hot preview GET transaction; double-counts refreshes; contention on popular docs                                                                     | API                        | MED      | S      | Backend          |
| 17  | Thumbnail miss enqueues duplicate full conversions per page load (no BullMQ jobId dedup); placeholder PNG re-rendered via sharp per miss                                     | Workers                    | MED      | S      | Backend          |
| 18  | Dead code shipped live: /demo routes + ui-proposals (unauthenticated), sidebar/app-shell superseded by DockShell, ~2,700 lines of mothballed widgets with ~5 live components | Dead code                  | MED      | S      | Frontend         |
| 19  | Grayscale chaos: neutral 906 / slate 513 / gray 340 class hits; gray-\* is not even in the config palette; visible hue mismatch at surface borders                           | UI consistency             | MED      | M      | Frontend         |
| 20  | No next/dynamic anywhere: QA/Checklist/Calendar tabs (~1,550 lines), preview dialog stack, UploadZone, dock search palette all in initial chunks                             | Bundle                     | MED      | S-M    | Frontend         |
| 21  | dock-shell.tsx is a second 1,009-line god component (touch, drag, autohide, search palette with own fetch)                                                                   | Frontend structure         | MED      | M      | Frontend         |
| 22  | ~30 unbounded findMany routes (audit, links, viewers, permissions, heatmap, digest); documents count() runs even though UI ignores pagination                                | API                        | MED      | M      | Backend + Codex  |
| 23  | Over-fetching full models (rooms list leaks config fields incl. NDA/watermark to response; full DocumentVersion where 2 fields used)                                         | API                        | MED      | S      | Backend          |
| 24  | Preview worker: one transaction per page asset (100-page PDF = 100 transactions); no-op increment-0 touch write dirties updatedAt (pollutes freshness)                       | Workers                    | LOW-MED  | S      | Backend          |
| 25  | Version-keyed thumbnails cached only 5 minutes despite immutable keys; no ETag/304                                                                                           | Caching                    | LOW      | S      | Backend          |
| 26  | Radius tokens cover the minority of usage (rounded-xl 121 uses vs tokenized lg 79); duplicated formatFileSize x3, hand-rolled empty states; missing favicon/metadata         | Polish                     | LOW      | S      | Frontend         |
| 27  | Sequential folder creates on room create/duplicate (one round trip per folder in RLS transaction)                                                                            | API                        | LOW      | S      | Backend          |

## Recommended sequencing

**Wave 1 — quick wins, no design risk (all S effort):**
findings 3 (freshness cursor; user-visible bug), 8 (composite index migration), 5 (barrel split + sideEffects), 11 (delete dead deps; approval needed for file deletions), 9 (merge duplicate effects), 10 (date_trunc raw queries), 16, 17, 25, 15 (error/loading boundaries).

**Wave 2 — request-path structural (M):**
1 (read-through session cache + throttled activity refresh; invalidation on logout/role change), 2 (landing-shaped dashboard endpoint), 6 (tsvector migration + GIN), 14 (defer tree fetch), 22/23 (pagination + select discipline), 20 (dynamic imports).

**Wave 3 — architectural (L, schedule deliberately):**
4 (room page decomposition — the frontend report contains a 9-unit extraction plan with line ranges; extract dialogs first for the re-render win, then ManageDrawer, table+toolbar, data hook), 7 (signed-URL redirect for previews/thumbnails per contract), 13 (streaming exports), 12 (RSC dashboard), 21 (dock-shell split), 19 (grayscale codemod).

## Notes

- Tenant isolation is not to be touched by any of these fixes: every recommendation preserves organizationId scoping and withOrgContext/RLS.
- Findings 3 and 24 interact: the preview worker's touch write makes documents look updated, further polluting the freshness signal the landing now headlines.
- The mothballed dashboard system's deletion window (one release cycle, per earlier Advisor guidance) can close together with finding 5/11/18 as a single cleanup PR once stakeholders approve deletions.
- Full agent reports (with per-finding fix details) are preserved in the session record; this document is the ranked index.
