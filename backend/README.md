# HepatoPlan backend

Use Python 3.12 or newer and Node.js 24.12 or newer. Run setup and checks from `backend/`. The Windows commands below use a project-local virtual environment.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm ci
.\.venv\Scripts\python.exe -m unittest discover -s tests
npm run typecheck
npm test
```

Use the path to a Python 3.12 executable directly for the first command if your installation uses a different launcher. On macOS or Linux use `python3.12 -m venv .venv` and replace the Windows virtual-environment executable with `.venv/bin/python`.

## Static preview

Serve the public directory from `backend/` and open `http://127.0.0.1:8000/cases/index.json`.

```powershell
.\.venv\Scripts\python.exe -m http.server 8000 --bind 127.0.0.1 --directory ../public
```

The development index starts with an empty case list. The format fixtures live under `backend/fixtures/` and exercise the JSON contract using synthetic metadata.

## Version 1 case contract

The two JSON Schemas under `contracts/` define the index and case metadata. Python and TypeScript tests read the same sample files. TypeScript consumers can import `CaseIndex` and `CaseMetadata` from `src/case-contract.ts`.

- The public index is `public/cases/index.json`. Resolve each case's `releases/<releaseId>/<caseId>/` path relative to the index URL. Each case has `metadata.json`, `labels.bin`, `liver.stl`, and `tumour.stl`. Use lowercase ASCII letters, digits, and hyphens in release and case IDs.
- `labels.bin` contains exactly `nx * ny * nz` bytes as a headerless unsigned 8-bit array in C order. The byte offset for voxel `(i, j, k)` is `(i * ny + j) * nz + k`. Values are 0 for background, 1 for parenchyma, and 2 for tumour.
- `voxelToWorldMm` is a row-major matrix represented as four arrays of four numbers. It maps integer voxel centres to the case's NIfTI RAS+ coordinates in millimetres. `voxelSpacingMm` holds the lengths of the three spatial columns. The affine defines position and physical volume.
- Both binary STL meshes use the same physical frame in millimetres. The preview serves the public index and case assets as static files.

The schemas validate the JSON structure. The exporter and loader tasks in the tracker cover asset integrity and alignment checks.

## Check an offline case selection

For a real demo release, use the extracted [Medical Segmentation Decathlon Task03 Liver dataset](https://medicaldecathlon.com/dataaws/) with its `imagesTr/` and `labelsTr/` directories. Keep the dataset and allowlist outside `public/`. One local option is `backend/.local/`, which Git ignores.

Create a local `selection.json` mapping public case IDs to source filename stems, for example `{"case-001": "liver_10"}`. This entry pairs `imagesTr/liver_10.nii.gz` with `labelsTr/liver_10.nii.gz`. Run the check from `backend/`.

```powershell
.\.venv\Scripts\python.exe -m preprocessing.case_selection --dataset-dir .local/Task03_Liver --allowlist .local/selection.json --release-id demo-1 --output-dir ../public/cases
```

The command checks the IDs and whether both files for each entry can be read. It prints public case IDs and leaves the output directory untouched. Synthetic selection tests run with the standard Python test command above.
