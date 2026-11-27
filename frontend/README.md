# HepatoPlan frontend

The production interface uses React and TypeScript with Vite. The app root owns the prepared-case controller and plan session across Landing and Plan. The TypeScript planning engine manages case loading and hands volumetry to a module worker. Both the app and the browser-engine fixture use the Three.js renderer.

Run these commands from `frontend/` with Node.js 24.12 or newer.

```powershell
npm.cmd ci
npm.cmd run dev
```

Open the local URL printed by Vite. The landing preview rotates the prepared demo, `case-002`. **Explore HepatoPlan** opens the same case in Plan, where you can orbit, pan and zoom. Focus the model to use arrow keys for orbit, Shift plus arrow keys for pan, and + or − for zoom. The workspace header opens the case chooser. The initial cut produces live worker readings, which stay available if the 3D view needs a retry.

**Try a CT upload** previews the local file picker and opens the prepared demo. The app displays the filename only while the dialog is open. Plan provides geometric presets, live plane and display controls, and measurements for the current cut.

The FLR indicator uses three research display bands. Blue represents 30% or more, yellow represents 20% to under 30%, and red represents under 20%. Both readings use the same percentage-based colour. The bands are based on published liver-volume references. The app measures geometric remnant volume, and assessing liver function requires separate clinical information. [CIRSE practice standards](https://pmc.ncbi.nlm.nih.gov/articles/PMC11303578/), [Prospective remnant-volume study](https://pubmed.ncbi.nlm.nih.gov/17551779/)

Enter an optional procedure type and reason under **Plan context** in the left sidebar. Each field has an **Other** option for custom text. When the current measurements are ready, **Save plan** records the cut and its context with the name and notes from the dialog. Use **Saved plans** to reopen a cut from the current case and release. Plans stay in the browser tab until you refresh or close it. The app prompts before replacing or leaving an edited working cut.

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

Open the printed URL under `/demo/`. Plan uses a URL fragment, so the host can serve the emitted files with standard static routing. Only the root `public/` tree is copied into the application artifact. Vite preview serves `cases/index.json` with `Cache-Control: no-cache` and each prepared versioned release file with `Cache-Control: public, max-age=31536000, immutable`. Apply the same [release cache policy](../backend/README.md#publish-a-complete-case-release) when configuring another static host.

For local Plan and Compare analysis requests, the Vite dev and preview servers proxy origin-root `/api/` to the loopback Express server. Start the API separately when exercising those routes. [Local API setup and verification](../backend/README.md#run-the-local-analysis-api)

## Verify the production entry

```powershell
npm.cmd run typecheck
npm.cmd test
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm.cmd run test:browser -- workflow.spec.ts
npm.cmd run test:browser:app -- --grep-invert input.timing --workers=2
```

The app browser suite builds and serves `dist/app/` at `/demo/`. It checks all three packaged cases, conditional catalogue revalidation, the release cache headers, both demo entry paths, and the complete save and compare flow. It also checks keyboard access and the pinned model and readings at portrait, tablet, desktop, and short landscape sizes. With Playwright-managed Chromium, install it with `npx.cmd playwright install chromium` and omit the Chrome channel setting. The [browser-engine fixture](../backend/README.md#run-the-synthetic-browser-checks) has a separate build and test command.

Run the timing check separately to give the viewer a single browser worker. It measures 20 slider edits and 10 preset selections from input through the updated measurements and two animation frames.

```powershell
$env:HEPATOPLAN_APP_TIMING = '1'
npx.cmd playwright test --config playwright.app.config.ts --grep production.demo.input.timing --workers=1
Remove-Item Env:HEPATOPLAN_APP_TIMING
```

The report goes to `backend/.local/production-app-timing.json` and records the WebGL renderer and latency percentiles. Set `HEPATOPLAN_APP_DEFAULT_GL=1` when running the timing check with Chrome's default graphics settings. That profile writes `backend/.local/production-app-timing-default-gl.json`.
