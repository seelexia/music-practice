"""Offline, standard-library-only score comparison. Never imported by the service.

HTML is parsed as inert markup; only one application/json script with id
scoreData is decoded. No browser, JavaScript engine, network, or song lookup.
"""
from __future__ import annotations

import argparse
from bisect import bisect_right
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from fractions import Fraction
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import unicodedata


VERSION = 4


def integer(value, name, minimum=0, maximum=32):
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f"{name} must be an integer in [{minimum}, {maximum}]")
    return value


def rational(value):
    if isinstance(value, bool):
        raise ValueError("Boolean is not a duration")
    if isinstance(value, (list, tuple)):
        if len(value) != 2 or any(isinstance(x, bool) or not isinstance(x, int) for x in value):
            raise ValueError("Duration rational must contain two integers")
        if value[1] <= 0:
            raise ValueError("Duration denominator must be positive")
        result = Fraction(*value)
    else:
        result = Fraction(str(value)).limit_denominator(1_000_000)
    if result <= 0:
        raise ValueError("Duration must be positive")
    return result


def duration_from_symbols(symbols):
    """Quarter beats: reduced/dotted/tuplet base, then quarter-beat dashes.

    Tuplet [actual, normal] means actual notes in the time of normal notes.
    Extensions are separate printed quarter-beat dashes, outside that tuplet.
    """
    underlines = integer(symbols.get("underlines", symbols.get("beams", 0)), "underlines", maximum=12)
    dots = integer(symbols.get("dots", 1 if symbols.get("dotted", False) else 0), "dots", maximum=8)
    extensions = integer(symbols.get("extensions", symbols.get("dashes", 0)), "extensions", maximum=128)
    result = Fraction(1, 2 ** underlines) * (2 - Fraction(1, 2 ** dots))
    if symbols.get("tuplet") is not None:
        tuplet = symbols["tuplet"]
        if isinstance(tuplet, dict):
            tuplet = [tuplet.get("actual"), tuplet.get("normal")]
        if not isinstance(tuplet, (list, tuple)) or len(tuplet) != 2:
            raise ValueError("Tuplet must be [actual, normal]")
        actual = integer(tuplet[0], "tuplet.actual", 1, 128)
        normal = integer(tuplet[1], "tuplet.normal", 1, 128)
        result *= Fraction(normal, actual)
    return result + extensions


class ScoreDataParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.active = False
        self.payloads = []
        self.buffer = []

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            attrs = dict(attrs)
            self.active = attrs.get("id") == "scoreData"
            if self.active:
                if attrs.get("type", "").lower() != "application/json":
                    raise ValueError("scoreData must be an inert application/json script")
                self.buffer = []

    def handle_endtag(self, tag):
        if tag == "script" and self.active:
            self.payloads.append("".join(self.buffer))
            self.active = False

    def handle_data(self, data):
        if self.active:
            self.buffer.append(data)


def parse_score_data(text):
    parser = ScoreDataParser()
    parser.feed(text)
    if len(parser.payloads) != 1:
        raise ValueError("Expected exactly one inert scoreData JSON payload")
    value = json.loads(parser.payloads[0])
    if not isinstance(value, dict) or not isinstance(value.get("rows"), list):
        raise ValueError("scoreData must be an object with rows array")
    return value


@dataclass
class Note:
    degree: int | None
    octave: int | None
    duration: Fraction | None
    lyric: str
    page: str
    measure: str | None = None
    row: int | None = None
    accidental: int = 0
    uncertain: bool = False
    evidence: dict = field(default_factory=dict)

    def pitch_token(self):
        if self.degree is None or (self.degree != 0 and self.octave is None):
            return None
        return (0, 0, 0) if self.degree == 0 else (self.degree, self.octave, self.accidental)


@dataclass
class Measure:
    id: str
    page: str
    row: int | None
    in_row: int | None
    ordinal: int
    duration: Fraction | None
    declared_duration: Fraction | None = None
    evidence: dict = field(default_factory=dict)


