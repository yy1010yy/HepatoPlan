# HepatoPlan backend task tracker

Use the checkboxes to track implementation. Tick a task once its deliverable and completion checks are in place. Task IDs identify dependencies and can be used in commits or handoffs. Tasks with satisfied dependencies can run in parallel. The design and product requirements define the MVP scope. [Backend design](backend-design.md) · [Product requirements](HepatoPlan%20Product%20Requirements.md)

The demo needs one verified prepared case. The submission target is 3–5, tracked separately in BT-29. The backend work includes offline Python preparation, the TypeScript calculation engine and worker, and the contracts the browser uses for the viewer and plans. BT-32 through BT-40 cover the 3D A/B plan difference view after the core demo passes in BT-31.

## 1. Project setup and asset contract

- [x] **BT-01 Set up development and verification commands**
  - **Depends on** None.
  - **Build** Set up the offline Python tooling with NiBabel, NumPy, scikit-image, and trimesh. Set up TypeScript checks and a test runner that can exercise the calculation engine without a browser. Establish a way to serve the web app and its case assets from static files during development.
  - **Done when** A fresh checkout can run the documented setup, Python checks, TypeScript checks, and local static preview. The Python environment is used for asset preparation and the browser calculation engine runs in TypeScript.

- [x] **BT-02 Define version 1 of the static case format**
  - **Depends on** BT-01.
  - **Build** Define `public/cases/index.json` with `schemaVersion: 1`, `releaseId`, and unique case IDs under `cases`. Use lowercase letters, digits, and hyphens for IDs. Define each bundle at `releases/<releaseId>/<caseId>/` with `metadata.json`, `labels.bin`, `liver.stl`, and `tumour.stl`.
  - **Build** Specify metadata fields for schema version, matching IDs, positive integer `dimensions`, three `voxelSpacingMm` values, the row-major `voxelToWorldMm` affine, and `labelCounts.parenchyma` and `labelCounts.tumour`. Represent the affine in JSON as four rows of four values. Define the label byte order and binary STL coordinate units in the same contract.
  - **Done when** A minimal sample index and metadata record can be consumed by both Python and TypeScript, and the expected asset paths and units are unambiguous.

## 2. Offline preparation and publishing

- [ ] **BT-03 Read the dataset selection and pair source files**
  - **Depends on** BT-01.
  - **Build** Accept an extracted Task03 Liver dataset directory, a local allowlist mapping public case IDs to source image stems, a release ID, and an output location. Resolve each selected stem to its matching labelled CT and segmentation. Keep source paths, the allowlist, and any verified unit overrides local to the exporter.
  - **Done when** A valid mapping resolves and errors identify the affected case for duplicate or invalid IDs, missing pairs, and unreadable inputs. Source files and local configuration stay outside the served tree.

- [ ] **BT-04 Validate NIfTI inputs in a common physical frame**
  - **Depends on** BT-03.
  - **Build** Require 3D CT and label volumes with matching dimensions and spatial alignment. Convert the source affines to RAS+ millimetres using the header units, or use an explicitly verified local unit override for a missing unit. Reject missing unit information without an override, non-finite or singular affines, and misaligned pairs. Validate mask values before casting to integers. Require labels `1` and `2` and allow only labels `0`, `1`, and `2`.
  - **Done when** The validator accepts a valid pair and rejects wrong shape, misaligned affine, invalid labels, a missing foreground class, and invalid or unresolved spatial metadata.

- [ ] **BT-05 Crop labels and preserve the voxel-to-world transform**
  - **Depends on** BT-04.
  - **Build** Find the inclusive bounds of the union of labels `1` and `2`. Crop the label grid to those bounds without resampling. Record the source-grid crop origin for export validation and compose the crop affine with the corresponding source-grid translation. Compute the published voxel spacing from the lengths of the crop affine's spatial columns.
  - **Done when** Original and cropped label counts match and corresponding source and cropped voxel centres map to the same world coordinates, including for a nonzero crop origin and a reflected or rotated affine.

