"""Validate and publish a complete versioned case release for static hosting."""

import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from jsonschema import Draft7Validator, ValidationError
import numpy as np

from .case_selection import PUBLIC_DIRECTORY, ExportSelection, SelectionError, resolve_selection
from .label_export import METADATA_SCHEMA, case_metadata, read_unit_overrides, write_case_assets
from .mesh_export import write_case_meshes
from .nifti_case import CaseValidationError, CroppedCase, crop_case, validate_case


INDEX_SCHEMA = METADATA_SCHEMA.with_name("case-index.schema.json")
ATTRIBUTION = """HepatoPlan derived case assets

Source dataset: Medical Segmentation Decathlon, Task03 Liver.
Dataset: https://registry.opendata.aws/msd/
Citation: Antonelli, M., Reinke, A., Bakas, S. et al. The Medical Segmentation
Decathlon. Nature Communications 13, 4128 (2022).
https://doi.org/10.1038/s41467-022-30695-9

Source and derived dataset assets: CC BY-SA 4.0.
https://creativecommons.org/licenses/by-sa/4.0/

HepatoPlan cropped the original segmentation labels, exported them as raw
unsigned bytes, converted the spatial metadata to millimetres, and generated
binary STL meshes of the liver envelope and tumour. Source CTs, NIfTI headers,
and the local case mapping are excluded from this release.
"""


def verify_case_assets(
    case_dir: Path, release_id: str, case_id: str, cropped: CroppedCase,
    source_labels: np.ndarray, validator: Draft7Validator,
) -> None:
    metadata = json.loads((case_dir / "metadata.json").read_text(encoding="utf-8"))
    validator.validate(metadata)
    if metadata != case_metadata(release_id, case_id, cropped):
        raise ValueError("Staged metadata differs from the cropped case.")
    labels = np.fromfile(case_dir / "labels.bin", dtype=np.uint8)
    if not np.array_equal(labels, cropped.labels.ravel(order="C")):
        raise ValueError("Staged mask bytes differ from the cropped labels.")
    for label, field in ((1, "parenchyma"), (2, "tumour")):
        if metadata["labelCounts"][field] != np.count_nonzero(source_labels == label):
            raise ValueError(f"Staged {field} label count differs from the source.")


def publish_release(
    selection: ExportSelection, overrides: dict[str, dict[str, str]],
) -> Path:
    output = selection.output_dir.resolve()
    releases = output / "releases"
    destination = releases / selection.release_id
    if destination.exists():
        raise SelectionError(f"Published release {selection.release_id!r} already exists. Use a new ID.")

    for case in selection.cases:
        if case.ct_path.resolve().is_relative_to(output) or case.label_path.resolve().is_relative_to(output):
            raise SelectionError(f"Case {case.case_id!r}: source files must stay outside the published directory.")

    metadata_validator = Draft7Validator(json.loads(METADATA_SCHEMA.read_text(encoding="utf-8")))
    index = {
        "schemaVersion": 1,
        "releaseId": selection.release_id,
        "cases": [{"caseId": case.case_id} for case in selection.cases],
    }
    Draft7Validator(json.loads(INDEX_SCHEMA.read_text(encoding="utf-8"))).validate(index)

    # Keep temporary builds out of the static tree and on the publication filesystem.
    public = PUBLIC_DIRECTORY.resolve()
    stage_parent = public.parent if output.is_relative_to(public) else output.parent
    stage_parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=stage_parent) as temp_dir:
        staging = Path(temp_dir)
        staged_release = staging / "release"
        staged_release.mkdir()
        for source in selection.cases:
            units = overrides.get(source.case_id, {})
            validated = validate_case(source, ct_unit=units.get("ct"), label_unit=units.get("label"))
            try:
                cropped = crop_case(validated)
                case_dir = staged_release / source.case_id
                write_case_assets(case_dir, selection.release_id, source.case_id, cropped, metadata_validator)
                write_case_meshes(case_dir, cropped)
                verify_case_assets(
                    case_dir, selection.release_id, source.case_id, cropped,
                    validated.labels, metadata_validator,
                )
            except (OSError, ValueError, ValidationError) as error:
                raise SelectionError(f"Release {selection.release_id!r}, case {source.case_id!r}: {error}") from error

        (staged_release / "ATTRIBUTION.txt").write_text(ATTRIBUTION, encoding="utf-8")
        staged_index = staging / "index.json"
        staged_index.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")

        releases.mkdir(parents=True, exist_ok=True)
        staged_release.rename(destination)
        try:
            staged_index.replace(output / "index.json")
        except OSError:
            destination.rename(staged_release)
            raise
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
        private_configs = (args.allowlist, args.unit_overrides)
        if any(path and path.resolve().is_relative_to(selection.output_dir) for path in private_configs):
            raise SelectionError("Source configuration must stay outside the published directory.")
        destination = publish_release(selection, read_unit_overrides(args.unit_overrides, selection))
    except (OSError, SelectionError, CaseValidationError, ValidationError) as error:
        parser.exit(2, f"{parser.prog}: {error}\n")
    print(f"Published {len(selection.cases)} case(s) in {destination}.")


if __name__ == "__main__":
    main()