@dataclass
class Score:
    notes: list[Note] = field(default_factory=list)
    measures: list[Measure] = field(default_factory=list)
    page_order: list[str] = field(default_factory=list)
    warnings: list[dict] = field(default_factory=list)
    duplicates: list[dict] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)

    def add_page(self, page):
        if page not in self.page_order:
            self.page_order.append(page)


def lyric_text(value):
    return "".join(unicodedata.normalize("NFC", str(value or "")).split())


def meter_beats(value):
    if isinstance(value, str):
        value = [int(x) for x in value.split("/")]
    if not value:
        return None
    if len(value) != 2 or value[0] <= 0 or value[1] <= 0:
        raise ValueError("Invalid time signature")
    return Fraction(value[0] * 4, value[1])


def normalize_reference(data):
    score = Score(metadata={k: v for k, v in data.items() if k != "rows"})
    meter = meter_beats(data.get("time_signature", data.get("timeSignature")))
    ordinals = Counter()
    duplicate_rows = defaultdict(list)
    previous_note = None
    previous_page = None
    for occurrence, row in enumerate(data["rows"], 1):
        page = str(row["page"])
        row_number = row["row"]
        score.add_page(page)
        if previous_page != page:
            previous_note = None  # Never connect independent printed pages.
        previous_page = page
        source_notes = row["notes"]
        xs = [n["x"] for n in source_notes]
        if xs != sorted(xs):
            score.warnings.append({"kind": "nonmonotonic_source_x", "page": page, "row": row_number})
        bars = row.get("bars", [])
        if bars != sorted(bars) or len(set(bars)) != len(bars):
            raise ValueError("Bar positions must be distinct and ascending")
        declared = row.get("measure_beats", [])
        count = max([len(bars), len(declared), 1] + [bisect_right(bars, x) + 1 for x in xs])
        measures = []
        for index in range(count):
            ordinals[page] += 1
            m = Measure(f"ref-r{occurrence}-m{index + 1}", page, row_number, index + 1,
                        ordinals[page], Fraction(0), rational(declared[index]) if index < len(declared) else None,
                        {"bar_x": bars[index] if index < len(bars) else None})
            score.measures.append(m)
            measures.append(m)
        triplet_indices = set()
        # The source format expresses a triplet as three approximate note centers.
        # Match by nearest unique center; no song/row/absolute-coordinate rules.
        if row.get("triplet"):
            positions = row["triplet"]
            if len(positions) != 3 or not source_notes:
                raise ValueError("A coordinate triplet must select three notes")
            for position in positions:
                distances = [abs(x - position) for x in xs]
                nearest = min(distances)
                matches = [i for i, distance in enumerate(distances) if distance == nearest]
                if len(matches) != 1 or matches[0] in triplet_indices:
                    raise ValueError("Ambiguous triplet coordinate mapping")
                triplet_indices.add(matches[0])
                score.warnings.append({"kind": "coordinate_tuplet_mapping", "page": page,
                                       "row": row_number, "coordinate_distance": nearest})
        row_events = []
        for index, source in enumerate(source_notes):
            measure = measures[bisect_right(bars, source["x"])]
            symbols = {"underlines": source.get("beams", 0), "dots": int(bool(source.get("dotted", False)))}
            if index in triplet_indices:
                symbols["tuplet"] = [3, 2]
            duration = duration_from_symbols(symbols)
            measure.duration += duration
            if str(source["pitch"]) in {"-", "—", "–"}:
                if previous_note is None:
                    raise ValueError("Printed extension has no prior event on this page")
                previous_note.duration += duration
                previous_note.evidence.setdefault("extensions", []).append(
                    {"source": source, "measure": measure.id, "row": row_number, "duration": duration})
                continue
            pitch = str(source["pitch"])
            if not re.fullmatch(r"[0-7]", pitch):
                raise ValueError(f"Unsupported reference pitch symbol: {pitch!r}")
            note = Note(int(pitch), integer(source.get("octave", 0), "octave", -8, 8), duration,
                        lyric_text(source.get("lyric")), page, measure.id, row_number,
                        evidence={"source": source, "rhythm": symbols})
            score.notes.append(note)
            row_events.append(note)
            previous_note = note
        for measure in measures:
            if measure.declared_duration is not None and measure.duration != measure.declared_duration:
                score.warnings.append({"kind": "declared_measure_total_disagrees", "measure": measure.id,
                                       "computed": measure.duration, "declared": measure.declared_duration})
            if meter is not None and measure.duration != meter:
                score.warnings.append({"kind": "meter_anomaly", "measure": measure.id,
                                       "computed": measure.duration, "meter": meter})
        signature = tuple((n.pitch_token(), n.duration, n.lyric) for n in row_events)
        duplicate_rows[signature].append({"page": page, "row": row_number})
    score.duplicates = [{"occurrences": places, "event_count": len(signature)}
                        for signature, places in duplicate_rows.items() if len(places) > 1 and signature]
    return score


