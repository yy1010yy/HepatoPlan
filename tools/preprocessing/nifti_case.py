"""Validate a paired NIfTI case and crop its labels without resampling."""

from dataclasses import dataclass
from itertools import product
from pathlib import Path
import zlib

import nibabel as nib
import numpy as np

from .case_selection import CaseSource


UNIT_TO_MM = {"meter": 1000.0, "mm": 1.0, "micron": 0.001}
ALIGNMENT_TOLERANCE_MM = 1e-3


class CaseValidationError(ValueError):
    """The source pair cannot be used for volumetry."""


@dataclass(frozen=True)
class ValidatedCase:
    labels: np.ndarray
    voxel_to_world_mm: np.ndarray


@dataclass(frozen=True)
class CroppedCase:
    labels: np.ndarray
    voxel_to_world_mm: np.ndarray
    crop_origin: tuple[int, int, int]
    voxel_spacing_mm: tuple[float, float, float]


def load_image(path: Path, role: str) -> nib.Nifti1Image | nib.Nifti2Image:
    try:
        image = nib.load(path)
    except (OSError, ValueError, nib.filebasedimages.ImageFileError,
            nib.spatialimages.HeaderDataError, EOFError, zlib.error) as error:
        raise CaseValidationError(f"Cannot read {role} NIfTI: {error}") from error
    if not isinstance(image, (nib.Nifti1Image, nib.Nifti2Image)):
        raise CaseValidationError(f"{role} must be a NIfTI image.")
    if len(image.shape) != 3 or any(size < 1 for size in image.shape):
        raise CaseValidationError(f"{role} must have three non-empty dimensions.")
    return image


def affine_in_mm(
    image: nib.Nifti1Image | nib.Nifti2Image, role: str, missing_unit: str | None
) -> np.ndarray:
    if missing_unit is not None and missing_unit not in UNIT_TO_MM:
        raise CaseValidationError(f"Invalid verified spatial unit {missing_unit!r} for {role}.")
    try:
        units = image.header.get_xyzt_units()[0]
    except KeyError as error:
        raise CaseValidationError(f"{role} has an unsupported spatial unit code.") from error
    if units == "unknown":
        units = missing_unit
    if units not in UNIT_TO_MM:
        raise CaseValidationError(f"{role} spatial unit is missing or unsupported.")

    affine = np.array(image.affine, dtype=np.float64, copy=True)
    affine[:3] *= UNIT_TO_MM[units]
    if not np.isfinite(affine).all():
        raise CaseValidationError(f"{role} affine contains non-finite values.")
    determinant = np.linalg.det(affine[:3, :3])
    if not np.isfinite(determinant) or determinant == 0:
        raise CaseValidationError(f"{role} affine is singular or invalid.")
    return affine


def validate_case(
    source: CaseSource, *, ct_unit: str | None = None, label_unit: str | None = None
) -> ValidatedCase:
    try:
        ct = load_image(source.ct_path, "CT")
        labels = load_image(source.label_path, "Label map")
        if ct.shape != labels.shape:
            raise CaseValidationError(f"CT and label dimensions differ: {ct.shape} and {labels.shape}.")
        ct_affine = affine_in_mm(ct, "CT", ct_unit)
        label_affine = affine_in_mm(labels, "Label map", label_unit)

        # For affine grids, a displacement bound at the corners also bounds the interior.
        corners = list(product(*((0, size - 1) for size in ct.shape)))
        differences = (
            nib.affines.apply_affine(ct_affine, corners)
            - nib.affines.apply_affine(label_affine, corners)
        )
        if np.any(np.linalg.norm(differences, axis=1) > ALIGNMENT_TOLERANCE_MM):
            raise CaseValidationError("CT and label grids are spatially misaligned.")

        try:
            # Check the CT payload endpoint without allocating the full intensity volume.
            ct.dataobj[-1, -1, -1]
        except (OSError, ValueError, EOFError, zlib.error) as error:
            raise CaseValidationError(f"Cannot read CT voxel data: {error}") from error
        try:
            label_values = np.asanyarray(labels.dataobj)
        except (OSError, ValueError, EOFError, zlib.error) as error:
            raise CaseValidationError(f"Cannot read label voxel data: {error}") from error
        if np.iscomplexobj(label_values) or not np.isin(label_values, (0, 1, 2)).all():
            raise CaseValidationError("Label values must be 0, 1, or 2.")
        if not (np.any(label_values == 1) and np.any(label_values == 2)):
            raise CaseValidationError("Both parenchyma label 1 and tumour label 2 are required.")

        return ValidatedCase(label_values.astype(np.uint8, copy=False), label_affine)
    except CaseValidationError as error:
        raise CaseValidationError(f"Case {source.case_id!r}: {error}") from error


def crop_case(case: ValidatedCase) -> CroppedCase:
    bounds = []
    for axis in range(3):
        other_axes = tuple(index for index in range(3) if index != axis)
        foreground = np.flatnonzero(np.any(case.labels, axis=other_axes))
        bounds.append(slice(int(foreground[0]), int(foreground[-1]) + 1))

    x, y, z = (bound.start for bound in bounds)
    origin = (x, y, z)
    affine = case.voxel_to_world_mm.copy()
    affine[:3, 3] = nib.affines.apply_affine(case.voxel_to_world_mm, origin)
    sx, sy, sz = np.linalg.norm(affine[:3, :3], axis=0)
    return CroppedCase(
        case.labels[tuple(bounds)].copy(order="C"), affine, origin,
        (float(sx), float(sy), float(sz)),
    )