- [ ] **BT-06 Serialize the original label values and case metadata**
  - **Depends on** BT-02, BT-05.
  - **Build** Write the cropped grid as a headerless `uint8` array in NumPy C order and publish its metadata. Use `(i * ny + j) * nz + k` for byte indexing and preserve the label meanings: `0` background, `1` parenchyma, `2` tumour.
  - **Done when** A read-back confirms exactly `nx * ny * nz` bytes, expected labels at deliberately asymmetric indices, matching IDs, the crop affine, and both foreground counts.

- [ ] **BT-07 Generate aligned liver and tumour display meshes**
  - **Depends on** BT-05.
  - **Build** Build the liver surface from the union of labels `1` and `2` and the tumour surface from label `2`. Pad each binary grid by one background voxel, extract at marching-cubes level `0.5` with unit spacing, subtract the padding offset, and apply the crop affine once to the vertices. Correct face winding when the affine reverses handedness and export both files as binary STL in world millimetres.
  - **Done when** Both STLs can be reread with finite vertices and faces. On a known fixture, the surfaces align with the labelled voxel boundaries, including foreground touching the crop edge and a reflected affine.

- [ ] **BT-08 Verify the exporter on a synthetic case**
  - **Depends on** BT-06, BT-07.
  - **Build** Create a small reproducible CT/label fixture with a nonzero crop origin, unequal axis sizes, anisotropic spacing, at least one asymmetric label position, and a rotated or reflected affine. Inspect the exported geometry and use independent expected positions and label counts to check the round trip.
  - **Done when** The fixture catches axis-order and half-voxel mistakes, verifies mesh and mask alignment, and demonstrates that the validation path rejects a mismatched source affine, missing labels, and a truncated output asset.

- [ ] **BT-09 Build and publish complete immutable case releases**
  - **Depends on** BT-08.
  - **Build** Write selected cases to a staging area. Check each complete bundle against its source label counts, metadata, and decoded meshes before adding its ID to the index. Publish the validated release and index together. Serve the bundle assets at immutable release paths and keep the index revalidatable. Require a new release ID when asset contents change. Include dataset attribution, the licence, and a description of the cropping and conversion in the release documentation.
  - **Done when** The published index names only complete, validated bundles. A failed export leaves the previous index and release usable. The served tree contains only public IDs, derived case assets, the public index, and release documentation.

## 3. Pure TypeScript volumetry

- [ ] **BT-10 Define shared plane and result types**
  - **Depends on** BT-01.
  - **Build** Define `Vec3`, `ResectionPlane` with `pointMm`, `unitNormal`, and `resectSide`, and `VolumetryResult` with total, removed, and remaining parenchyma in mL, FLR and resected percentages, tumour intersection, and tumour distance in mm. Validate finite plane inputs, the supported side values, and a nonzero normal. Normalise the normal at the boundary where a new plane is accepted.
  - **Done when** The controller and worker can share serializable types, invalid inputs produce a clear error, and the types and validation import independently of React and Three.js.

- [ ] **BT-11 Prepare an immutable case for repeated calculations**
  - **Depends on** BT-02, BT-10.
  - **Build** Consume case metadata and a `Uint8Array`. Validate dimensions, label buffer length, allowed values, positive foreground counts, and agreement with both metadata counts. Extract the affine columns and translation, validate the affine, and calculate `abs(det(A))` in mm³. Cache the derived values and label counts for the case.
  - **Done when** Case preparation rejects corrupted metadata or labels and calculates a positive voxel volume for a valid reflected, anisotropic, or sheared affine. The prepared case can be evaluated repeatedly using the same mask buffer.

- [ ] **BT-12 Calculate parenchyma splits from voxel centres**
  - **Depends on** BT-11.
  - **Build** Project all three affine columns and `t - P` onto the plane normal once per evaluation. Evaluate `d = N · (t - P) + (N · a0) * i + (N · a1) * j + (N · a2) * k` while scanning the mask. Count only label `1` voxels. Positive removal uses `d > 0`, negative removal uses `d < 0`, and centres on the plane stay in the remaining region.
  - **Build** Compute remaining count by subtraction. Convert all counts to mL with `count * voxelVolumeMm3 / 1000` and use total parenchyma count as the denominator for both percentages. Keep full precision at this boundary. Use one scan and avoid building arrays of physical coordinates.
  - **Done when** Removed and remaining counts reconcile exactly, their volumes reconcile within floating-point precision, and both percentages are derived from the same total.