def read_duration(raw, score, location):
    if raw is None:
        return None
    result = rational(raw)
    if isinstance(raw, (float, str)) and Fraction(str(raw)) != result:
        score.warnings.append({"kind": "decimal_rationalized", "location": location,
                               "original": raw, "rational": result})
    return result


def normalize_candidate(value):
    if "job" in value and isinstance(value["job"], dict):
        value = value["job"]
    root = value
    if isinstance(value.get("draft"), dict):
        value = value["draft"]
    elif isinstance(value.get("package"), dict):
        value = value["package"]
    elif isinstance(value.get("sourcePackage"), dict):
        value = value["sourcePackage"]
    score = Score(metadata={"format": value.get("format", "runtime-score"),
                            "job_status": root.get("status"), "workflowVersion": root.get("workflowVersion")})
    portable = value.get("format") == "shengjian.score" or (
        "notes" not in value and any("notes" in m for m in value.get("measures", [])))
    for source in value.get("sources", []):
        score.add_page(str(source["id"]))
    measure_map = {}
    row_counters = Counter()
    ordinals = Counter()
    for index, item in enumerate(value.get("measures", [])):
        page = str(item.get("sourceId", item.get("sourcePage", "1")))
        score.add_page(page)
        row_number = item.get("row")
        ordinals[page] += 1
        row_counters[(page, row_number)] += 1
        duration = read_duration(item.get("duration"), score, f"measure[{index}]")
        m = Measure(str(item.get("id", f"candidate-m{index}")), page, row_number,
                    row_counters[(page, row_number)] if row_number is not None else None,
                    ordinals[page], duration, evidence={"source": item})
        if m.id in measure_map:
            score.warnings.append({"kind": "duplicate_measure_id", "id": m.id})
        measure_map[m.id] = m
        score.measures.append(m)
    if portable:
        raw_notes = [(n, m) for source, m in zip(value.get("measures", []), score.measures)
                     for n in source.get("notes", [])]
    else:
        raw_notes = [(n, measure_map.get(str(n.get("measureId")))) for n in value.get("notes", [])]
    for index, (item, measure) in enumerate(raw_notes):
        page = str(item.get("sourcePage", measure.page if measure else item.get("sourceId", "1")))
        score.add_page(page)
        degree = item.get("degree")
        if degree is not None:
            degree = integer(degree, "degree", 0, 7)
        octave = item.get("octave")
        if octave is not None:
            octave = integer(octave, "octave", -8, 8)
        duration = read_duration(item.get("duration"), score, f"note[{index}]")
        rhythm = item.get("rhythm")
        if rhythm:
            observed_duration = duration_from_symbols(rhythm)
            if duration is None:
                duration = observed_duration
            elif observed_duration != duration:
                score.warnings.append({"kind": "rhythm_evidence_conflict", "note_index": index,
                                       "duration": duration, "evidence_duration": observed_duration})
        note = Note(degree, octave, duration, lyric_text(item.get("lyric")), page,
                    measure.id if measure else None, measure.row if measure else None,
                    integer(item.get("accidental", 0), "accidental", -2, 2), bool(item.get("uncertain", False)),
                    {"source": item})
        score.notes.append(note)
    for measure in score.measures:
        if measure.duration is None:
            durations = [n.duration for n in score.notes if n.measure == measure.id]
            if durations and all(d is not None for d in durations):
                measure.duration = sum(durations, Fraction(0))
    if any(n.degree is None for n in score.notes):
        score.warnings.append({"kind": "unknown_degree", "count": sum(n.degree is None for n in score.notes),
                               "detail": "MIDI-only/unknown events are not guessed into movable-do degrees"})
    return score


