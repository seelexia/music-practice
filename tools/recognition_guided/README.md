> 用户已于2026-10-29暂停模型识谱改进。以下仅为存档说明，未经新的明确要求不要运行模型或继续实验。

# Guided recognition prototype v2

This offline experiment does not change the running service or any song.
It has no evaluator, reference HTML, database, shell, credential or arbitrary
network tools. The only vision destination is an explicitly selected existing
loopback endpoint. Image text and provider responses are inert data.

The host makes a deterministic complete vertical ownership inventory using
Otsu ink projection and empirical run/gap statistics. Headers, lyrics, blank
space and ambiguous content are retained. Natural whitespace cuts have no
display overlap. Forced cuts through ink include context margins; model event
anchors determine ownership, and excluded context events remain in the ledger
with uncertainty instead of disappearing. Inventory region counts are geometry,
not predicted musical line counts.

Every inventoried region goes through a fixed observed-symbol JSON reader.
The model cannot skip pending regions or finish the queue. Host Fraction
arithmetic derives durations and reports actual meter anomalies without fitting
them. Invalid output retries and targeted uncertainty reviews are bounded;
invalid reviews preserve earlier valid evidence. A final whole-page visual
audit can dispute classifications. Its opinions and failures remain warnings.

Outputs include `package.json` (portable `shengjian.score` v1), `ledger.json`,
inventory/crop PNGs and every raw provider response with prompt/image hashes.
`processedCoverage` only says every host region obtained a classified response.
`transcriptionAccuracy` always remains `unverified`. Page-level phrase grouping
is provisional. Unresolved ties, unassigned text and uncertain bands need review.
The prototype never applies a package.

```powershell
python -m unittest discover -s tools/recognition_guided -p 'test_*.py' -v
python tools/recognition_guided/guided.py image.png --output experiment-output
```

Defaults: 32 regions/page, 64 requests/run, 2400 seconds total, at most three
attempts per region including targeted review, 256KB per response / 4MB total,
5000 output tokens, displayed images at most 1.2MP / 1800px per side. No song
names, target row/event counts, known lyrics or reference timings influence cuts,
prompts or arithmetic. Mechanism tests use independent generated layouts/fonts;
vision accuracy requires a separately frozen evaluation.
