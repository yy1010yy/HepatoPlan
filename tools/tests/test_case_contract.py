import json
import unittest
from pathlib import Path

from jsonschema import Draft7Validator


REPO_ROOT = Path(__file__).resolve().parents[2]


def read_json(relative_path: str):
    return json.loads((REPO_ROOT / relative_path).read_text(encoding="utf-8"))


class CaseContractTest(unittest.TestCase):
    def test_shared_index_and_metadata_fixture(self):
        index = read_json("fixtures/cases/index.json")
        Draft7Validator(read_json("contracts/case-index.schema.json")).validate(index)
        self.assertEqual(len(index["cases"]), 1)
        release_id = index["releaseId"]
        case_id = index["cases"][0]["caseId"]
        metadata = read_json(
            f"fixtures/cases/releases/{release_id}/{case_id}/metadata.json"
        )
        validator = Draft7Validator(read_json("contracts/case-metadata.schema.json"))
        validator.validate(metadata)
        self.assertEqual((metadata["releaseId"], metadata["caseId"]), (release_id, case_id))
        self.assertEqual(metadata["dimensions"], [3, 4, 5])
        self.assertEqual(metadata["voxelToWorldMm"][0], [-2, 0, 0, 10])

        bad_metadata = {**metadata, "dimensions": [3, 0, 5]}
        self.assertFalse(validator.is_valid(bad_metadata))
        bad_metadata = {**metadata, "voxelToWorldMm": [1] * 16}
        self.assertFalse(validator.is_valid(bad_metadata))

    def test_preprocessing_dependencies_import(self):
        import nibabel
        import numpy
        import skimage
        import trimesh

        for package in (nibabel, numpy, skimage, trimesh):
            self.assertTrue(package.__version__)