def add_cost(a, b):
    return tuple(x + y for x, y in zip(a, b))


def align_notes(reference, candidate):
    """Unit pitch-token edit alignment, with fixed, documented tie breakers.

    Among equal edit paths prefer degree matches, same-degree rhythm matches,
    nonempty lyric matches, then fewer gaps. No ground-truth-dependent weights.
    """
    size = len(candidate)
    previous = [(j, 0, 0, 0, j) for j in range(size + 1)]
    back = [bytearray([0] + [2] * size)]
    gap = (1, 0, 0, 0, 1)
    for i, ref in enumerate(reference, 1):
        current = [(i, 0, 0, 0, i)]
        directions = bytearray([1])
        for j, got in enumerate(candidate, 1):
            pitch_equal = ref.pitch_token() is not None and ref.pitch_token() == got.pitch_token()
            degree_equal = ref.degree is not None and ref.degree == got.degree
            duration_equal = degree_equal and ref.duration is not None and ref.duration == got.duration
            lyric_equal = bool(ref.lyric) and ref.lyric == got.lyric
            diagonal = add_cost(previous[j - 1], (int(not pitch_equal), -int(degree_equal),
                                                -int(duration_equal), -int(lyric_equal), 0))
            options = [(diagonal, 0), (add_cost(previous[j], gap), 1), (add_cost(current[j - 1], gap), 2)]
            cost, direction = min(options, key=lambda x: (x[0], x[1]))
            current.append(cost)
            directions.append(direction)
        back.append(directions)
        previous = current
    pairs = []
    i, j = len(reference), size
    while i or j:
        direction = back[i][j]
        if direction == 0:
            pairs.append((i - 1, j - 1)); i -= 1; j -= 1
        elif direction == 1:
            pairs.append((i - 1, None)); i -= 1
        else:
            pairs.append((None, j - 1)); j -= 1
    return list(reversed(pairs))


def character_edits(reference, candidate):
    previous = list(range(len(candidate) + 1))
    for i, char in enumerate(reference, 1):
        current = [i]
        for j, other in enumerate(candidate, 1):
            current.append(min(previous[j] + 1, current[-1] + 1, previous[j - 1] + (char != other)))
        previous = current
    return previous[-1]