- [ ] **BT-13 Calculate tumour contact and closest distance**
  - **Depends on** BT-12.
  - **Build** In the same scan, evaluate label `2` voxel centres. Compute the common projected voxel half-width `h = 0.5 * (abs(N · a0) + abs(N · a1) + abs(N · a2))`. A voxel intersects or touches when `abs(d) <= h`. Its distance is `max(0, abs(d) - h)`. Return whether any voxel intersects and the smallest distance across tumour voxels.
  - **Done when** A face touch yields intersection and zero distance. A plane in a gap between disconnected tumour regions yields a positive distance and no intersection. Flipping the removal side leaves these purely geometric measures equal.

- [ ] **BT-14 Verify the volumetry engine independently of the viewer**
  - **Depends on** BT-12, BT-13.
  - **Build** Use a `4 × 4 × 4` cube of 1 mm³ parenchyma voxels with a separate tumour label outside the cube. Assert 0.064 mL total, 32 voxels for a half cut and 16 for a quarter cut. Test fully removed and fully remaining cases, an on-plane centre for both removal sides, a side flip, and exclusion of tumour from the denominator.
  - **Build** Add a voxelised sphere with an independently counted discrete reference and a documented tolerance for comparison with its analytic volume. Cover anisotropic, reflected, and sheared affines. Check tumour face contact, a known nonzero nearest distance, and a disconnected-tumour gap. Compare at least one oblique projection with direct affine world coordinates.
  - **Done when** The cases run through the pure TypeScript test command and verify the expected units, geometry, and volume conservation.

## 4. Browser loader and volumetry worker

- [ ] **BT-15 Load and validate the release index**
  - **Depends on** BT-02.
  - **Build** Load the revalidatable index on entry and validate the version, release ID, and unique case IDs before exposing the list. Derive case asset URLs from the index URL and the validated IDs. Resolve the same release correctly when the app is hosted under a subpath.
  - **Done when** The case selector can consume a valid list, and an unavailable or malformed index yields a retryable state rather than a partial list.

- [ ] **BT-16 Fetch and validate a selected case bundle**
  - **Depends on** BT-15.
  - **Build** Load the selected case metadata and check the schema and IDs against the index. Validate dimensions and finite spatial fields. Fetch both STLs and the label buffer in parallel from their release paths. Check mask byte length and decode the STLs, rejecting empty, truncated, or non-finite geometry. Compute the liver bounds in the published coordinate frame.
  - **Done when** A valid bundle provides two decoded meshes, case bounds, metadata, and one label buffer. A failed fetch or invalid asset results in a case-level error with retry or case selection available.

- [ ] **BT-17 Implement the worker protocol**
  - **Depends on** BT-11, BT-13.
  - **Build** Implement one dedicated worker for the active case. Transfer the label buffer on initialisation and return ready only after case preparation succeeds. Accept an evaluation with selection token, plane revision, and plane configuration. Respond with the result or calculation error carrying the same token and revision.
  - **Done when** Repeated evaluations reuse the prepared mask, initialisation and evaluation failures are identifiable, and messages carry enough identity to reject responses from previous cases or planes.

- [ ] **BT-18 Manage the active case lifecycle**
  - **Depends on** BT-16, BT-17.
  - **Build** Assign a fresh selection token per case load. Abort prior fetches, terminate the old worker, and dispose of superseded mesh resources when switching cases. Activate a case only after its meshes and worker are ready. Apply the same token guard to late completions and late errors. Expose the selected case ID and loading, ready, and error states to the selector. Make error retry re-enter the normal load flow with a fresh token.
  - **Done when** A slow or failed previous selection cannot replace a newer selection or its errors. Switching repeatedly keeps one active case worker and releases its predecessor's rendering resources.

