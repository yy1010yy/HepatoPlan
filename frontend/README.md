# HepatoPlan frontend

The production interface uses React and TypeScript with Vite. The app root owns the prepared-case controller and plan session across Landing and Plan. The TypeScript planning engine manages case loading and hands volumetry to a module worker. Three.js provides the geometry tools and the renderer used by the browser-engine fixture. The production viewport currently shows load status and mesh extent, with viewer mounting scheduled for FT-05.

Run these commands from `frontend/` with Node.js 24.12 or newer.

```powershell
npm.cmd ci
npm.cmd run dev
```

Open the local URL printed by Vite. **Explore HepatoPlan** opens Plan with the prepared demo, `case-002`. The workspace header opens the case chooser. The initial cut produces live worker readings. The framed viewport reports whether the liver and tumour meshes loaded.

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