def metrics_for_pairs(reference, candidate, pairs):
    result = Counter(reference_events=len(reference), candidate_events=len(candidate),
                     unknown_pitch_events=sum(n.pitch_token() is None for n in candidate),
                     uncertain_events=sum(n.uncertain for n in candidate))
    for ri, ci in pairs:
        if ri is None:
            result["insertions"] += 1; continue
        if ci is None:
            result["deletions"] += 1; continue
        ref, got = reference[ri], candidate[ci]
        result["aligned_pairs"] += 1
        degree_equal = ref.degree is not None and ref.degree == got.degree
        pitch_equal = ref.pitch_token() is not None and ref.pitch_token() == got.pitch_token()
        result["degree_matches"] += degree_equal
        result["pitch_matches"] += pitch_equal
        result["substitutions"] += not pitch_equal
        pitched_pair = ref.degree not in (0, None) and got.degree not in (0, None)
        result["pitched_aligned_pairs"] += pitched_pair
        result["octave_matches"] += pitched_pair and ref.octave is not None and ref.octave == got.octave
        result["octave_only_errors"] += degree_equal and ref.degree != 0 and ref.octave != got.octave
        result["degree_errors"] += not degree_equal
        result["accidental_only_errors"] += degree_equal and ref.octave == got.octave and ref.accidental != got.accidental
        rhythm_known = ref.duration is not None and got.duration is not None
        rhythm_equal = rhythm_known and ref.duration == got.duration
        result["rhythm_known_pairs"] += rhythm_known
        result["rhythm_exact"] += rhythm_equal
        result["lyric_event_exact"] += ref.lyric == got.lyric
        result["pitch_and_rhythm_exact"] += pitch_equal and rhythm_equal
        result["full_event_exact"] += pitch_equal and rhythm_equal and ref.lyric == got.lyric
    ref_lyrics = "".join(n.lyric for n in reference)
    got_lyrics = "".join(n.lyric for n in candidate)
    result["reference_lyric_characters"] = len(ref_lyrics)
    result["candidate_lyric_characters"] = len(got_lyrics)
    result["lyric_character_edits"] = character_edits(ref_lyrics, got_lyrics)
    return result


def ratio(a, b):
    return a / b if b else None


def finish_metrics(counts):
    keys = ["reference_events", "candidate_events", "aligned_pairs", "pitch_matches", "degree_matches",
            "pitched_aligned_pairs", "octave_matches", "rhythm_known_pairs", "rhythm_exact", "lyric_event_exact",
            "pitch_and_rhythm_exact", "full_event_exact", "octave_only_errors", "degree_errors",
            "accidental_only_errors", "unknown_pitch_events", "uncertain_events", "reference_lyric_characters",
            "candidate_lyric_characters", "lyric_character_edits"]
    result = {k: counts[k] for k in keys}
    result["note_edits"] = {k: counts[k] for k in ["insertions", "deletions", "substitutions"]}
    result["note_edits"]["total"] = sum(result["note_edits"].values())
    result.update(note_precision=ratio(counts["pitch_matches"], counts["candidate_events"]),
                  note_recall=ratio(counts["pitch_matches"], counts["reference_events"]),
                  rhythm_exact_given_aligned_known=ratio(counts["rhythm_exact"], counts["rhythm_known_pairs"]),
                  rhythm_exact_reference_recall=ratio(counts["rhythm_exact"], counts["reference_events"]),
                  octave_match_given_pitched_alignment=ratio(counts["octave_matches"], counts["pitched_aligned_pairs"]),
                  lyric_character_error_rate=ratio(counts["lyric_character_edits"], counts["reference_lyric_characters"]))
    return result


