import json
from fractions import Fraction
from pathlib import Path
import tempfile
import unittest

from recognition_eval import (duration_from_symbols, parse_score_data, normalize_reference,
                              normalize_candidate, compare_scores, evaluate_files)


class EvaluationTests(unittest.TestCase):
    # Each expected fraction below is hand-derived, independent of the adapter.
    def test_symbols_preserve_dots_tuplets_and_extensions_exactly(self):
        cases = [({}, Fraction(1)), ({'underlines': 1, 'dots': 1}, Fraction(3, 4)),
                 ({'underlines': 2, 'dots': 2}, Fraction(7, 16)),
                 ({'underlines': 1, 'tuplet': [3, 2]}, Fraction(1, 3)),
                 ({'underlines': 2, 'dots': 1, 'extensions': 2}, Fraction(19, 8))]
        for symbols, expected in cases:
            with self.subTest(symbols=symbols):
                self.assertEqual(duration_from_symbols(symbols), expected)
        for symbols in [{'underlines': -1}, {'tuplet': [0, 2]}, {'dots': 0.5}]:
            with self.subTest(invalid=symbols), self.assertRaises(ValueError):
                duration_from_symbols(symbols)

    def test_html_parser_reads_only_inert_json_and_rejects_ambiguous_payloads(self):
        text = '<script>throw new Error("must never run")</script><script id="scoreData" type="application/json">{"rows":[]}</script>'
        self.assertEqual(parse_score_data(text), {'rows': []})
        for bad in [text + text, '<script id="scoreData">alert(1)</script>', '<p>No payload</p>']:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                parse_score_data(bad)

    def test_reference_normalization_preserves_bar_anomalies_and_dash_duration(self):
        data = {'time_signature': '4/4', 'rows': [{'page': 1, 'row': 1, 'bars': [20, 40],
            'measure_beats': [1, 2], 'notes': [
                {'x': 10, 'pitch': '1', 'octave': -1, 'beams': 1, 'dotted': True, 'lyric': '甲'},
                {'x': 15, 'pitch': '2', 'octave': 0, 'beams': 2, 'dotted': False, 'lyric': ''},
                {'x': 25, 'pitch': '5', 'octave': 1, 'beams': 0, 'dotted': False, 'lyric': '乙'},
                {'x': 35, 'pitch': '-', 'octave': 0, 'beams': 0, 'dotted': False, 'lyric': ''}]}]}
        ref = normalize_reference(data)
        self.assertEqual([n.duration for n in ref.notes], [Fraction(3, 4), Fraction(1, 4), Fraction(2)])
        self.assertEqual([m.duration for m in ref.measures], [Fraction(1), Fraction(2)])
        self.assertEqual(len(ref.notes), 3)
        self.assertEqual(ref.notes[0].octave, -1)
        self.assertEqual(len([w for w in ref.warnings if w['kind'] == 'meter_anomaly']), 2)
        self.assertEqual(len(ref.notes[-1].evidence['extensions']), 1)

    def test_coordinate_triplet_has_no_song_specific_positions(self):
        ref = normalize_reference({'rows': [{'page': 7, 'row': 4, 'bars': [1000],
            'measure_beats': [2], 'triplet': [101, 202, 303],
            'notes': [{'x': x, 'pitch': '4', 'octave': 0, 'beams': 0, 'dotted': False, 'lyric': ''}
                      for x in [101.5, 201.5, 302.5]]}]})
        self.assertEqual([n.duration for n in ref.notes], [Fraction(2, 3)] * 3)
        self.assertEqual(ref.measures[0].duration, Fraction(2))

    def test_duplicate_pages_are_retained(self):
        row = {'page': 1, 'row': 1, 'bars': [20], 'notes': [
            {'x': 10, 'pitch': '2', 'octave': 0, 'beams': 0, 'dotted': False, 'lyric': '甲'}]}
        other = dict(row, page=2)
        ref = normalize_reference({'rows': [row, other]})
        self.assertEqual(len(ref.notes), 2)
        self.assertEqual(ref.page_order, ['1', '2'])
        self.assertEqual(len(ref.duplicates), 1)

    def test_extension_across_bar_preserves_symbol_occupancy(self):
        ref = normalize_reference({'rows': [{'page': 1, 'row': 1, 'bars': [20, 40],
            'notes': [{'x': 10, 'pitch': '3', 'octave': 0, 'beams': 0, 'dotted': False, 'lyric': ''},
                      {'x': 30, 'pitch': '-', 'octave': 0, 'beams': 0, 'dotted': False, 'lyric': ''}]}]})
        self.assertEqual(ref.notes[0].duration, Fraction(2))
        self.assertEqual([m.duration for m in ref.measures], [Fraction(1), Fraction(1)])

    def test_score_and_portable_duration_adapters_are_equivalent(self):
        portable = {'format': 'shengjian.score', 'version': 1, 'sources': [{'id': 'sheet-z'}],
            'measures': [{'id': 'm1', 'sourceId': 'sheet-z', 'row': 2, 'notes': [
                {'id': 'n', 'degree': 6, 'octave': -1, 'duration': [1, 3], 'lyric': '甲',
                 'rhythm': {'underlines': 1, 'tuplet': [3, 2]}}]}]}
        score = {'draft': {'measures': [{'id': 'm', 'sourcePage': 'sheet-z', 'row': 2, 'duration': 1 / 3}],
            'notes': [{'degree': 6, 'octave': -1, 'duration': 1 / 3, 'lyric': '甲',
                       'sourcePage': 'sheet-z', 'measureId': 'm'}]}}
        a, b = normalize_candidate(portable), normalize_candidate(score)
        self.assertEqual(a.notes[0].duration, Fraction(1, 3))
        self.assertEqual(b.notes[0].duration, Fraction(1, 3))
        self.assertTrue(any(w['kind'] == 'decimal_rationalized' for w in b.warnings))
        self.assertEqual(a.notes[0].pitch_token(), b.notes[0].pitch_token())

    def test_alignment_counts_missing_extra_octave_rhythm_and_lyrics_separately(self):
        ref = normalize_reference({'rows': [{'page': 1, 'row': 1, 'bars': [50], 'notes': [
            {'x': 10, 'pitch': '1', 'octave': 0, 'beams': 0, 'dotted': False, 'lyric': '甲'},
            {'x': 20, 'pitch': '2', 'octave': 0, 'beams': 1, 'dotted': False, 'lyric': '乙'},
            {'x': 30, 'pitch': '3', 'octave': 0, 'beams': 0, 'dotted': False, 'lyric': '丙'},
            {'x': 40, 'pitch': '4', 'octave': 0, 'beams': 0, 'dotted': False, 'lyric': '丁'}]}]})
        candidate = normalize_candidate({'notes': [
            {'degree': 1, 'octave': 0, 'duration': 1, 'lyric': '甲', 'sourcePage': 'x'},
            {'degree': 2, 'octave': 1, 'duration': 1, 'lyric': '误', 'sourcePage': 'x'},
            {'degree': 4, 'octave': 0, 'duration': 1, 'lyric': '丁', 'sourcePage': 'x'},
            {'degree': 7, 'octave': 0, 'duration': 1, 'lyric': '', 'sourcePage': 'x'}]})
        report = compare_scores(ref, candidate)
        m = report['metrics']
        self.assertEqual((m['pitch_matches'], m['note_precision'], m['note_recall']), (2, 0.5, 0.5))
        self.assertEqual(m['note_edits'], {'insertions': 1, 'deletions': 1, 'substitutions': 1, 'total': 3})
        self.assertEqual(m['octave_only_errors'], 1)
        self.assertEqual(m['rhythm_exact'], 2)
        self.assertEqual(m['lyric_character_edits'], 2)
        self.assertEqual(m['lyric_character_error_rate'], 0.5)
        self.assertEqual(report['coverage']['reference_measures'], 1)
        self.assertEqual(report['coverage']['candidate_measures'], 0)

    def test_missing_page_is_counted_as_missing_not_dropped_from_denominator(self):
        ref = normalize_reference({'rows': [
            {'page': p, 'row': 1, 'bars': [20], 'notes': [{'x': 10, 'pitch': '1', 'octave': 0,
             'beams': 0, 'dotted': False, 'lyric': ''}]} for p in [1, 2]]})
        cand = normalize_candidate({'notes': [{'degree': 1, 'octave': 0, 'duration': 1, 'sourcePage': 'x'}]})
        report = compare_scores(ref, cand)
        self.assertEqual(report['metrics']['note_recall'], 0.5)
        self.assertEqual(report['metrics']['note_edits']['deletions'], 1)
        self.assertEqual(report['coverage']['pages_with_candidate_notes'], 1)

    def test_unknowns_do_not_become_correct_rests(self):
        ref = normalize_reference({'rows': [{'page': 1, 'row': 1, 'notes': [
            {'x': 10, 'pitch': '0', 'octave': 0, 'beams': 0, 'dotted': False, 'lyric': ''}]}]})
        cand = normalize_candidate({'notes': [{'degree': None, 'octave': 0, 'duration': 1, 'uncertain': True}]})
        report = compare_scores(ref, cand)
        self.assertEqual(report['metrics']['pitch_matches'], 0)
        self.assertEqual(report['metrics']['unknown_pitch_events'], 1)

    def test_rhythm_evidence_conflict_is_retained_and_reported(self):
        c = normalize_candidate({'format': 'shengjian.score', 'measures': [{'id': 'm', 'sourceId': 'p',
            'notes': [{'degree': 3, 'octave': 0, 'duration': [1, 1], 'rhythm': {'underlines': 1}}]}]})
        self.assertEqual(c.notes[0].duration, Fraction(1))
        self.assertTrue(any(w['kind'] == 'rhythm_evidence_conflict' for w in c.warnings))

    def test_explicit_page_mapping_and_extra_page_preserve_all_denominators(self):
        ref = normalize_reference({'rows': [
            {'page': page, 'row': 1, 'bars': [30], 'notes': [
                {'x': 10, 'pitch': str(degree), 'octave': 0, 'lyric': ''}]}
            for page, degree in [(1, 1), (2, 7)]]})
        cand = normalize_candidate({'sources': [{'id': 'second'}, {'id': 'first'}, {'id': 'extra'}],
            'notes': [{'sourcePage': source, 'degree': degree, 'octave': 0, 'duration': 1}
                      for source, degree in [('second', 7), ('first', 1), ('extra', 5)]]})
        report = compare_scores(ref, cand, {'first': '1', 'second': '2'})
        self.assertEqual(report['metrics']['pitch_matches'], 2)
        self.assertEqual(report['metrics']['note_precision'], 2 / 3)
        self.assertEqual(report['metrics']['note_recall'], 1)
        self.assertEqual(report['metrics']['note_edits']['insertions'], 1)
        self.assertEqual(report['coverage']['candidate_pages'], 3)
        self.assertEqual(report['page_mapping']['method'], 'explicit page mapping')

    def test_missing_duration_stays_unknown_and_rest_octave_is_irrelevant(self):
        ref = normalize_reference({'rows': [{'page': 1, 'row': 1, 'notes': [
            {'x': 10, 'pitch': '0', 'octave': 0}, {'x': 20, 'pitch': '3', 'octave': 0}]}]})
        cand = normalize_candidate({'notes': [
            {'degree': 0, 'octave': 4, 'duration': 1},
            {'degree': 3, 'octave': 0, 'duration': None}]})
        metrics = compare_scores(ref, cand)['metrics']
        self.assertEqual(metrics['pitch_matches'], 2)
        self.assertEqual(metrics['pitched_aligned_pairs'], 1)
        self.assertEqual(metrics['rhythm_known_pairs'], 1)
        self.assertEqual(metrics['rhythm_exact_given_aligned_known'], 1)
        self.assertEqual(metrics['rhythm_exact_reference_recall'], 0.5)

    def test_midi_only_event_does_not_guess_a_movable_do_degree(self):
        candidate = normalize_candidate({'notes': [{'midi': 60, 'duration': 1}]})
        self.assertIsNone(candidate.notes[0].pitch_token())
        self.assertTrue(any(w['kind'] == 'unknown_degree' for w in candidate.warnings))

    def test_correct_notes_in_wrong_bar_do_not_count_as_correct_boundaries(self):
        ref = normalize_reference({'rows': [{'page': 1, 'row': 2, 'bars': [20, 40], 'notes': [
            {'x': 10, 'pitch': '1', 'octave': 0}, {'x': 30, 'pitch': '7', 'octave': 0}]}]})
        cand = normalize_candidate({'format': 'shengjian.score', 'measures': [
            {'id': 'a', 'sourceId': 'p', 'row': 2, 'notes': [
                {'degree': 1, 'octave': 0, 'duration': [1, 1]},
                {'degree': 7, 'octave': 0, 'duration': [1, 1]}]}]})
        report = compare_scores(ref, cand)
        self.assertEqual(report['metrics']['pitch_matches'], 2)
        self.assertEqual(report['coverage']['boundary_comparable_aligned_events'], 2)
        self.assertEqual(report['coverage']['boundary_exact_aligned_events'], 1)

    def test_accidental_error_is_separate_from_octave_and_degree_errors(self):
        ref = normalize_reference({'rows': [{'page': 1, 'row': 1, 'notes': [
            {'x': 10, 'pitch': '4', 'octave': 0}]}]})
        cand = normalize_candidate({'notes': [
            {'degree': 4, 'octave': 0, 'accidental': 1, 'duration': 1}]})
        metrics = compare_scores(ref, cand)['metrics']
        self.assertEqual(metrics['pitch_matches'], 0)
        self.assertEqual(metrics['degree_matches'], 1)
        self.assertEqual(metrics['accidental_only_errors'], 1)
        self.assertEqual(metrics['octave_only_errors'], 0)
        self.assertEqual(metrics['degree_errors'], 0)

    def test_empty_candidate_is_all_deletions_with_null_conditional_rates(self):
        ref = normalize_reference({'rows': [{'page': 1, 'row': 1, 'notes': [
            {'x': 10, 'pitch': '2', 'octave': 0}]}]})
        report = compare_scores(ref, normalize_candidate({'status': 'failed'}))
        metrics = report['metrics']
        self.assertEqual(metrics['note_edits']['deletions'], 1)
        self.assertEqual(metrics['note_recall'], 0)
        self.assertIsNone(metrics['note_precision'])
        self.assertIsNone(metrics['rhythm_exact_given_aligned_known'])
        self.assertEqual(report['coverage']['pages_with_candidate_notes'], 0)

    def test_extension_without_a_prior_event_is_rejected_across_pages(self):
        with self.assertRaisesRegex(ValueError, 'no prior event'):
            normalize_reference({'rows': [
                {'page': 1, 'row': 1, 'notes': [{'x': 10, 'pitch': '1', 'octave': 0}]},
                {'page': 2, 'row': 1, 'notes': [{'x': 10, 'pitch': '-', 'octave': 0}]}]})

    def test_invalid_rationals_cannot_create_zero_or_negative_note_durations(self):
        for duration in [[1, 0], [0, 1], [-1, 2], [True, 1], False]:
            with self.subTest(duration=duration), self.assertRaises(ValueError):
                normalize_candidate({'notes': [{'degree': 1, 'octave': 0, 'duration': duration}]})

    def test_file_evaluation_records_hashes_and_keeps_reference_in_output_only(self):
        test_output = Path(__file__).resolve().parents[2] / '.run' / 'recognition-eval-v4'
        test_output.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=test_output, prefix='synthetic-') as tmp:
            root = Path(tmp)
            html = root / 'ref.html'; candidate = root / 'job.json'; output = root / 'out'
            html.write_text('<script id="scoreData" type="application/json">{"rows":[]}</script>', encoding='utf-8')
            candidate.write_text('{"notes":[]}', encoding='utf-8')
            result = evaluate_files(html, [candidate], output)
            self.assertEqual(len(result['evaluations']), 1)
            self.assertEqual(len(result['inputs']['reference']['sha256']), 64)
            self.assertTrue((output / 'reference.normalized.json').is_file())
            self.assertTrue((output / 'report.json').is_file())
            self.assertEqual(json.loads((output / 'report.json').read_text(encoding='utf-8'))['version'], 4)


if __name__ == '__main__':
    unittest.main()
