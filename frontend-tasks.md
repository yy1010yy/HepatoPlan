# HepatoPlan frontend task tracker

Use these checkboxes for the production frontend. Each task has a stable FT identifier, prerequisites and a check that can be performed through the app. Tick it when that check passes. The existing TypeScript controller, Three.js viewer, worker and plan session are integration points. The browser fixture demonstrates how to wire them together. [Frontend spec](frontend-specs.md) · [Product requirements](HepatoPlan%20Product%20Requirements.md) · [Fixture wiring](frontend/browser-tests/fixture.ts)

Use the supplied [HTML design reference](design-references/hepatoplan_interactive_3d_liver_resection_planning_platform.html) as the base landing page. FT-06 specifies the section order and where the Figma body fits. For the workspace, follow the HTML’s instrument styling and the Figma frame layouts for Plan, Compare and mobile. Use real geometry and worker readings in place of the illustrated anatomy and example numbers. Size the comparison actions to their labels so every action is visible. [Plan](https://www.figma.com/design/zfcRI7iwgYD8xj6ngrvUI0?node-id=3-1080) · [Compare](https://www.figma.com/design/zfcRI7iwgYD8xj6ngrvUI0?node-id=3-1434) · [Differences](https://www.figma.com/design/zfcRI7iwgYD8xj6ngrvUI0?node-id=3-1503) · [Mobile Plan](https://www.figma.com/design/zfcRI7iwgYD8xj6ngrvUI0?node-id=4-633)

## 0. Required before frontend development

**FT-01 through FT-15 are blocked until PRE-06 passes.** Use the existing browser fixture to prove the new structure works before building any landing page, workspace screen or UI component. Keep each migration step independently reviewable. Check off a test only after running it against the revision being handed over.

- [x] **PRE-01 Establish a passing baseline**
  - Before migration, run from `backend/` with Node 24.12+ and Python 3.12+. Install the locked Node dependencies with `npm.cmd ci` and the Python requirements in a local virtual environment. Use `npx.cmd playwright install chromium` if the test browser needs installing. [Current setup instructions](backend/README.md)
  - Run `.\.venv\Scripts\python.exe -m unittest discover -s tests`, `npm.cmd run typecheck`, `npm.cmd test` and `npm.cmd run test:browser`. Then enable `HEPATOPLAN_RESEARCH_TEST=1` and run `npm.cmd run test:browser -- research.spec.ts`. Use the documented Chrome channel if applicable. Confirm the real-case tests execute. Clear the opt-in environment setting after that run.
  - Record the revision, commands, pass/fail/skip counts and research release ID. Inventory tracked inputs and ignored assets, especially `backend/.local/research-public/cases`, source scans and allowlists. Fix or isolate baseline failures and rerun until green before moving files.
  - **Recorded baseline, 2026-11-27.** At `2e186b2`, the commands above passed on Node 24.22.1 with Chrome software WebGL. Python passed 18 tests, TypeScript typecheck passed, and Node passed 33 tests. The default browser suite passed 3 and skipped 2 opt-in tests. The separate `research.spec.ts` run passed both skipped tests on `research-2`. The baseline rendered input p95 was 434.7 ms.

- [x] **PRE-02 Move the browser engine and its toolchain** · depends on PRE-01
  - Move `backend/src/` into `frontend/src/planning/`. Move the Node package manifest and lockfile, TypeScript and Playwright configs, TypeScript unit tests and browser fixtures into `frontend/`. Keep one browser package with the existing locked dependencies. Update the package name in both manifest and lockfile if renamed.
  - Update test imports, TS include paths, npm scripts, Vite root, fixture entry URL and Playwright server working directory. Keep the worker next to its entry module so the bundler resolves the module-relative worker URL. Preserve controller, renderer and session APIs. Leave UI entry construction to FT-01.
  - Reinstall dependencies in the new package. Carry over ignore rules for dependencies, build output and test results. Run typecheck and browser-engine unit tests after resolving shared contract paths in PRE-03.

- [x] **PRE-03 Separate offline preparation and shared case contracts** · depends on PRE-02
  - Move the importable Python package to `tools/preprocessing/`, Python tests to `tools/tests/` and requirements to `tools/requirements.txt`. Run Python module commands from `tools/` so existing `preprocessing.*` imports still work. Create a fresh virtual environment at the new location.
  - Move schemas to root `contracts/` and shared fixture data to root `fixtures/`. Point the TS loader, Python exporter and both contract test suites to those single copies. Update paths derived from file depth or working directory, including the offline preview, public-output safeguard, schema readers and subprocess-based CLI tests.
  - Retain root `public/cases/` as the deployment asset tree. Preserve ignored research inputs and reports in place during migration. Give the research tests a documented override for the prepared case directory and use the same resolved location for Playwright reads and Vite serving. Keep scans, allowlists and virtual environments outside the public tree.
  - Update setup commands, README and active frontend handoff links to the new paths, including the links in this tracker. Mirror moved or substantially revised source explanations under `.codex-notes/` per AGENTS.md. Check Git status for accidental dataset, environment or generated-file additions. Run the Python suite and verify the exporter CLI still finds the schemas and rejects unsafe public inputs.

- [x] **PRE-04 Prove a static deployment using the existing fixture** · depends on PRE-03
  - Stage the complete prepared release and matching public index using the FT-02 asset list. If the contract tests assume the public index is empty, point the empty-index test at a dedicated development fixture and retain validation of the actual public index.
  - Build the existing fixture as a production-mode Vite test entry using the installed engine and the repo's public directory. Serve the emitted artifact over HTTP under a deployment base path. Keep this test entry separate from the later production UI entry. Include the compiled worker and prepared release with its attribution.
  - From a fresh browser context, fetch the served index, open each listed case, then use `case-002` to render both meshes, change the plane, receive a fresh worker result, save two cuts and compare them. Check the worker, metadata, labels and STL requests all resolve against the built site. Record the build and preview commands. This check must work with only the emitted files available to the static server.

- [x] **PRE-05 Define and test the future AI comparison boundary** · depends on PRE-03
  - Document the interface for an optional same-origin `POST /api/plan-comparisons/explain`. Specify an ordered A/B pair from the same prepared case and release, full-precision numeric results with explicit units, tumour intersection flags and optional four-region volumes for that pair. Define a response carrying the pair identity and a descriptive explanation. Session plan IDs alone cannot supply measurements to a server.
  - Add representative request/response fixtures and executable contract tests. Cover a valid pair with and without difference volumes, missing or non-finite measurements, duplicate or mismatched plan identities, and unexpected free-text or file fields. Only the comparison data goes in the request. Keep filenames, scan contents, names, procedure details and planning notes local.
  - Record the integration behaviour for the agent shipping AI. Add the server handler under `api/` with its first implementation, keep provider credentials server-side, validate inputs, and return an explanation grounded in the supplied values. Trigger it only on **Explain comparison**. Bind loading, error, retry and response to the selected ordered pair. Clear a superseded explanation on case change or swap. A provider failure leaves measurements, differences and saving usable.
  - **Completion boundary:** the reviewed contract and passing offline contract tests are required before UI work. The live provider, endpoint deployment and Compare action belong to the future AI feature. When enabling it, test the actual handler with a stub provider for success, invalid input, timeout and provider failure, and run a same-origin deployment smoke check before exposing the action.
  - **Evidence** The four offline contract tests passed under `npm.cmd test` in `frontend/`. [AI comparison contract](contracts/plan-comparison-explanation.md)

- [x] **PRE-06 Run and record the migration acceptance gate** · depends on PRE-04, PRE-05
  - From `tools/`, run the new virtual environment’s Python unittest discovery over `tests/`. From `frontend/`, run `npm.cmd ci`, `npm.cmd run typecheck`, `npm.cmd test`, the synthetic Playwright suite, then the opt-in research suite. Include PRE-05 contract tests in the appropriate test command. Repeat the PRE-04 production build and served-artifact smoke check on this same revision.
  - Compare coverage with PRE-01, including Python publishing, shared schemas, stale case/worker results, plan restoration and A/B differences. Verify the real-case checks ran against the intended release. Fix failures and rerun affected checks and the final gate. A skipped required suite, missing dataset or untested worker leaves the gate open.
  - **Recorded pass, 2026-11-27.** Verified the migrated working tree based on `2e186b2`. From `tools/`, `./.venv/Scripts/python.exe -m unittest discover -s tests` passed all 18 tests. From `frontend/`, `npm.cmd ci --fetch-retries=0`, `npm.cmd run typecheck` and `npm.cmd test` passed. The Node suite passed 37 tests, including all 33 baseline tests and 4 new AI contract tests.
  - **Browser evidence.** From `frontend/` with `PLAYWRIGHT_CHANNEL=chrome`, `npm.cmd run test:browser -- workflow.spec.ts` passed 3 tests. With `HEPATOPLAN_RESEARCH_TEST=1`, `npm.cmd run test:browser -- research.spec.ts` passed 2. After `npm.cmd run build:fixture`, the same research command with `HEPATOPLAN_FIXTURE_BUILD=1` passed both tests against preview at `/demo/`. All required suites ran with zero failures or skips.
  - **Release and measurements.** The built fixture served all four files for each of `case-001`, `case-002` and `case-003` from `research-2`. The worker changed remaining volume on `case-002` from 323.19 mL to 1,279.39 mL between the two saved cuts. The A/B table passed on `case-002` and changing the A/B pair reconciled the four region volumes on `case-001`. The four final reports are under `backend/.local/` as `task-6-verification.json`, `task-7-comparison-verification.json` and their `built-` counterparts.
  - **Timing observation.** The built fixture recorded 447.9 ms rendered input p95 on headless software WebGL against the existing 150 ms target. The test reports timing separately from its functional assertions. Its worker p95 was 19.1 ms and input p95 with rendering disabled was 101.1 ms. Verification on the production UI and demo device belongs to FT-15.

## 1. App entry and public demo data

- [ ] **FT-01 Bundle and serve the production app**
  - **Depends on** PRE-06.
  - **Build** Add the landing and workspace entry flow, development command, static build and preview command. Bundle the installed Three.js and module worker. Resolve the case catalogue relative to the deployed app base.
  - **Done when** A fresh tab can open Landing and enter the workspace in the served build. The worker loads from the build output. Document the commands that reproduce this.

- [ ] **FT-02 Populate the public case catalogue** (FE-13)
  - **Depends on** PRE-06. Reuse the release staged and verified in PRE-04. This production-entry packaging check can run alongside FT-01.
  - **Build** Include the prepared `public/cases/` tree staged by PRE-04 in the production app output. For a replacement release, stage the complete versioned directory, including `ATTRIBUTION.txt`, before publishing its matching index. [Release workflow](backend/README.md#publish-a-complete-case-release)
  - **Done when** The public index lists `case-001`, **`case-002`** and `case-003`. Every listed directory contains matching `metadata.json`, `labels.bin`, `liver.stl` and `tumour.stl`. Only prepared assets and release documentation enter the public tree. FT-15 verifies the packaged result over HTTP.

- [ ] **FT-03 Establish the shared layout and controls** (FE-10)
  - **Depends on** FT-01.
  - **Build** Use the HTML reference’s Inter and JetBrains Mono typography, obsidian surfaces, faint imaging grid, framed viewport, thin borders and compact pills. Share buttons, labelled ranges, dialogs, status messages and metric rows across views.
  - **Done when** At desktop width the hero has a 5/7 split and the Plan workspace has a 3/6/3 grid. Keyboard focus is visible. Dialogs contain focus, handle Escape as Cancel and return focus to their opener.

- [ ] **FT-04 Connect case loading, session ownership and the case chooser** (FE-01, FE-13)
  - **Depends on** FT-01, FT-03.
  - **Build** Load the index with the existing loader. Keep one case controller and plan session across in-app navigation. Show the active case ID, chooser and Plan/Compare navigation in the workspace header. Reuse an active or in-flight demo selection.
  - **Done when** Choosing a different case clears old anatomy and readings immediately. Re-selecting the active case closes the chooser. Empty catalogue, absent demo ID and missing or invalid assets each show the relevant retry or case-selection action. A slower earlier load cannot replace a later selection.

## 2. Landing and live planning

- [ ] **FT-05 Mount the shared viewer in hero and workspace modes** (FE-02, FE-08)
  - **Depends on** FT-02, FT-04.
  - **Build** Mount the existing Three.js viewer with the prepared meshes. Restrict the hero to rotation. Support orbit, pan and zoom in Plan with keyboard-operable camera actions. Match the legend to the renderer’s colours for tumour, plane, removed and remaining tissue. [Viewer](frontend/src/planning/resection-viewer.ts)
  - **Done when** Both modes render the real case. Camera actions preserve measurements. Resizing keeps the anatomy framed, navigation disposes obsolete renderers, and a WebGL failure offers a local retry while available measurements remain readable.

- [ ] **FT-06 Assemble the HTML landing page with the Figma comparison body** (FE-08)
  - **Depends on** FT-05.
  - **Keep sections 01–04 in order.** Retain the HTML navigation, split hero, The Challenge and Our Solution. Preserve the HTML hero composition and the agreed headline **See Beyond 2D. Plan in 3D**, with the break after “2D.” Use the framed, rotate-only demo from FT-05. Its actions are **Explore HepatoPlan** and **Try a CT upload**. Align retained copy and callouts with the supported liver, tumour and plane data and the research/education purpose.
  - **Replace sections 05–09 inclusive.** Remove the embedded Interactive 3D Experience, Technical Architecture, Science Behind the Numbers, Validation Strategy and Development Roadmap from the landing flow. Keep the full interactive editor accessible through the separate Plan workspace.
  - **Insert the body of Figma frame 01 immediately after Our Solution.** Build the **Same liver, two cuts** panel with explanatory copy and **Explore HepatoPlan** on the left and paired **Centre cut** and **Tilted cut** studies on the right. Capture both from the same `case-002` release and camera angle. Show the actual remaining mL and FLR beneath each still. Follow the panel with the **How measurements work** disclosure, initially collapsed, explaining parenchyma volume, FLR and geometric tumour distance. [Landing frame, body below the hero](https://www.figma.com/design/zfcRI7iwgYD8xj6ngrvUI0?node-id=3-839)
  - **Keep section 10 last.** Retain the HTML final CTA and footer. Update the desktop navigation, mobile menu and footer together. Link comparison and methods entries to the new body anchors, route workspace CTAs to Plan, and remove obsolete roadmap links. Remove landing-only initialisers for discarded sections so missing controls or canvases cannot interrupt the hero or menu.
  - **Done when** Desktop and mobile each show one HTML hero, Challenge, Solution, the Figma comparison panel, methods, then the HTML final CTA/footer. Every menu link and CTA reaches its intended destination. Explore opens Plan on `case-002` in one action, and the hero handles loading and retry. Each still agrees with its displayed readings and can be regenerated when the release changes. FT-07 completes the upload action.

- [ ] **FT-07 Implement the local CT upload preview** (FE-09)
  - **Depends on** FT-04, FT-06.
  - **Build** Open the preview from Landing or the case chooser. Explain before selection that the file stays local and the demo uses prepared case `case-002`. Show the selected filename, choose-again, Continue and Cancel.
  - **Done when** Continue becomes available after selection and opens the identified demo case. Cancelling the picker preserves the dialog. Cancelling the dialog restores the entry surface. The app neither reads nor transmits file contents, and discards the filename on exit.

- [ ] **FT-08 Wire the Plan widget controls** (FE-02, FE-03)
  - **Depends on** FT-05.
  - **Build** Put the three geometric preset pills above the workspace. Bind case-scaled X offset in whole mm, Z angle from −45° to +45°, removal side, flip and reset to the controller. Bind Show plane and liver opacity to the viewer. [Plane controls](frontend/src/planning/plane-controls.ts)
  - **Done when** Pointer and keyboard edits update signed readouts and the cut immediately. A preset updates both inputs and preserves the removal side. Reset restores centred 0 mm, 0° and the positive side. Hiding the plane or changing opacity affects only the display.

- [ ] **FT-09 Bind the live measurements and Save eligibility** (FE-04)
  - **Depends on** FT-08.
  - **Build** Lead with remaining parenchyma in mL and FLR in percent. Bind the proportional FLR bar, total and removed volumes, resection percentage, tumour intersection and geometric distance estimate in mm. Use the existing measurement formatter. [Measurement panel](frontend/src/planning/measurements-panel.ts)
  - **Done when** During rapid edits, labels stay put while old readings and the bar clear. Save is enabled only for a current result. Failed calculations show **Retry measurements** and leave the cut editable. Render descriptive values without a clinical safety threshold.

## 3. Save, revisit and compare

- [ ] **FT-10 Save and reopen named snapshots** (FE-05, FE-11)
  - **Depends on** FT-09.
  - **Build** Connect the save dialog, saved-plan count, empty state and list to the existing session. Require a nonblank name and accept optional procedure type, reason and notes. Scope snapshots by case and release, use plan IDs for selection and distinguish duplicate names by save order. [Plan session](frontend/src/planning/plan-session.ts)
  - **Done when** Saving keeps the cut and camera in place. Opening restores plane and details and requests current measurements. Switching away and back retains the case’s saved plans. Refresh clears them as described in the UI.

- [ ] **FT-11 Preserve working cuts across navigation** (FE-11)
  - **Depends on** FT-07, FT-10.
  - **Build** Track changes against the initial or last saved/opened plane. Before switching cases, opening another snapshot or leaving the editor with an edited cut, allow Save and continue, Discard and continue, or Stay. Apply the same guard to in-app Back and entry through the upload preview.
  - **Done when** Cancelling a save or choosing Stay preserves the working cut. A successful save completes the pending navigation once. Entering Compare and returning preserves unsaved geometry. Camera and visibility changes never mark it dirty.

- [ ] **FT-12 Deliver the core side-by-side comparison** (FE-06, FE-12)
  - **Depends on** FT-10, FT-11.
  - **Build** Show Compare eligibility at zero or one saved plan. With two eligible plans, open a two-column table of the six saved measures. Add distinct A/B selectors, Swap A/B, Open A/B and Back to planning. Use the two most recent saves for **Compare these plans** and retain a valid explicit pair on an ordinary return.
  - **Done when** The user can complete Landing → Plan → save two cuts → compare → return. Swapping exchanges headers and values together. Opening a snapshot and returning to the working cut follow their respective navigation rules.

- [ ] **FT-13 Add the spatial difference view** (FE-07, FE-12)
  - **Depends on** FT-12, after the core demo walkthrough passes.
  - **Build** Start with the table expanded and **Show differences** off. On request, show one rotatable model and the four labelled mL volumes alongside the table. Bind the worker’s ordered pair and the renderer’s matching colours. [Difference panel](frontend/src/planning/plan-difference-panel.ts)
  - **Done when** Changing pairs mid-calculation clears superseded highlights and volumes. The table remains readable during loading and retry. Identical cuts yield zero exclusive volumes. Swapping A/B exchanges the exclusive volumes and colours, and all four volumes sum to total parenchyma within display rounding.

## 4. Responsive review and demo acceptance

- [ ] **FT-14 Verify responsive and keyboard workflows**
  - **Depends on** FT-13.
  - **Build** Below 1024 px stack the viewer, remaining-volume/FLR strip, plane controls and detailed results. Keep the compact viewer and primary readings visible while adjusting a slider. Preserve adjacent A/B columns and place the optional difference model below the table.
  - **Landing check** At 390 px stack the comparison introduction and the two studies in reading order. Keep each cut name, image and measurements together. Open the methods disclosure by keyboard and follow the mobile menu and final CTA to their destinations.
  - **Done when** At 390 px, intermediate widths and desktop, users can see the effect of a slider edit. In short landscape view a focused control stays reachable. Test long plan names, all comparison actions, focus restoration, signed slider announcements and the full save/compare flow by keyboard. No clipping or horizontal page scroll.

- [ ] **FT-15 Verify the served production demo end to end**
  - **Depends on** FT-02, FT-06, FT-07, FT-14.
  - **Verify** Serve the production build from a fresh tab. Inspect the HTTP catalogue and open every listed case through the chooser. Confirm each loads its metadata, both meshes and labels. Check index revalidation and immutable versioned asset caching. Exercise both entry paths on `case-002`, edit a cut, save two variants, compare and show differences.
  - **Done when** Record the verified release ID and walkthrough result. Exercise retries, rapid case and pair changes, session reset and the responsive checks. Run the existing TypeScript and browser checks and cover new navigation regressions through the production entry. Verification uses the packaged public assets, including **case-002**.