def compare_scores(reference, candidate, page_map=None):
    if page_map is None:
        page_map = {page: reference.page_order[i] if i < len(reference.page_order) else f"extra:{page}"
                    for i, page in enumerate(candidate.page_order)}
        mapping_method = "first-seen candidate page order to reference printed page order (assumption)"
    else:
        page_map = {str(k): str(v) for k, v in page_map.items()}
        mapping_method = "explicit page mapping"
    ref_pages = defaultdict(list); got_pages = defaultdict(list)
    for index, note in enumerate(reference.notes):
        ref_pages[note.page].append((index, note))
    for index, note in enumerate(candidate.notes):
        got_pages[page_map.get(note.page, f"unmapped:{note.page}")].append((index, note))
    pages = list(reference.page_order) + [p for p in got_pages if p not in reference.page_order]
    total = Counter(); reports = []; all_pairs = []
    for page in pages:
        ref = [n for _, n in ref_pages[page]]; got = [n for _, n in got_pages[page]]
        pairs = align_notes(ref, got)
        counts = metrics_for_pairs(ref, got, pairs)
        total.update(counts)
        global_pairs = [(ref_pages[page][ri][0] if ri is not None else None,
                         got_pages[page][ci][0] if ci is not None else None) for ri, ci in pairs]
        all_pairs.extend(global_pairs)
        reports.append({"page": page, "metrics": finish_metrics(counts), "alignment": global_pairs})
    paired = {ri: ci for ri, ci in all_pairs if ri is not None and ci is not None}
    candidate_measures = {m.id: m for m in candidate.measures}
    per_measure = []; boundary_known = boundary_exact = 0
    for measure in reference.measures:
        indices = [i for i, n in enumerate(reference.notes) if n.measure == measure.id]
        candidates = [paired[i] for i in indices if i in paired]
        pitch_matches = sum(reference.notes[i].pitch_token() is not None and
                            reference.notes[i].pitch_token() == candidate.notes[paired[i]].pitch_token()
                            for i in indices if i in paired)
        rhythm_matches = sum(reference.notes[i].duration == candidate.notes[paired[i]].duration
                             for i in indices if i in paired)
        boundary_modes = Counter(); boundaries = 0
        for i in indices:
            if i not in paired:
                continue
            cm = candidate_measures.get(candidate.notes[paired[i]].measure)
            if cm is None:
                continue
            mode = "row_and_bar_ordinal" if cm.row is not None else "page_bar_ordinal"
            agrees = page_map.get(cm.page) == measure.page and (
                (cm.row, cm.in_row) == (measure.row, measure.in_row) if cm.row is not None else cm.ordinal == measure.ordinal)
            boundary_modes[mode] += 1; boundary_known += 1
            boundaries += agrees; boundary_exact += agrees
        per_measure.append({"measure": measure.id, "page": measure.page, "row": measure.row,
                            "bar_in_row": measure.in_row, "reference_events": len(indices),
                            "aligned_events": len(candidates), "pitch_matches": pitch_matches,
                            "rhythm_exact": rhythm_matches, "reference_duration": measure.duration,
                            "declared_duration": measure.declared_duration,
                            "candidate_measure_ids": sorted({candidate.notes[i].measure for i in candidates
                                                             if candidate.notes[i].measure is not None}),
                            "boundary_comparison_modes": dict(boundary_modes), "boundary_exact_events": boundaries})
    coverage = {"reference_pages": len(reference.page_order), "candidate_pages": len(candidate.page_order),
                "pages_with_candidate_notes": sum(bool(got_pages[p]) for p in reference.page_order),
                "reference_measures": len(reference.measures), "candidate_measures": len(candidate.measures),
                "reference_measures_with_aligned_events": sum(m["aligned_events"] > 0 for m in per_measure),
                "reference_measures_all_events_aligned": sum(m["aligned_events"] == m["reference_events"]
                                                             and m["reference_events"] > 0 for m in per_measure),
                "reference_measures_all_pitch_exact": sum(m["pitch_matches"] == m["reference_events"]
                                                          and m["reference_events"] > 0 for m in per_measure),
                "boundary_comparable_aligned_events": boundary_known, "boundary_exact_aligned_events": boundary_exact,
                "reference_notes_with_candidate_measure_metadata": sum(candidate.notes[ci].measure is not None
                                                                        for ci in paired.values())}
    return {"metrics": finish_metrics(total), "coverage": coverage, "pages": reports, "measures": per_measure,
            "page_mapping": {"method": mapping_method, "candidate_to_reference": page_map},
            "candidate_warnings": candidate.warnings,
            "limitations": ["Pitch-token Levenshtein alignment is ambiguous in repeated/identical passages; fixed tie breakers are declared in methodology.",
                            "Conditional octave/rhythm rates exclude missing events; reference recall and edit counts must be read alongside them.",
                            "Measure coverage describes aligned events, not verified barlines. Missing measure metadata is not inferred.",
                            "Reference is supplied data, not independently adjudicated musical truth. Anomalies and all printed duplicate material remain.",
                            "No repeat/volta performance expansion or slur/tie inference. Only explicit printed dash tokens extend an event.",
                            "One supplied score and historical drafts cannot establish generalization. No candidate was applied to a song."]}


