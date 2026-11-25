"""Stage validated label buffers and metadata for a future case release."""

import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from jsonschema import Draft7Validator

from .case_selection import ExportSelection, SelectionError, keep_input_private, resolve_selection
from .nifti_case import UNIT_TO_MM, CaseValidationError, CroppedCase, crop_case, validate_case


METADATA_SCHEMA = Path(__file__).resolve().parents[1] / "contracts/case-metadata.schema.json"


def read_unit_overrides(path: Path | None, selection: ExportSelection) -> dict[str, dict[str, str]]:
    if path is None:
        return {}
    path = keep_input_private(path, "Unit override configuration")
    try:
        overrides = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise SelectionError(f"Cannot read unit override configuration: {error}") from error
    if not isinstance(overrides, dict):
        raise SelectionError("Unit overrides must map case IDs to CT or label units.")
    selected_ids = {case.case_id for case in selection.cases}
    for case_id, units in overrides.items():
        if case_id not in selected_ids or not isinstance(units, dict):
            raise SelectionError(f"Invalid unit override entry for case {case_id!r}.")
        for role, unit in units.items():
            if role not in ("ct", "label") or not isinstance(unit, str) or unit not in UNIT_TO_MM:
                raise SelectionError(f"Invalid {role!r} unit override for case {case_id!r}.")
    return overrides


def write_case_assets(
    case_dir: Path, release_id: str, case_id: str, case: CroppedCase, validator: Draft7Validator
) -> None:
    metadata = {
        "schemaVersion": 1,
        "releaseId": release_id,
        "caseId": case_id,
        "dimensions": list(case.labels.shape),
        "voxelSpacingMm": list(case.voxel_spacing_mm),
        "voxelToWorldMm": case.voxel_to_world_mm.tolist(),
        "labelCounts": {
            "parenchyma": int(np.count_nonzero(case.labels == 1)),
            "tumour": int(np.count_nonzero(case.labels == 2)),
        },
    }
    validator.validate(metadata)
    case_dir.mkdir()
    # tofile writes in C order regardless of the array's native layout.
    with (case_dir / "labels.bin").open("wb") as label_file:
        case.labels.tofile(label_file)
    (case_dir / "metadata.json").write_text(
        json.dumps(metadata, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )


def stage_labels(selection: ExportSelection, overrides: dict[str, dict[str, str]]) -> Path:
    releases = keep_input_private(selection.output_dir / "releases", "Label staging directory")
    destination = releases / selection.release_id
    if destination.exists():
        raise SelectionError(f"Staged release {selection.release_id!r} already exists.")
    validator = Draft7Validator(json.loads(METADATA_SCHEMA.read_text(encoding="utf-8")))
    releases.mkdir(parents=True, exist_ok=True)

    with TemporaryDirectory(dir=releases) as temp_dir:
        staged = Path(temp_dir) / "release"
        staged.mkdir()
        for source in selection.cases:
            units = overrides.get(source.case_id, {})
            validated = validate_case(source, ct_unit=units.get("ct"), label_unit=units.get("label"))
            cropped = crop_case(validated)
            write_case_assets(staged / source.case_id, selection.release_id, source.case_id, cropped, validator)
        staged.rename(destination)
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", type=Path, required=True)
    parser.add_argument("--allowlist", type=Path, required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--unit-overrides", type=Path)
    args = parser.parse_args()
    try:
        selection = resolve_selection(args.dataset_dir, args.allowlist, args.release_id, args.output_dir)
        destination = stage_labels(selection, read_unit_overrides(args.unit_overrides, selection))
    except (SelectionError, CaseValidationError, OSError) as error:
        parser.exit(2, f"{parser.prog}: {error}\n")
    print(f"Staged label assets for {len(selection.cases)} case(s) in {destination}.")


if __name__ == "__main__":
    main()