- [ ] **BT-19 Schedule evaluations for the latest accepted plane**
  - **Depends on** BT-10, BT-18.
  - **Build** Track plane revisions independently of case tokens. Update the viewer immediately on a change and schedule the initial plane and subsequent geometry or removal-side changes through the same evaluation path. Send at most one job per animation frame with at most one job in flight. While busy, replace the pending job with the most recent revision.
  - **Done when** Sustained input doesn't create an unbounded queue, and the final plane revision is evaluated even when earlier evaluations are still running.

- [ ] **BT-20 Publish current measurements and recover from errors**
  - **Depends on** BT-19.
  - **Build** Publish numeric results only when both message identifiers match the active case and plane. Expose updating, ready, and unavailable states to the results panel and save action. Show a retry action for a current calculation failure. After a worker crash, recreate and reload the worker and evaluate the current plane again.
  - **Build** Bind the structured results to the panel in mL, percentages, and mm. Round at display time and describe the tumour distance as a geometric estimate for research and education.
  - **Done when** Late results and errors cannot overwrite current measurements. Retry can recover the active plane, and the result panel and save action only use a current successful evaluation.

## 5. Plane controls and plan state

- [ ] **BT-21 Map plane sliders, removal side, and reset to world coordinates**
  - **Depends on** BT-19.
  - **Build** Use liver bounds centre `C`. Map offset in world X and angle about world Z to `P = C + [offsetMm, 0, 0]` and `N = [cos(theta), sin(theta), 0]`, converting degrees to radians. Use a symmetric offset limit of the liver's X half-width rounded up to a whole millimetre and 1 mm steps. Use −45° through +45° with 1° steps. Bind pointer and keyboard input to signed millimetre and degree readouts.
  - **Build** Default and reset to 0 mm, 0°, and positive-side removal. A side flip changes only `resectSide`. Preserve the preceding valid plane if an invalid input reaches the controller.
  - **Done when** Known slider values produce the expected point and normal, both axes use the loaded case's coordinate frame, and reset and side flip use the normal evaluation path.

- [ ] **BT-22 Apply presets and restore control values**
  - **Depends on** BT-21.
  - **Build** Implement **Negative offset** at −60% of the offset limit and −10°, **Centre tilt** at 0 mm and +8°, and **Positive offset** at +60% of the offset limit and +14°. Round preset offsets to the nearest millimetre step. Apply both setpoints in a single update and keep the current removal side.
  - **Build** Derive saved-plane readouts from `P.x - C.x` and `atan2(N.y, N.x)` converted to degrees. Keep the saved plane as the source of truth when reopening a plan.
  - **Done when** Each preset sets both controls and emits at most one new revision. Opening a saved plan restores the controls and permits further edits.

- [ ] **BT-23 Connect the viewer to the same physical plane**
  - **Depends on** BT-16, BT-21.
  - **Build** Render both meshes in their exported frame and point the camera at the liver bounds. Derive the two opposite Three.js clipping planes from the controller point and normal. For the positive half-space, use `N` and constant `-N · P`. Map removed and remaining colours to the selected side and keep the tumour independently visible.
  - **Build** Show the translucent plane overlay by default. Store overlay visibility and liver opacity as viewer state, and apply opacity to both liver materials. Keep both clipped regions visible when the overlay is hidden.
  - **Done when** A synthetic cut colours the same half that the engine counts as removed, and changing overlay visibility or opacity produces no evaluation request.

- [ ] **BT-24 Save a named plan as a session snapshot**
  - **Depends on** BT-20.
  - **Build** Store saved plans in application memory grouped by release ID and case ID. Require a nonblank name and a successful result for the active selection token and plane revision. Snapshot the plan ID, name, release ID, case ID, plane, and full-precision result. Support optional procedure type, reason, and notes.
  - **Done when** Saving during a pending or failed revision is blocked, later edits do not mutate the snapshot, and plans can still be found after switching away from and back to their case during the session.

- [ ] **BT-25 Reopen and compare saved plans**
  - **Depends on** BT-22, BT-24.
  - **Build** Restore a selected plan's geometry and removal side, update the readouts, and re-evaluate through the usual worker path. Provide a comparison of at least two saved snapshots from the same release and case. Expose removed and remaining volume, FLR and resection percentages, tumour intersection, and tumour distance in consistent units.
  - **Done when** Two distinct saved plans can be reopened and compared, same-name plans remain distinguishable by ID, and plans from another case or release cannot enter that comparison.