def json_value(value):
    if isinstance(value, Fraction):
        return [value.numerator, value.denominator]
    if hasattr(value, "__dataclass_fields__"):
        return asdict(value)
    raise TypeError(type(value).__name__)


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=json_value) + "\n", encoding="utf-8")


def file_info(path):
    return {"path": str(path.resolve()), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "bytes": path.stat().st_size}


def evaluate_files(reference_path, candidate_paths, output_dir, page_map=None):
    reference_path = Path(reference_path); output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    reference = normalize_reference(parse_score_data(reference_path.read_text(encoding="utf-8-sig")))
    write_json(output_dir / "reference.normalized.json", reference)
    report = {"version": VERSION, "evaluator": file_info(Path(__file__)),
              "inputs": {"reference": file_info(reference_path), "candidates": [file_info(Path(p)) for p in candidate_paths]},
              "reference_summary": {"events": len(reference.notes), "pages": len(reference.page_order),
                                    "measures": len(reference.measures), "warnings": reference.warnings,
                                    "duplicate_rows": reference.duplicates},
              "methodology": {"duration_unit": "quarter-note beat as reduced rational [numerator, denominator]",
                              "note_precision_recall": "exact (degree, octave, accidental) pitch-token matches / all candidate or reference events; rests ignore octave",
                              "alignment": "per mapped printed page, unit pitch-token Levenshtein; equal-cost paths prefer degree matches, same-degree duration matches, nonempty lyric matches, fewer gaps, diagonal",
                              "lyrics": "NFC, whitespace removed, punctuation retained; character Levenshtein per printed page, summed without deduplication",
                              "rhythm": "exact rational equality on the frozen pitch alignment; decimal values rationalized with max denominator 1000000 and recorded",
                              "triplet": "three coordinate centers select nearest distinct source note centers, normal/actual ratio 2/3; distances retained",
                              "measure_duration": "sum printed symbol occupancy, including dash segments in their printed bar; an extended event may span bars",
                              "bar_anomalies": "reported, never rescaled; source declared totals preserved separately"},
              "evaluations": []}
    for file_index, candidate_path in enumerate(candidate_paths):
        candidate_path = Path(candidate_path)
        value = json.loads(candidate_path.read_text(encoding="utf-8-sig"))
        jobs = value if isinstance(value, list) else [value]
        for job_index, job in enumerate(jobs):
            candidate = normalize_candidate(job)
            identifier = f"candidate-{file_index + 1}-job-{job_index + 1}"
            write_json(output_dir / f"{identifier}.normalized.json", candidate)
            result = compare_scores(reference, candidate, page_map)
            result.update(id=identifier, input=str(candidate_path.resolve()), job_index=job_index,
                          job_id=job.get("id"), job_status=job.get("status"))
            report["evaluations"].append(result)
    write_json(output_dir / "report.json", report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-html", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, action="append", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--page-map-json", type=Path, help="Optional JSON candidate source id -> reference printed page id")
    args = parser.parse_args()
    mapping = json.loads(args.page_map_json.read_text(encoding="utf-8-sig")) if args.page_map_json else None
    report = evaluate_files(args.reference_html, args.candidate, args.output_dir, mapping)
    # Terminal output intentionally contains aggregates only, never exact reference notes/lyrics.
    print(json.dumps({"report": str((args.output_dir / "report.json").resolve()),
                      "reference_counts": {k: report["reference_summary"][k] for k in ["events", "pages", "measures"]},
                      "evaluations": [{"id": e["id"], "metrics": e["metrics"], "coverage": e["coverage"]}
                                      for e in report["evaluations"]]}, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
