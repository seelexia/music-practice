"""Mechanism tests using only freshly generated in-memory images and symbols.

These assertions establish inventory/validation behavior, not VLM accuracy.
No reference HTML, existing song, saved recognition job or held-out image is read.
"""
from __future__ import annotations

from copy import deepcopy
from fractions import Fraction
from pathlib import Path
import random
import sys
import unittest

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from guided import derive_rhythm, inventory, validate_region


def event(**changes):
    value = {
        "degree": 4,
        "octave": 1,
        "lyric": "",
        "uncertain": False,
        "rhythm": {"underlines": 1, "dots": 0, "extensions": 0},
        "anchorY": 35,
    }
    value.update(changes)
    return value


def response(events=None, **changes):
    value = {
        "version": 1,
        "classification": "notation",
        "reason": "Printed numbered notes are visible.",
        "uncertain": False,
        "metadata": {"key": None, "bpm": None, "timeSignature": None},
        "text": [],
        "measures": [{"events": [event()] if events is None else events}],
    }
    value.update(changes)
    return value


def region():
    return {
        "id": "synthetic-band-2",
        "owned": [20, 70],
        "display": [0, 10, 120, 75],
        "inkPixels": 100,
        "reason": "Synthetic overlapping display margin.",
    }


class InventoryTests(unittest.TestCase):
    def assert_complete_partition(self, image, result, max_bands):
        width, height = image.size
        self.assertEqual((result["width"], result["height"]), (width, height))
        bands = result["regions"]
        self.assertGreaterEqual(len(bands), 1)
        self.assertLessEqual(len(bands), max_bands)
        self.assertEqual(len({band["id"] for band in bands}), len(bands))
        cursor = 0
        owned_rows = [0] * height
        for band in bands:
            y0, y1 = band["owned"]
            self.assertEqual(y0, cursor)
            self.assertLess(y0, y1)
            self.assertLessEqual(y1, height)
            cursor = y1
            for row in range(y0, y1):
                owned_rows[row] += 1
            x, y, display_width, display_height = band["display"]
            self.assertEqual(x, 0)
            self.assertEqual(display_width, width)
            self.assertGreaterEqual(y, 0)
            self.assertLessEqual(y, y0)
            self.assertGreaterEqual(y + display_height, y1)
            self.assertLessEqual(y + display_height, height)
            self.assertGreater(display_height, 0)
            self.assertIsInstance(band["inkPixels"], int)
            self.assertGreaterEqual(band["inkPixels"], 0)
            self.assertTrue(band["reason"])
        self.assertEqual(cursor, height)
        self.assertEqual(owned_rows, [1] * height)

    def test_blank_and_solid_pages_have_complete_owned_inventory(self):
        for mode, size, color in [
            ("RGB", (317, 911), "white"),
            ("L", (1, 1), 255),
            ("L", (71, 149), 0),
            ("RGB", (1031, 43), "black"),
        ]:
            with self.subTest(mode=mode, size=size, color=color):
                image = Image.new(mode, size, color)
                result = inventory(image, max_bands=9)
                self.assert_complete_partition(image, result, 9)
                expected_ink = size[0] * size[1] if color in ("black", 0) else 0
                self.assertEqual(sum(band["inkPixels"] for band in result["regions"]), expected_ink)

    def test_noise_and_edge_marks_are_counted_once_in_owned_pixels(self):
        rng = random.Random(97851)
        image = Image.new("L", (173, 641), 255)
        pixels = {(0, 0), (172, 0), (0, 640), (172, 640)}
        pixels.update((rng.randrange(image.width), rng.randrange(image.height)) for _ in range(900))
        for point in pixels:
            image.putpixel(point, 0)
        result = inventory(image, max_bands=7)
        self.assert_complete_partition(image, result, 7)
        self.assertEqual(sum(band["inkPixels"] for band in result["regions"]), len(pixels))

    def test_varied_fonts_scales_and_layouts_keep_every_row_owned(self):
        rng = random.Random(20261029)
        font_names = ["arial.ttf", "times.ttf", "consola.ttf"]
        for case in range(24):
            width, height = rng.randrange(90, 950), rng.randrange(130, 1300)
            image = Image.new("RGB", (width, height), "white")
            draw = ImageDraw.Draw(image)
            font_path = Path("C:/Windows/Fonts") / font_names[case % len(font_names)]
            size = rng.randrange(9, 43)
            font = ImageFont.truetype(str(font_path), size) if font_path.exists() else ImageFont.load_default()
            cursor = rng.randrange(0, 25)
            while cursor < height:
                draw.text((rng.randrange(0, max(1, width // 4)), cursor), "1 3 0 6 2   varied text", font=font, fill="black")
                if rng.randrange(2):
                    draw.line((3, min(height - 1, cursor + size), width - 2, min(height - 1, cursor + size)), fill="black")
                cursor += size + rng.randrange(1, max(2, size * 3))
            max_bands = 1 + case % 11
            with self.subTest(case=case, size=image.size, font=font_names[case % len(font_names)]):
                self.assert_complete_partition(image, inventory(image, max_bands=max_bands), max_bands)

    def test_partition_is_deterministic_and_does_not_mutate_source_image(self):
        image = Image.new("RGB", (233, 557), "white")
        draw = ImageDraw.Draw(image)
        for top, bottom in [(0, 8), (46, 62), (103, 151), (274, 310), (551, 556)]:
            draw.rectangle((3, top, 229, bottom), fill="black")
        original = image.tobytes()
        first = inventory(image, max_bands=6)
        self.assertEqual(first, inventory(image.copy(), max_bands=6))
        self.assertEqual(image.tobytes(), original)
        self.assert_complete_partition(image, first, 6)


class RhythmTests(unittest.TestCase):
    def test_exact_fractions_match_independently_hand_calculated_symbols(self):
        cases = [
            ({"underlines": 0, "dots": 0, "extensions": 0}, Fraction(1, 1)),
            ({"underlines": 1, "dots": 1, "extensions": 0}, Fraction(3, 4)),
            ({"underlines": 2, "dots": 2, "extensions": 1, "tuplet": [3, 2]}, Fraction(31, 24)),
            ({"underlines": 5, "dots": 3, "extensions": 0, "tuplet": [7, 4]}, Fraction(15, 448)),
            ({"underlines": 0, "dots": 3, "extensions": 64}, Fraction(527, 8)),
            ({"underlines": 2, "dots": 0, "extensions": 0, "tuplet": [5, 4]}, Fraction(1, 5)),
        ]
        for symbols, expected in cases:
            with self.subTest(symbols=symbols):
                actual = derive_rhythm(symbols)
                self.assertIsInstance(actual, Fraction)
                self.assertEqual(actual, expected)

    def test_malformed_counts_tuplets_and_calculated_fields_are_rejected(self):
        baseline = {"underlines": 1, "dots": 0, "extensions": 0}
        invalid = [
            {},
            dict(baseline, underlines=-1),
            dict(baseline, underlines=6),
            dict(baseline, underlines=True),
            dict(baseline, dots=4),
            dict(baseline, extensions=65),
            dict(baseline, extensions=0.5),
            dict(baseline, tuplet=[0, 2]),
            dict(baseline, tuplet=[3, 17]),
            dict(baseline, tuplet=[3]),
            dict(baseline, tuplet=[3, 2, 1]),
            dict(baseline, duration=[4, 1]),
            dict(baseline, command="inert but unsupported"),
        ]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                derive_rhythm(value)


class ObservationValidationTests(unittest.TestCase):
    def test_valid_rest_unknown_and_observed_notation_survive_without_input_mutation(self):
        value = response([
            event(degree=0, octave=0, lyric=""),
            event(degree=None, octave=-1, uncertain=True, lyric="?", anchorY=36),
            event(degree=7, octave=-2, accidental=-1, anchorY=37),
        ])
        before = deepcopy(value)
        validated = validate_region(value, region(), 100)
        self.assertEqual(value, before)
        actual = validated["measures"][0]["events"]
        self.assertEqual([entry["degree"] for entry in actual], [0, None, 7])
        self.assertTrue(actual[1]["uncertain"])

    def test_header_and_plain_text_evidence_are_retained(self):
        value = response([], classification="header", metadata={"key": "F#", "bpm": 89, "timeSignature": [5, 8]}, text=["Synthetic title", "unattached lyric line"])
        value["measures"] = []
        validated = validate_region(value, region(), 100)
        self.assertEqual(validated["text"], ["Synthetic title", "unattached lyric line"])
        self.assertEqual(validated["metadata"], {"key": "F#", "bpm": 89, "timeSignature": [5, 8]})
        self.assertEqual(validated["classification"], "header")
        self.assertTrue(validated["reason"])

    def test_outside_owned_but_inside_image_events_are_retained_as_explicit_exclusions(self):
        value = response([event(anchorY=19), event(anchorY=20), event(anchorY=69.5), event(anchorY=70)])
        validated = validate_region(value, region(), 100)
        accepted = [entry for measure in validated["measures"] for entry in measure["events"]]
        self.assertEqual([entry["anchorY"] for entry in accepted], [20, 69.5])
        excluded = validated["excludedBoundaryEvents"]
        self.assertEqual(len(excluded), 2)
        self.assertEqual([entry["event"]["anchorY"] for entry in excluded], [19, 70])
        self.assertEqual([entry["event"]["degree"] for entry in excluded], [4, 4])
        self.assertTrue(all(entry["reason"] for entry in excluded))
        self.assertTrue(validated["uncertain"])

    def test_anchor_beyond_the_image_cannot_be_used_as_plausible_boundary_evidence(self):
        for anchor in [-1, 100, float("inf"), float("nan"), True, "35"]:
            with self.subTest(anchor=anchor), self.assertRaises(ValueError):
                validate_region(response([event(anchorY=anchor)]), region(), 100)

    def test_unreadable_degree_requires_an_explicit_uncertainty_flag(self):
        with self.assertRaises(ValueError):
            validate_region(response([event(degree=None, uncertain=False)]), region(), 100)

    def test_unknown_keys_and_model_calculated_timing_are_rejected_at_each_level(self):
        invalid = []
        value = response()
        value["tool"] = "finish"
        invalid.append(value)
        value = response()
        value["measures"][0]["id"] = "model-owned-id"
        invalid.append(value)
        for key, data in [("duration", [4, 1]), ("beat", 99), ("midi", 127), ("sourcePath", "../../anything")]:
            value = response()
            value["measures"][0]["events"][0][key] = data
            invalid.append(value)
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_region(value, region(), 100)

    def test_invalid_symbol_and_claim_types_are_rejected(self):
        invalid = [
            response(classification="skip"),
            response(reason=""),
            response(uncertain="false"),
            response(text="one string instead of evidence list"),
            response([event(degree=True)]),
            response([event(degree=8)]),
            response([event(octave=3)]),
            response([event(accidental=3)]),
            response([event(lyric="x" * 1001)]),
            response([event(uncertain="false")]),
        ]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_region(value, region(), 100)


if __name__ == "__main__":
    unittest.main()