## 6. Integration tests and demo verification

- [ ] **BT-26 Test corrupt assets, concurrency, and worker recovery**
  - **Depends on** BT-08, BT-20.
  - **Build** Cover invalid index or metadata, missing assets, truncated labels or STL, worker initialisation failure, and retry. Simulate rapid case changes and rapid plane moves with deliberately delayed messages. Cover an evaluation error and a worker crash followed by a reload.
  - **Done when** Tests show that stale results and errors cannot leak across cases or revisions, only the latest pending evaluation is queued, and the active case or plane recovers through the documented retry path.

- [ ] **BT-27 Test the viewer controls and saved-plan workflow**
  - **Depends on** BT-08, BT-23, BT-25.
  - **Build** Exercise slider input, all presets, flip, reset, overlay toggle, and opacity with the synthetic bundle. Verify that a preset changing both controls issues one revision and visual-only controls issue none. Exercise saving before and after measurements settle, reopening a plan, switching cases, and comparing two snapshots.
  - **Done when** Rendered sides, readouts, and results agree on the active plane. Saved snapshots retain full precision, comparison stays case-scoped, and the results are presented as research and education measurements.

- [ ] **BT-28 Prepare and verify the first research case**
  - **Depends on** BT-09, BT-18.
  - **Build** Select one usable Task03 Liver case with both foreground labels and run the offline release pipeline. Check reported counts against the source labels and inspect both meshes against the mask in physical coordinates. Load the published bundle through the normal case selector.
  - **Done when** The first case passes preparation and can be used for performance measurement and the full demo. Record its public ID and the release ID.

- [ ] **BT-29 Expand the prepared set to the submission target**
  - **Depends on** BT-20, BT-28.
  - **Build** Prepare enough additional valid cases to reach 3–5 in total. Use a fresh release ID for the changed bundle set. Repeat label-count, mesh-alignment, bundle, browser-loading, and initial-measurement checks for every published case.
  - **Done when** The submission release indexes 3–5 individually verified cases and each case can be loaded and evaluated independently.

- [ ] **BT-30 Measure responsiveness on the demo device**
  - **Depends on** BT-27, BT-28.
  - **Build** Record case load time, worker evaluation time, and time from the final accepted plane input to the matching rendered result. Measure repeated slider and preset interactions after the case loads. Record the device, browser, release and case IDs, sample count, and 95th-percentile input-to-result time.
  - **Done when** The measurements are recorded against the initial 150 ms p95 target. If the target is missed, profile mask scanning and mesh rendering separately and record the bottleneck before proposing an encoding or calculation change.

- [ ] **BT-31 Run the end-to-end MVP demo**
  - **Depends on** BT-14, BT-26, BT-27, BT-28, BT-30.
  - **Build** On a prepared research case, load the anatomy, change offset and angle, apply a preset, toggle the plane overlay, flip the removal side, and reset. Verify matching voxel measurements, then save two different plans, reopen each, and compare them. Check that displayed outputs are described as experimental geometry and volumes.
  - **Done when** The complete flow succeeds on one prepared case. Record the verified release and any unresolved demo issues. Track completion of the 3–5 case submission target in BT-29.

## 7. 3D A/B plan difference view

