import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from preprocessing.case_selection import SelectionError, resolve_selection


class CaseSelectionTest(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(TemporaryDirectory())
        self.root = Path(directory)
        self.public = self.root / "public"
        self.public.mkdir()
        self.enterContext(patch("preprocessing.case_selection.PUBLIC_DIRECTORY", self.public))
        self.dataset = self.root / "Task03_Liver"
        self.allowlist = self.root / "selection.json"
        self.output = self.public / "cases"
        self.ct = self.dataset / "imagesTr" / "liver_10.nii.gz"
        self.labels = self.dataset / "labelsTr" / "liver_10.nii.gz"
        for path in (self.ct, self.labels):
            path.parent.mkdir(parents=True)
            path.write_bytes(b"synthetic")
        self.allowlist.write_text(json.dumps({"case-010": "liver_10"}), encoding="utf-8")

    def resolve(self, release_id="demo-1"):
        return resolve_selection(self.dataset, self.allowlist, release_id, self.output)

    def test_pairs_the_same_stem_without_creating_output(self):
        selection = self.resolve()
        self.assertEqual(selection.release_id, "demo-1")
        self.assertEqual(selection.output_dir, self.output.resolve())
        self.assertEqual(len(selection.cases), 1)
        case = selection.cases[0]
        self.assertEqual(case.case_id, "case-010")
        self.assertEqual(case.ct_path, self.ct.resolve())
        self.assertEqual(case.label_path, self.labels.resolve())
        self.assertFalse(self.output.exists())

    def test_rejects_bad_allowlist_entries_with_case_context(self):
        for config, message in (
            ('{"case-010":"liver_10","case-010":"liver_11"}', "Duplicate case ID 'case-010'"),
            ('{"Case-010":"liver_10"}', "Invalid case ID 'Case-010'"),
            ('{"case-010":"../liver_10"}', "Case 'case-010': expected a source stem"),
            ('{"case-010":"liver_10.nii.gz"}', "Case 'case-010': expected a source stem"),
            ('{}', "non-empty JSON object"),
            ('{', "Cannot read allowlist"),
        ):
            with self.subTest(config=config):
                self.allowlist.write_text(config, encoding="utf-8")
                with self.assertRaisesRegex(SelectionError, message):
                    self.resolve()

    def test_rejects_invalid_release_ids(self):
        with self.assertRaisesRegex(SelectionError, "Invalid release ID"):
            self.resolve("demo-1\n")

    def test_reports_missing_label_even_if_another_case_has_labels(self):
        self.labels.rename(self.labels.with_name("liver_11.nii.gz"))
        with self.assertRaisesRegex(SelectionError, "Case 'case-010': missing label"):
            self.resolve()

    def test_reports_unreadable_ct(self):
        with patch.object(Path, "open", autospec=True, side_effect=self.deny_ct_read()):
            with self.assertRaisesRegex(SelectionError, "Case 'case-010': cannot read CT"):
                self.resolve()

    def deny_ct_read(self):
        original_open = Path.open

        def open_fixture(path, *args, **kwargs):
            if path == self.ct.resolve():
                raise PermissionError("test denies CT access")
            return original_open(path, *args, **kwargs)

        return open_fixture

    def test_refuses_allowlist_inside_public(self):
        self.allowlist = self.allowlist.rename(self.public / self.allowlist.name)
        with self.assertRaisesRegex(SelectionError, "outside the public directory"):
            self.resolve()
