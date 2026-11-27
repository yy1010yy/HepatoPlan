"""Resolve an offline case allowlist to paired Task03 Liver source files."""

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
import re


PUBLIC_DIRECTORY = Path(__file__).resolve().parents[2] / "public"
PUBLIC_ID = re.compile(r"[a-z0-9-]+")
SOURCE_STEM = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]*")


class SelectionError(ValueError):
    """A local selection could not be resolved."""


@dataclass(frozen=True)
class CaseSource:
    case_id: str
    ct_path: Path
    label_path: Path


@dataclass(frozen=True)
class ExportSelection:
    release_id: str
    output_dir: Path
    cases: tuple[CaseSource, ...]


def keep_input_private(path: Path, description: str = "Source inputs") -> Path:
    resolved = path.resolve()
    if resolved.is_relative_to(PUBLIC_DIRECTORY.resolve()):
        raise SelectionError(f"{description} must stay outside the public directory: {path}")
    return resolved


def unique_case_ids(entries: list[tuple[str, object]]) -> dict[str, object]:
    cases: dict[str, object] = {}
    for case_id, stem in entries:
        if case_id in cases:
            raise SelectionError(f"Duplicate case ID {case_id!r} in allowlist.")
        cases[case_id] = stem
    return cases


def resolve_source(path: Path, case_id: str, role: str) -> Path:
    try:
        resolved = keep_input_private(path, f"Case {case_id!r}: {role} source")
        if not resolved.is_file():
            raise SelectionError(f"Case {case_id!r}: missing {role} file {path.name!r}.")
        with resolved.open("rb") as source_file:
            if not source_file.read(1):
                raise SelectionError(f"Case {case_id!r}: empty {role} file {path.name!r}.")
    except OSError as error:
        raise SelectionError(f"Case {case_id!r}: cannot read {role} file {path.name!r}.") from error
    return resolved


def resolve_selection(
    dataset_dir: Path, allowlist: Path, release_id: str, output_dir: Path
) -> ExportSelection:
    if not PUBLIC_ID.fullmatch(release_id):
        raise SelectionError(f"Invalid release ID {release_id!r}.")
    dataset_dir = keep_input_private(dataset_dir)
    if not dataset_dir.is_dir():
        raise SelectionError(f"Dataset directory does not exist: {dataset_dir}")

    allowlist = keep_input_private(allowlist)
    try:
        with allowlist.open(encoding="utf-8") as config:
            entries = json.load(config, object_pairs_hook=unique_case_ids)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError) as error:
        raise SelectionError(f"Cannot read allowlist {allowlist}: {error}") from error
    if not isinstance(entries, dict) or not entries:
        raise SelectionError("Allowlist must be a non-empty JSON object mapping case IDs to stems.")

    cases = []
    for case_id, stem in entries.items():
        if not PUBLIC_ID.fullmatch(case_id):
            raise SelectionError(f"Invalid case ID {case_id!r}.")
        if not isinstance(stem, str) or not SOURCE_STEM.fullmatch(stem):
            raise SelectionError(f"Case {case_id!r}: expected a source stem without an extension or path.")
        filename = f"{stem}.nii.gz"
        ct = resolve_source(dataset_dir / "imagesTr" / filename, case_id, "CT")
        labels = resolve_source(dataset_dir / "labelsTr" / filename, case_id, "label")
        cases.append(CaseSource(case_id, ct, labels))

    return ExportSelection(release_id, output_dir.resolve(), tuple(cases))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", type=Path, required=True)
    parser.add_argument("--allowlist", type=Path, required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        selection = resolve_selection(args.dataset_dir, args.allowlist, args.release_id, args.output_dir)
    except (SelectionError, OSError) as error:
        parser.exit(2, f"{parser.prog}: {error}\n")
    print(f"Release {selection.release_id}: paired {len(selection.cases)} case(s).")
    for case in selection.cases:
        print(f"  {case.case_id}")


if __name__ == "__main__":
    main()