These tasks implement FE-07 and BE-07. Use the two saved plan snapshots for both the voxel calculation and surface colours. The calculations follow the [A/B backend design](backend-design.md#3d-ab-plan-difference-view).

- [ ] **BT-32 Calculate four region volumes in one voxel scan**
  - **Depends on** BT-31.
  - **Build** Add pure `comparePlans(preparedCase, planeA, planeB): PlanDifferenceResult`. Reuse the point, normal, removal-side validation and affine projection from single-plan volumetry. Project each plane once. On a single pass through the active case mask, evaluate both signed distances for each label `1` voxel centre. For each plane independently, use `d > 0` for positive-side removal, `d < 0` for negative-side removal, and retained for `d = 0`. Skip background and tumour voxels.
  - **Build** Route the two removal decisions to exactly one integer counter. Map `[true, false]` to `removedOnlyByAMl`, `[false, true]` to `removedOnlyByBMl`, `[true, true]` to `removedByBothMl`, and `[false, false]` to `retainedByBothMl`. Multiply each counter by `voxelVolumeMm3 / 1000` and return the four full-precision values.
  - **Done when** The four counts add up to the parenchyma count. A's removed volume is A-only plus both removed, and A's retained volume is B-only plus both retained. B uses the same formulas with A and B exchanged. All sums match the corresponding single-plan results within floating-point precision.

- [ ] **BT-33 Test pairwise geometry with known volumes**
  - **Depends on** BT-32.
  - **Build** Use a `5 × 4 × 4` mask with label `1` at all centres where `i = 0…3`, label `2` at `(4, 0, 0)`, and background in the rest of the fifth column. Use the identity affine. Assert the following volumes in the order A-only, B-only, removed by both, retained by both.

    | Plan A removal rule | Plan B removal rule | Expected region volumes (mL) |
    | --- | --- | --- |
    | `x > 1.5` | `x > 1.5` | `[0, 0, 0.032, 0.032]` |
    | `x > 1.5` | `x < 1.5` | `[0.032, 0.032, 0, 0]` |
    | `x > 1.5` | `y > 1.5` | `[0.016, 0.016, 0.016, 0.016]` |
    | `x > 1` | `x < 1` | `[0.032, 0.016, 0, 0.016]` |
    | `x < 1` | `x > 1` | `[0.016, 0.032, 0, 0.016]` |

  - **Build** Repeat with the reflected anisotropic affine `(x, y, z) = (10 - 2i, 3j, 4k)`. For `x > 7` and `y > 4.5`, expect `0.384 mL` per region and `1.536 mL` total. For every fixture, compare each plan's derived removed and retained volumes with its independent single-plan result.
  - **Done when** The pure TypeScript test command verifies all four fields for every row within `1e-12 mL`. The identity cases sum to `0.064 mL`, including when the tumour is on a removed side.

- [ ] **BT-34 Add A/B requests to the active case worker**
  - **Depends on** BT-32.
  - **Build** Add the `comparePlans` message with `selectionToken`, `comparisonRequestId`, `planAId`, `planBId`, `planeA`, and `planeB`. Use the worker's initialised case and invoke the pure comparison function once per valid request. Return `comparePlansResult` with the four-field result, or `comparePlansError` with the error message. Echo the selection token, request ID, and both plan IDs on either response.
  - **Done when** A worker test sends a valid request and an invalid-plane request, checks the appropriate response and all four identifiers for each, and confirms repeated requests reuse the transferred mask.

- [ ] **BT-35 Validate the pair and track the current comparison**
  - **Depends on** BT-34.
  - **Build** Resolve the selected IDs to saved snapshots. A valid pair has two distinct IDs and both snapshots match the active release and case. Keep A and B ordered. On first selection or a change to a valid pair, capture both saved planes, assign a new request ID, clear earlier volumes, and enter `loading`. For an incomplete or invalid pair, clear the current request and displayed volumes and enter `idle`.
  - **Build** Accept a success or error only if its case selection token, comparison request ID, and both ordered IDs match the current request. Set `ready` with the returned volumes or `error` with a retry action. A retry for the current pair uses a new request ID. If the worker crashed, wait for the existing reload path to initialise the worker for the still-active case before retrying.
  - **Done when** Two distinct plans with identical geometry are valid, while selecting the same ID twice or mixing cases or releases enters `idle`. In an A/B → A/C → A/B sequence, the first A/B response is discarded and only the newest request can set `ready` or `error`.

- [ ] **BT-36 Share the single worker slot between measurements and comparisons**
  - **Depends on** BT-35.
  - **Build** Use one in-flight slot across `evaluate` and `comparePlans`. Keep at most the latest pending plane evaluation and the latest pending comparison. After the in-flight job completes, send the pending plane evaluation first if present, then send the latest still-current comparison. Release a slot only when the worker instance, message kind, selection token, and plane revision or comparison request ID match the job in that slot. A superseded in-flight comparison can release its own slot when it finishes even if its result is discarded.
  - **Build** Remove a queued comparison when the pair becomes invalid. On a case switch, terminate the old worker, clear the slot and both queues, and allow only the new worker to release its slot. Keep the current request when the same pair is re-rendered or **Show Differences** is toggled.
  - **Done when** A delayed-worker test queues A/B, then A/C and A/D, and a new plane evaluation while A/B is in flight. Once A/B finishes, the plane evaluation runs first and only A/D runs next. The test observes at most one in-flight job and confirms an old worker completion cannot release the new worker's slot.

- [ ] **BT-37 Colour the liver surface from both saved planes**
  - **Depends on** BT-31.
  - **Build** Add one comparison material for the existing liver mesh using a Three.js standard material with `onBeforeCompile`. Pass each plane as a world-space equation `dot(s * N, X) - dot(s * N, P)`, where `s` is `1` for positive-side removal and `-1` for negative-side removal. Evaluate both equations per surface fragment and treat a value greater than zero as removed. Use the same four decisions as BT-32 to select one colour per fragment.
  - **Build** Keep existing lighting and liver opacity. Update the plane uniforms when the ordered snapshots change. Use one shared palette for the material and legend. Use blue `#0072B2` for A-only, orange `#D55E00` for B-only, muted slate `#64748B` for removed by both, and light slate `#CBD5E1` for retained by both.
  - **Done when** Complementary cuts highlight opposite halves, swapping A and B swaps those highlights, and identical cuts show only the two shared colours. Rotating the camera keeps the colours attached to the same physical regions.

- [ ] **BT-38 Connect Show Differences and the volume legend**
  - **Depends on** BT-36, BT-37.
  - **Build** Add **Show Differences** to the saved-plan comparison, off by default and available for a valid pair. On enable, switch the viewer to the comparison material for the selected snapshots. On disable or incomplete selection, use the current-plan material and hide the comparison legend. Keep the side-by-side saved metrics available in both views.
  - **Build** Render four legend rows labelled **Removed only by A**, **Removed only by B**, **Removed by both**, and **Retained by both**. Use the palette from BT-37. Show **Updating…** while the current pair is loading, format all four values in mL when its result is ready, and show **Volumes unavailable** with **Retry** when its request fails. Keep the surface map for the current pair visible while its volumes are pending or unavailable. Label the view as a geometric comparison.
  - **Done when** Changing the selected pair updates surface colours immediately and clears old numbers while loading. Toggling the view, rotating the camera, or changing opacity sends zero comparison requests for the same pair.

- [ ] **BT-39 Verify comparison races, retry, and the visible results**
  - **Depends on** BT-33, BT-38.
  - **Build** Use a controllable worker in integration tests. Delay an A/B success while selecting A/C, delay an A/B error while switching cases, and then publish the active response. Inject an active comparison failure and retry it. Crash the worker during an active comparison and verify that retry runs after the current case's worker is reinitialised.
  - **Build** In the browser, compare the synthetic complementary plans from BT-33. Assert both saved FLR values are `50%`, both exclusive result fields equal `0.032 mL` within `1e-12 mL`, and both shared fields are zero. Verify that the legend shows the four values with the existing volume formatter and that its labels match the two exclusive highlights. Swap the plans, then compare two distinct saved plans with identical geometry and check that both exclusive highlights disappear.
  - **Done when** Old successes and errors cannot change the displayed data or status. Retry produces the matching pair's results, the legend and surface colours identify the same regions, and the existing saved-plan comparison still passes its checks.

- [ ] **BT-40 Run the A/B demo on a prepared research case**
  - **Depends on** BT-39.
  - **Build** On the demo device, load the case verified in BT-28, save two different valid planes, and open **Show Differences**. Rotate the model to inspect both regions and compare each region's label and volume. Switch one of the selected plans and confirm the legend transitions from updating to the new result.
  - **Done when** The four full-precision results sum to the case total and reproduce both saved plans' removed and remaining volumes. Record the release, case, two plan IDs, and observed volumes for the verified demo.
