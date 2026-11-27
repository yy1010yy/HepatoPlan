# HepatoPlan frontend

The production interface uses React and TypeScript with Vite. The app root owns the prepared-case controller and plan session across Landing and Plan. The TypeScript planning engine manages case loading and hands volumetry to a module worker. Both the app and the browser-engine fixture use the Three.js renderer.

Run these commands from `frontend/` with Node.js 24.12 or newer.

```powershell
npm.cmd ci
npm.cmd run dev
```

Open the local URL printed by Vite. The landing preview rotates the prepared demo, `case-002`. **Explore HepatoPlan** opens the same case in Plan, where you can orbit, pan and zoom. Focus the model to use arrow keys for orbit, Shift plus arrow keys for pan, and + or − for zoom. The workspace header opens the case chooser. The initial cut produces live worker readings, which stay available if the 3D view needs a retry.

**Try a CT upload** previews the local file picker and opens the prepared demo. The app displays the filename only while the dialog is open. Plan provides geometric presets, live plane and display controls, and measurements for the current cut.

When the current measurements are ready, **Save plan** records a named snapshot. Use **Saved plans** to reopen a cut from the current case and release. Plans stay in the browser tab until you refresh or close it. The app prompts before replacing or leaving an edited working cut.

With two snapshots, **Compare** opens the saved measurements side by side. Choose distinct plans, swap A and B, or open either cut in Plan. **Back to planning** returns to the working cut. Turn on **Show differences** to calculate and display the four spatial regions for the selected pair.

## Regenerate the landing studies

After staging a new prepared release, run from `frontend/`:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
node scripts/capture-studies.mjs
```

The script opens the staged `case-002` in Chromium, captures the centre and +35° cuts with the same camera, and writes the images and full-precision readings together under `src/assets/studies/`. Review both images and run the production browser suite to check that the displayed values match the live demo.

## Build and preview

```powershell
npm.cmd run build
npm.cmd run preview
```

Serve `frontend/dist/app/` on a static host. To reproduce the preview under a deployment prefix, use the same base for the build and preview.

```powershell
npm.cmd run build -- --base=/demo/
npm.cmd run preview -- --base=/demo/
```

Open the printed URL under `/demo/`. Plan uses a URL fragment, so the host can serve the emitted files with standard static routing. Only the root `public/` tree is copied into the application artifact. The prepared catalogue and versioned releases are served alongside the built JavaScript and worker. Apply the [release cache policy](../backend/README.md#publish-a-complete-case-release) on the deployment host.

## Verify the production entry

```powershell
npm.cmd run typecheck
npm.cmd test
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm.cmd run test:browser -- workflow.spec.ts
npm.cmd run test:browser:app
```

The app browser suite builds and serves the production entry at `/demo/`. It checks all three packaged cases, worker startup, the desktop grids, keyboard focus and case recovery. With Playwright-managed Chromium, install it with `npx.cmd playwright install chromium` and omit the Chrome channel setting. The [browser-engine fixture](../backend/README.md#run-the-synthetic-browser-checks) has a separate build and test command.
