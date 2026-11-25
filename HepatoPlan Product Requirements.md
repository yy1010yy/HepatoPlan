# HepatoPlan MVP Product Requirements

## Product goal

HepatoPlan gives researchers and learners a way to explore how a proposed liver resection changes the amount of liver that would remain. Using a prepared patient case, they can inspect the liver and tumour in 3D, adjust a virtual resection plane, and compare the geometric and volumetric results of alternative plans.

The MVP is designed for a 36–48-hour hackathon with 2–4 developers. It covers liver and tumour anatomy, a single adjustable plane, and descriptive measurements for research and education.

## Frontend requirements

| ID | Requirement |
| --- | --- |
| FE-01 | Let users select a prepared case by its anonymised identifier. Show a loading state and a clear error if required assets are missing or invalid. |
| FE-02 | Display the liver, tumour, and resection plane together in a 3D viewer. Make each visually distinct and support rotation, zoom, and pan. |
| FE-03 | Let users adjust the plane with offset and angle sliders, apply a starting preset, choose the removal side, and reset the plane. Show the updated plane and proposed removed and remaining regions in the 3D view as the controls change. |
| FE-04 | Display total, removed, and remaining liver parenchyma volumes in millilitres, plus resection and Future Liver Remnant (FLR) percentages. Show whether the plane intersects the tumour and the estimated minimum distance in millimetres. Label the distance as a geometric estimate and keep all displayed results aligned with the current case and plane. |
| FE-05 | Let users save multiple named plans for a case and switch between them during the session. Each plan retains its plane position, orientation, removal side, and calculated results. Users can also record a procedure type, reason for resection, and planning notes. |
| FE-06 | Compare at least two saved plans for the same case side by side. Show removed and remaining volumes, resection and FLR percentages, tumour intersection, and tumour-to-plane distance. |
| FE-07 | Offer **Show Differences** when comparing two saved plans from the same case and release. On one rotatable 3D liver model, highlight tissue removed only by Plan A or only by Plan B with distinct colours. Use muted colours for tissue removed by both or retained by both. Show each of the four region volumes in millilitres beside a matching legend. Show a loading state while the geometric comparison is calculated. |

### Resection plane controls

- **Plane Offset** moves the plane left or right along the case's physical X axis. Show a signed readout in millimetres and scale the slider range to the loaded case.
- **Plane Angle** tilts the plane around the case's physical Z axis. Show a signed readout in degrees and support slider changes by pointer and keyboard.
- **Plane presets** apply an offset and angle together and update both readouts. Provide three geometric starting points per case. Keep the controls available for further adjustment and include a separate reset to the initial plane.
- **Show Plane** toggles the translucent plane overlay independently of the active resection. A **Liver Opacity** control helps users see the plane and tumour through the liver surface. Keep the removed/remaining distinction visible while inspecting the anatomy.
- Offset, angle, presets, removal side, and reset all use the same live measurement workflow. Report voxel-derived results as descriptive measurements for research and education.

## Backend and data processing requirements

The MVP uses offline Python preprocessing and a browser-based TypeScript calculation engine. Static hosting serves the prepared case files, and saved plans live in browser session memory.

| ID | Requirement |
| --- | --- |
| BE-01 | Prepare 3–5 anonymised cases from Medical Segmentation Decathlon Task03 Liver with usable liver and tumour labels. Use the source CT and segmentation during offline preparation. Ship the meshes, masks, and spatial metadata needed by the browser. |
| BE-02 | Generate separate liver and tumour meshes and verify their alignment with the source masks. Package matching assets under a single case identifier. Preserve the affine, voxel spacing, and dimensions needed to interpret the masks in physical space. |
| BE-03 | Accept a plane defined by a point, a normal vector, and a selected removal side. Validate the plane, reject degenerate configurations, and use the same physical coordinate system for rendering and calculations. |
| BE-04 | Calculate volumes from label `1` (liver parenchyma), excluding label `2` (tumour). Use the NIfTI affine to locate voxel centres and calculate physical voxel volume from the absolute determinant of its spatial 3×3 matrix. Classify each parenchyma voxel into exactly one region. Removed and remaining volumes must reconcile with the total, and both percentages use that same total. |
| BE-05 | Recalculate tumour intersection and minimum tumour-to-plane distance when the plane changes. Account for the physical extent of tumour voxels where feasible. |
| BE-06 | Keep the calculation engine independent of the viewer. Refresh results without noticeable delay on the demo device and ensure that only results for the current case and plane are displayed. |
| BE-07 | When the selected plan pair changes, use the existing voxel worker to scan the case mask once. Classify each parenchyma voxel into exactly one of the four comparison regions using both saved planes and the single-plan removal-side and on-plane rules. Calculate physical volume for each region and publish the results only for the active case, release, and selected plan pair. |

## MVP acceptance criteria

- At least one prepared case completes the full demo. The user loads it, inspects the anatomy, adjusts the plane, reviews updated measurements, and saves and compares two plans.
- Applying a preset sets both slider readouts. Moving either slider updates the plane and measurements. Toggling the overlay or changing liver opacity affects only the view.
- Tests verify a cube of known volume, an approximately equal split, a known unequal split, a synthetic sphere, anisotropic voxel spacing, and exclusion of tumour voxels from liver parenchyma volume.
- The interface clearly presents all outputs as experimental geometric and volumetric measurements for research and education.

## 3D plan difference view acceptance criteria

Add the difference view after the core demo meets the MVP acceptance criteria above.

- Identical cuts report zero volume in both exclusive regions. Swapping Plan A and Plan B swaps the two exclusive volumes and highlights.
- On a synthetic case, two complementary cuts with the same FLR highlight opposite halves. The four region volumes add up to the total parenchyma volume and reproduce each plan's removed and remaining volumes.
- If the user changes the case or selected plan pair while calculation is in progress, the view displays measurements only for the new selection.
