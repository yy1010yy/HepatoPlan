import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import nibabel as nib
import numpy as np
import trimesh

from preprocessing.case_selection import CaseSource, ExportSelection, SelectionError
from preprocessing.nifti_case import CaseValidationError
from preprocessing.release_export import publish_release


class ReleaseExportTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(TemporaryDirectory()))
        self.dataset = self.root / "Task03_Liver"
        self.source = CaseSource(
            "case-001",
            self.dataset / "imagesTr/liver_1.nii.gz",
            self.dataset / "labelsTr/liver_1.nii.gz",
        )
        self.source.ct_path.parent.mkdir(parents=True)
        self.source.label_path.parent.mkdir(parents=True)
        self.affine = np.array([[0, -3, 0, 10], [-2, 0, 0, 20], [0, 0, 4, -5], [0, 0, 0, 1]])
        self.labels = np.zeros((8, 9, 10), dtype=np.uint8)
        self.labels[2:5, 3:7, 4:9] = 1
        self.labels[3, 4, 6] = 2
        self.labels[4, 6, 8] = 2
        self.save(self.source.ct_path, np.zeros_like(self.labels))
        self.save(self.source.label_path, self.labels)
        self.output = self.root / "public/cases"
        self.selection = ExportSelection("demo-1", self.output, (self.source,))

    def save(self, path, values, affine=None):
        image = nib.Nifti1Image(values, self.affine if affine is None else affine)
        image.header.set_xyzt_units("mm")
        nib.save(image, path)

    def test_cli_publishes_aligned_meshes_and_public_only_assets(self):
        allowlist = self.root / "selection.json"
        allowlist.write_text('{"case-001":"liver_1"}', encoding="utf-8")
        subprocess.run(
            [sys.executable, "-m", "preprocessing.release_export",
             "--dataset-dir", str(self.dataset), "--allowlist", str(allowlist),
             "--release-id", "demo-1", "--output-dir", str(self.output)],
            check=True, capture_output=True, text=True,
        )
        expected_index = {"schemaVersion": 1, "releaseId": "demo-1", "cases": [{"caseId": "case-001"}]}
        self.assertEqual(json.loads((self.output / "index.json").read_text()), expected_index)

        release = self.output / "releases/demo-1"
        case_dir = release / "case-001"
        metadata = json.loads((case_dir / "metadata.json").read_text())
        self.assertEqual(metadata["dimensions"], [3, 4, 5])
        self.assertEqual(metadata["labelCounts"], {"parenchyma": 58, "tumour": 2})
        self.assertEqual(metadata["voxelToWorldMm"], [[0, -3, 0, 1], [-2, 0, 0, 16], [0, 0, 4, 11], [0, 0, 0, 1]])
        mask = (case_dir / "labels.bin").read_bytes()
        self.assertEqual(len(mask), 60)
        self.assertEqual([i for i, label in enumerate(mask) if label == 2], [27, 59])

        # An isolated tumour voxel has six vertices, half a voxel from its centre.
        # Compute their world coordinates independently of the exporter transform.
        tumour = trimesh.load_mesh(case_dir / "tumour.stl")
        self.assertEqual(len(tumour.vertices), 12)
        offsets = [(1.5, 0, 0), (0, 1, 0), (0, 0, 2)]
        expected = {
            tuple(np.array(centre) + sign * np.array(offset))
            for centre in ((-2, 14, 19), (-8, 12, 27))
            for offset in offsets for sign in (-1, 1)
        }
        self.assertEqual(set(map(tuple, tumour.vertices)), expected)
        self.assertTrue(tumour.is_volume)

        liver = trimesh.load_mesh(case_dir / "liver.stl")
        self.assertTrue(liver.is_volume)
        np.testing.assert_allclose(liver.bounds, [[-9.5, 11, 9], [2.5, 17, 29]])
        # The liver envelope includes label 2. An internal tumour creates no cavity.
        self.assertEqual(len(liver.split()), 1)
        filenames = {path.relative_to(self.output).as_posix()
                     for path in self.output.rglob("*") if path.is_file()}
        self.assertEqual(filenames, {"index.json", "releases/demo-1/ATTRIBUTION.txt",
                         *(f"releases/demo-1/case-001/{name}"
                           for name in ("liver.stl", "tumour.stl", "labels.bin", "metadata.json"))})
        attribution = (release / "ATTRIBUTION.txt").read_text()
        self.assertIn("CC BY-SA 4.0", attribution)
        self.assertIn("10.1038/s41467-022-30695-9", attribution)

    def test_failed_release_leaves_the_previous_release_usable(self):
        first = publish_release(self.selection, {})
        index = self.output / "index.json"
        original_index = index.read_bytes()
        original_mesh = (first / "case-001/liver.stl").read_bytes()
        next_selection = ExportSelection("demo-2", self.output, (self.source,))
        displaced = self.affine.copy()
        displaced[0, 3] += 1
        self.save(self.source.label_path, self.labels, displaced)
        with self.assertRaisesRegex(CaseValidationError, "spatially misaligned"):
            publish_release(next_selection, {})

        without_tumour = np.where(self.labels == 2, 0, self.labels).astype(np.uint8)
        self.save(self.source.label_path, without_tumour)
        with self.assertRaisesRegex(CaseValidationError, "Both parenchyma label 1 and tumour label 2"):
            publish_release(next_selection, {})

        self.save(self.source.label_path, self.labels)
        with patch("preprocessing.mesh_export.export_stl", return_value=original_mesh[:-1]):
            with self.assertRaisesRegex(SelectionError, "binary STL triangle count or length"):
                publish_release(next_selection, {})

        with patch.object(Path, "replace", side_effect=PermissionError("Index swap blocked")):
            with self.assertRaisesRegex(PermissionError, "Index swap blocked"):
                publish_release(next_selection, {})

        self.assertEqual(index.read_bytes(), original_index)
        self.assertEqual((first / "case-001/liver.stl").read_bytes(), original_mesh)
        self.assertFalse((self.output / "releases/demo-2").exists())

        with self.assertRaisesRegex(SelectionError, "already exists"):
            publish_release(self.selection, {})
        second = publish_release(next_selection, {})
        self.assertEqual(json.loads(index.read_text())["releaseId"], "demo-2")
        self.assertTrue((second / "case-001/tumour.stl").is_file())
        self.assertEqual((first / "case-001/liver.stl").read_bytes(), original_mesh)
