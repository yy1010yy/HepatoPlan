# HepatoPlan tools and browser engine

Run the offline Python commands from `tools/` and the Node commands from `frontend/`. Use Python 3.12+ and Node.js 24.12+. The commands below use Windows PowerShell.

From `tools/`:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests
```

From `frontend/`:

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
```

On macOS or Linux, use `.venv/bin/python`, `npm` and `npx`.

## Run the local analysis API

Use Node.js 24.12 or newer. Install the two packages from the repository root, then start the API in its own terminal.

```powershell
npm.cmd --prefix frontend ci
npm.cmd --prefix api ci
npm.cmd --prefix api start
```

The API listens at `127.0.0.1:4191`. Its start command loads the repository-root `.env` if present. Use `.env.example` as the template and set `GEMINI_API_KEY` in the local `.env` when you are ready for a live check. `GEMINI_MODEL` defaults to `gemini-3.1-flash-lite`. An empty key leaves the API available for validation and returns HTTP 503 for a valid analysis request. A custom `HEPATOPLAN_API_PORT` must be supplied to both the API and Vite processes.

The API allows Gemini up to 20 seconds to respond. If the deadline expires, the user can retry analysis with the same measured cut.

Start the frontend in a second terminal. Both development and preview proxy origin-root `/api/` to the local API.

```powershell
npm.cmd --prefix frontend run dev -- --host 127.0.0.1
```

For the built preview, use the same base for building and serving.

```powershell
npm.cmd --prefix frontend run build -- --base=/demo/
npm.cmd --prefix frontend run preview -- --base=/demo/ --host 127.0.0.1
```

Run the HTTP and proxy checks without credentials. They exercise the routes with a simulated provider, including success, invalid input, quota, missing key, invalid replies and timeout.

```powershell
npm.cmd --prefix api run typecheck
npm.cmd --prefix api test
npm.cmd --prefix api run test:proxy
```

After adding a Gemini key and starting the API, run the live smoke command against either Vite URL below. The command measures the published demo case locally and sends one request to each analysis route. It validates the responses and prints each recommended action. This command also provides an API check before testing the full UI in FT-22.

```powershell
npm.cmd --prefix api run smoke -- http://127.0.0.1:5173/
npm.cmd --prefix api run smoke -- http://127.0.0.1:4173/demo/
```

## Static preview

Serve the public directory from `tools/` and open `http://127.0.0.1:8000/cases/index.json`.

```powershell
.\.venv\Scripts\python.exe -m preprocessing.static_preview --port 8000
```

The format fixtures live under `fixtures/` and exercise the JSON contract using synthetic metadata.

## Version 1 case contract

The two JSON Schemas under `contracts/` define the index and case metadata. Python and TypeScript tests read the same sample files. TypeScript consumers can import `CaseIndex` and `CaseMetadata` from `frontend/src/planning/case-contract.ts`.

- The public index is `public/cases/index.json`. Resolve each case's `releases/<releaseId>/<caseId>/` path relative to the index URL. Each case has `metadata.json`, `labels.bin`, `liver.stl`, and `tumour.stl`. Use lowercase ASCII letters, digits, and hyphens in release and case IDs.
- `labels.bin` contains exactly `nx * ny * nz` bytes as a headerless unsigned 8-bit array in C order. The byte offset for voxel `(i, j, k)` is `(i * ny + j) * nz + k`. Values are 0 for background, 1 for parenchyma, and 2 for tumour.
- `voxelToWorldMm` is a row-major matrix represented as four arrays of four numbers. It maps integer voxel centres to the case's NIfTI RAS+ coordinates in millimetres. `voxelSpacingMm` holds the lengths of the three spatial columns. The affine defines position and physical volume.
- Both binary STL meshes use the same physical frame in millimetres. The preview serves the public index and case assets as static files.

The schemas validate the JSON structure. The exporter and loader tasks in the tracker cover asset integrity and alignment checks.

## Check an offline case selection

