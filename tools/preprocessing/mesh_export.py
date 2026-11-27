"""Extract and verify binary STL surfaces in the cropped mask's physical frame."""

from pathlib import Path
from struct import unpack
from typing import Iterator

import nibabel as nib
import numpy as np
from skimage.measure import marching_cubes
import trimesh
from trimesh.exchange.stl import export_stl

from .nifti_case import CroppedCase


def mesh_masks(labels: np.ndarray) -> Iterator[tuple[str, np.ndarray]]:
    yield "liver.stl", labels != 0
    yield "tumour.stl", labels == 2


def make_surface(mask: np.ndarray, affine: np.ndarray) -> trimesh.Trimesh:
    vertices, faces, _, _ = marching_cubes(
        np.pad(mask, 1), level=0.5, gradient_direction="ascent", allow_degenerate=False
    )
    world_vertices = nib.affines.apply_affine(affine, vertices.astype(np.float64) - 1)
    if np.linalg.det(affine[:3, :3]) < 0:
        faces = faces[:, ::-1]
    return trimesh.Trimesh(vertices=world_vertices, faces=faces, process=False)


def verify_stl(
    path: Path, expected: trimesh.Trimesh, mask: np.ndarray, affine: np.ndarray
) -> None:
    with path.open("rb") as stl:
        header = stl.read(84)
    if len(header) != 84:
        raise ValueError(f"{path.name} has a truncated binary STL header.")
    face_count = unpack("<I", header[80:])[0]
    if face_count == 0 or path.stat().st_size != 84 + 50 * face_count:
        raise ValueError(f"{path.name} has an invalid binary STL triangle count or length.")

    mesh = trimesh.load_mesh(path, file_type="stl", process=False)
    if len(mesh.faces) != face_count or not np.isfinite(mesh.vertices).all():
        raise ValueError(f"{path.name} does not contain finite triangle geometry.")
    if not np.array_equal(mesh.triangles, expected.triangles.astype("<f4")):
        raise ValueError(f"{path.name} triangles differ from the exported surface.")

    voxel_vertices = nib.affines.apply_affine(np.linalg.inv(affine), mesh.vertices)
    for axis in range(3):
        other_axes = tuple(index for index in range(3) if index != axis)
        occupied = np.flatnonzero(np.any(mask, axis=other_axes))
        expected_bounds = [occupied[0] - 0.5, occupied[-1] + 0.5]
        bounds = [voxel_vertices[:, axis].min(), voxel_vertices[:, axis].max()]
        if not np.allclose(bounds, expected_bounds, rtol=0, atol=1e-3):
            raise ValueError(f"{path.name} does not align with mask axis {axis}.")


def write_case_meshes(case_dir: Path, case: CroppedCase) -> None:
    for filename, mask in mesh_masks(case.labels):
        mesh = make_surface(mask, case.voxel_to_world_mm)
        path = case_dir / filename
        path.write_bytes(export_stl(mesh))
        verify_stl(path, mesh, mask, case.voxel_to_world_mm)
