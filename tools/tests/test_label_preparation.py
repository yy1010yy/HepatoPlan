import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

import nibabel as nib
import numpy as np

from preprocessing.case_selection import CaseSource, ExportSelection, SelectionError
from preprocessing.label_export import stage_labels
from preprocessing.nifti_case import CaseValidationError, crop_case, validate_case


class LabelPreparationTest(unittest.TestCase):
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
        self.affine = np.array([[-2, .5, 0, 10], [0, 3, 0, 20], [0, 0, 4, -5], [0, 0, 0, 1]])
        self.labels = np.zeros((6, 8, 9), dtype=np.uint8)
        self.labels[1, 2, 3] = self.labels[2, 4, 5] = 1
        self.labels[3, 3, 6] = 2
        self.save(self.source.ct_path, np.zeros_like(self.labels))
        self.save(self.source.label_path, self.labels)
        self.selection = ExportSelection("demo-1", self.root / "out", (self.source,))

    def save(self, path, values, affine=None, unit="mm"):
        image = nib.Nifti1Image(values, self.affine if affine is None else affine)
        image.header.set_xyzt_units(unit)
        nib.save(image, path)

    def test_rejects_4d_or_different_shapes_and_affine(self):
        for labels, affine, message in (
            (self.labels[..., None], self.affine, "three non-empty dimensions"),
            (self.labels[:-1], self.affine, "dimensions differ"),
            (self.labels, self.affine + np.diag([0.01, 0, 0, 0]), "spatially misaligned"),
        ):
            with self.subTest(message=message):
                self.save(self.source.label_path, labels, affine)
                with self.assertRaisesRegex(CaseValidationError, f"Case 'case-001': .*{message}"):
                    validate_case(self.source)

    def test_rejects_singular_and_nonfinite_affines(self):
        for value, message in ((0, "singular"), (np.nan, "non-finite")):
            with self.subTest(message=message):
                image = nib.Nifti1Image(self.labels, None)
                affine = np.eye(4)
                affine[0, 0] = value
                image.header.set_sform(affine, code="scanner")
                image.header.set_xyzt_units("mm")
                nib.save(image, self.source.label_path)
                with self.assertRaisesRegex(CaseValidationError, message):
                    validate_case(self.source)

    def test_checks_labels_before_cast_and_requires_both_foreground_classes(self):
        for value, message in (
            (1.5, "Label values"), (257, "Label values"), (np.nan, "Label values"),
            (0, "Both parenchyma label 1 and tumour label 2"),
        ):
            with self.subTest(value=value):
                labels = self.labels.astype(np.float32)
                labels[3, 3, 6] = value
                self.save(self.source.label_path, labels)
                with self.assertRaisesRegex(CaseValidationError, message):
                    validate_case(self.source)

    def test_rejects_unreadable_nifti(self):
        self.source.ct_path.write_bytes(b"not a NIfTI")
        with self.assertRaisesRegex(CaseValidationError, "Cannot read CT NIfTI"):
            validate_case(self.source)

    def test_normalizes_mixed_units_and_requires_verified_override(self):
        metres = self.affine.copy()
        metres[:3] /= 1000
        self.save(self.source.ct_path, self.labels, metres, unit="meter")
        np.testing.assert_array_equal(validate_case(self.source).voxel_to_world_mm, self.affine)
        self.save(self.source.label_path, self.labels, unit="unknown")
        with self.assertRaisesRegex(CaseValidationError, "spatial unit is missing"):
            validate_case(self.source)
        np.testing.assert_array_equal(
            validate_case(self.source, label_unit="mm").voxel_to_world_mm, self.affine
        )

    def test_crop_preserves_labels_and_physical_positions(self):
        cropped = crop_case(validate_case(self.source))
        self.assertEqual(cropped.crop_origin, (1, 2, 3))
        np.testing.assert_array_equal(cropped.labels, self.labels[1:4, 2:5, 3:7])
        local = np.array([[0, 0, 0], [1, 2, 2], [2, 1, 3]])
        np.testing.assert_allclose(
            nib.affines.apply_affine(cropped.voxel_to_world_mm, local),
            nib.affines.apply_affine(self.affine, local + cropped.crop_origin),
        )
        np.testing.assert_allclose(cropped.voxel_spacing_mm, [2, np.sqrt(9.25), 4])

    def test_cli_writes_versioned_mask_and_metadata(self):
        allowlist = self.root / "selection.json"
        allowlist.write_text('{"case-001":"liver_1"}', encoding="utf-8")
        overrides = self.root / "verified-units.json"
        overrides.write_text('{"case-001":{"label":"mm"}}', encoding="utf-8")
        self.save(self.source.label_path, self.labels, unit="unknown")
        subprocess.run(
            [sys.executable, "-m", "preprocessing.label_export",
             "--dataset-dir", str(self.dataset), "--allowlist", str(allowlist),
             "--release-id", "demo-1", "--output-dir", str(self.selection.output_dir),
             "--unit-overrides", str(overrides)],
            check=True, capture_output=True, text=True,
        )
        case_dir = self.selection.output_dir / "releases/demo-1/case-001"
        mask = (case_dir / "labels.bin").read_bytes()
        metadata = json.loads((case_dir / "metadata.json").read_text(encoding="utf-8"))
        self.assertEqual(set(p.name for p in case_dir.iterdir()), {"labels.bin", "metadata.json"})
        self.assertEqual(len(mask), 36)
        self.assertEqual([(i, value) for i, value in enumerate(mask) if value], [(0, 1), (22, 1), (31, 2)])
        self.assertEqual(metadata["dimensions"], [3, 3, 4])
        self.assertEqual(metadata["labelCounts"], {"parenchyma": 2, "tumour": 1})
        self.assertEqual((metadata["schemaVersion"], metadata["releaseId"], metadata["caseId"]),
                         (1, "demo-1", "case-001"))
        np.testing.assert_allclose(metadata["voxelSpacingMm"], [2, np.sqrt(9.25), 4])
        expected = self.affine.copy()
        expected[:3, 3] = [9, 26, 7]
        np.testing.assert_array_equal(metadata["voxelToWorldMm"], expected)
        with self.assertRaisesRegex(SelectionError, "already exists"):
            stage_labels(self.selection, {})

    def test_failed_case_does_not_leave_a_partial_release(self):
        other = CaseSource("case-002", self.source.ct_path, self.root / "missing.nii.gz")
        selection = ExportSelection("demo-1", self.selection.output_dir, (self.source, other))
        with self.assertRaisesRegex(CaseValidationError, "Case 'case-002'"):
            stage_labels(selection, {})
        self.assertEqual(list((selection.output_dir / "releases").iterdir()), [])