For a real demo release, use the extracted [Medical Segmentation Decathlon Task03 Liver dataset](https://medicaldecathlon.com/dataaws/) with its `imagesTr/` and `labelsTr/` directories. Keep the dataset and allowlist outside `public/`. One local option is `backend/.local/`, which Git ignores.

Create a local `selection.json` mapping public case IDs to source filename stems, for example `{"case-001": "liver_10"}`. This entry pairs `imagesTr/liver_10.nii.gz` with `labelsTr/liver_10.nii.gz`. Run the check from `tools/`.

```powershell
.\.venv\Scripts\python.exe -m preprocessing.case_selection --dataset-dir ../backend/.local/Task03_Liver --allowlist ../backend/.local/selection.json --release-id demo-1 --output-dir ../public/cases
```

The command checks the IDs and whether both files for each entry can be read. It prints public case IDs and leaves the output directory untouched. Synthetic selection tests run with the standard Python test command above.

## Stage label assets and metadata

Run the label exporter from `tools/` to validate the selected NIfTI pairs and stage their cropped masks and metadata outside `public/`.

```powershell
.\.venv\Scripts\python.exe -m preprocessing.label_export --dataset-dir ../backend/.local/Task03_Liver --allowlist ../backend/.local/selection.json --release-id demo-1 --output-dir ../backend/.local/staging
```

The exporter checks the CT and mask dimensions and converts their affine transforms to millimetres. It requires corresponding corner voxel centres to be within 0.001 mm. If a header omits its spatial unit, supply an override only after verifying the unit for that file. For example, `--unit-overrides ../backend/.local/verified-units.json` can read `{"case-001":{"ct":"mm","label":"mm"}}`. Include only the fields that need an override. Accepted units are `meter`, `mm`, and `micron`.

Look for `labels.bin` and `metadata.json` under `.local/staging/releases/demo-1/<caseId>/`. The command stages all selected cases before making that directory available and refuses to replace an existing staged release.

## Publish a complete case release

Run the full exporter from `tools/` with the same allowlist and verified units. It rebuilds the label assets directly from the source pairs and adds aligned binary STL meshes. Pass `--unit-overrides` here as well if needed.

```powershell
.\.venv\Scripts\python.exe -m preprocessing.release_export --dataset-dir ../backend/.local/Task03_Liver --allowlist ../backend/.local/selection.json --release-id demo-1 --output-dir ../public/cases
```

Each release includes dataset attribution and licensing information. The exporter stages and verifies every case before moving the release into place and replacing `index.json`. Use a new release ID for each publication. The previous release directory stays available to clients that already loaded its index.

The local preview serves `cases/index.json` with `Cache-Control: no-cache` and versioned case files with `Cache-Control: public, max-age=31536000, immutable`. Apply the same policy on the static host when deploying the demo.

## Evaluate resection geometry

Create a `PreparedCase` from `frontend/src/planning/volumetry.ts` with a case's metadata and `Uint8Array` label buffer. It takes a private snapshot once. Call `evaluate(plane)` on the same case whenever the plane changes. A plane has a point in millimetres, a normal, and a removal side, as defined in `frontend/src/planning/plane.ts`.

The result contains full-precision volumes in millilitres, percentages, and tumour contact and distance in millimetres. `npm.cmd test` exercises the engine with synthetic masks, including oblique cuts and cases where the cut passes between disconnected tumour regions.

## Load a case in the browser

Pass the full index URL to `loadCaseIndex`, then pass the returned catalog and a case ID to `loadCaseBundle`. Both functions in `frontend/src/planning/case-loader.ts` accept an optional abort signal. A rejected load can be retried by calling the same function again.

Pass the bundle's metadata and label buffer to `startVolumetryWorker` with a new selection token. Keep the decoded liver and tumour meshes for rendering. The startup call transfers the label buffer. Wait for `ready` before sending an `evaluate` message, and use the echoed selection token and revision to identify the response. The browser bundler needs to compile the module worker referenced by `startVolumetryWorker`.

For interactive use, create a `CaseController` with the loaded catalog and subscribe to its state. Call `selectCase` and wait for the ready state before rendering the selected case. Call `setPlane` to update the viewer and queue a calculation. The default plane passes through the liver bounds centre. Use the optional `releaseMeshes` callback to dispose of renderer-owned geometry when the controller releases a case, and call `dispose` when leaving the workspace.

Pass the current state to `measurementPanel` for formatted rows and the save flag. Use `retry` on the controller for a failed load or calculation. On a crash, the controller reloads the worker and reuses the current plane. If the replacement crashes before returning a current result, the controller exposes a retryable case error.

## Wire the resection plane controls

Use `bindPlaneControls` from `frontend/src/planning/plane-controls.ts` to connect two native range inputs, their readouts, preset buttons, and the flip and reset buttons to a `CaseController`. Call the returned function when disconnecting the controls. The offset range comes from the loaded liver bounds and the angle range is −45° to +45°.

Framework components can call `setPlaneOffset`, `setPlaneAngle`, `applyPlanePreset`, `flipResectSide`, and `resetPlane` directly and render `planeReadouts` from the current case. The readouts follow that geometry and display rounded values while the worker receives the plane at full precision.

## Mount the 3D viewer and compare plans

Call `mountResectionViewer(container, controller)` in the browser with a sized container. It mounts a Three.js canvas with orbit, pan, and zoom, then renders the liver halves and tumour in the case's physical frame. `setPlaneVisible` toggles the overlay and `setLiverOpacity` accepts values from 0 to 1. Call the returned `dispose` method when removing the viewer.

Create one `PlanSession` per controller. Use `save({ name, procedureType, reason, notes })` after measurements are ready and `list()` to populate the plan selector for the active case. Pass the selected ID to `open` to restore its plane and request fresh measurements. Pass two or more distinct IDs to `compare` for labelled rows in selection order. Use plan IDs as selector values because two plans may have the same name.

## Run the synthetic browser checks

From `frontend/`, run `npx.cmd playwright install chromium` once, then run `npm.cmd run test:browser`. On Windows with Chrome already installed, you can set `$env:PLAYWRIGHT_CHANNEL = 'chrome'` before running the suite. Playwright starts a loopback Vite server and runs the test page in headless Chromium with software WebGL.

The browser tests supply synthetic cases over HTTP and exercise the real viewer and worker. The regular `npm.cmd test` suite covers delayed case and worker responses, animation-frame scheduling, and calculation retry deterministically. Both suites run independently of the Task03 Liver dataset.

## Verify the local research release and demo

Publish the three-case release to `backend/.local/research-public/cases` with the offline exporter. From `frontend/`, opt in to the research browser test.

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:HEPATOPLAN_RESEARCH_TEST = '1'
npm.cmd run test:browser -- research.spec.ts
```

The test loads every case through the selector, runs the demo on `case-002`, and records case load, worker calculation, and input-to-rendered-result timings in `backend/.local/task-6-verification.json`. The report uses 20 slider actions and 10 preset actions for its p95. If the 150 ms target is missed, the test repeats those actions with rendering disabled to help isolate the difference.

Set `HEPATOPLAN_RESEARCH_PUBLIC_DIR` from `frontend/` to override the prepared **public root** containing `cases/index.json`. Both Vite and the research tests use that location. Reports are written under `backend/.local/`.

## Deploy the demo and analysis on Vercel

Import the repository as one Vercel project with the repository root as the Root Directory. The checked-in `vercel.json` uses the Other preset, installs both Node workspaces with `npm ci`, and serves the Vite build from `frontend/dist/app` at the domain root. The two files under `api/*/explain.ts` are the Vercel function entry points. Vercel bundles the shared TypeScript source alongside the compiled entry points, so Node can load the source extensions used by the existing API. Both functions use the same app and validation as the local server.

Set `GEMINI_API_KEY` as a sensitive variable for the environment being deployed. `GEMINI_MODEL` is optional. After deploying, open the demo on the deployed origin, run **Analyse this plan**, then save two cuts and run **Analyse comparison**. Both actions should show an AI recommendation.

## Verify the built fixture

From `frontend/`, confirm the prepared release is in the repository's `public/cases/`, then run:

```powershell
npm.cmd run build:fixture
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:HEPATOPLAN_RESEARCH_TEST = '1'
$env:HEPATOPLAN_FIXTURE_BUILD = '1'
npm.cmd run test:browser -- research.spec.ts
Remove-Item Env:HEPATOPLAN_RESEARCH_TEST, Env:HEPATOPLAN_FIXTURE_BUILD
```

Playwright starts Vite preview over HTTP at `/demo/`, serving `frontend/dist/fixture`. The built workflow writes `built-task-6-verification.json` and `built-task-7-comparison-verification.json` under `backend/.local/`.
