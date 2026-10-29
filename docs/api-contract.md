# Runtime API contract v1

All JSON API routes prefix /api. Errors: {error:string}, status 400/409/500. Writes require header X-Music-Client: web, same-origin. No CORS. GET /api/health -> {ok:true}. Assets use direct binary body, not multipart.

Types shared at web/types.ts (frontend agent owns this file):
```ts
type Note = {id:string; beat:number; duration:number; midi:number|null; degree?:number; octave?:number; lyric:string; phraseId:string; sourcePage?:string; measureId?:string; uncertain?:boolean};
type Phrase = {id:string; label:string};
type Measure = {id:string;startBeat:number;duration:number;expectedBeats?:number;sourcePage?:string;row?:number;pickup?:boolean};
type Score = {bpm:number; key:string; timeSignature:[number,number]; notes:Note[]; phrases:Phrase[]; measures?:Measure[]; status:string};
type Asset = {id:string; name:string; kind:'score'|'audio'|'video'|'cover'|'recording'; mime:string; size:number; url:string; createdAt:string; take?:unknown};
type Song = {id:string; revision:number; title:string; artist:string; album:string; composer:string; lyricist:string; description:string; lyricsText?:string; tags:string[]; links:{bilibili:string;qq:string;netease:string}; coverId:string|null; assets:Asset[]; score:Score; alignment:{offset:number;anchors:{beat:number;seconds:number}[]}; archived:boolean; deletedAt?:string; createdAt:string;updatedAt:string};
type Provider = {id:string;name:string;baseUrl:string;model:string;apiKey?:string;hasKey?:boolean;timeoutSeconds:number};
type Settings = {providers:Provider[];activeProviderId:string};
type Job = {mode?:'recognition'|'lyrics';lyricsText?:string;id:string;songId:string;status:'queued'|'running'|'review'|'failed'|'applied';progress:string;error?:string;baseRevision:number;draft?:Score;overlaps?:{start:number;count:number;reason:string}[];createdAt:string};
```

- GET /songs -> Song[] (includes archived); POST /songs {title,artist?} -> Song.
- GET /songs/:id -> Song; PATCH /songs/:id {revision, ...editableFields} -> Song, increments revision. Fields: title artist album composer lyricist description lyricsText tags links coverId score alignment archived. No direct assets edits. Validate all lengths/numeric ranges. Score edits create history; GET /songs/:id/history -> [{revision,at,score}].
- POST /songs/:id/assets?kind=score|audio|video|cover|recording, raw bytes, Content-Type and X-File-Name: encodeURIComponent(file.name). -> updated Song. max 100MB. cover images PNG/JPEG/WebP, score same; mp3/wav/ogg/webm audio; mp4/webm video; browser recording audio. An upload does NOT immediately delete any asset; cover upload sets coverId.
- GET /assets/:id -> content with correct mime, range support. POST /songs/:id/recordings/:assetId/take {events,score,alignment,settings,...} saves take JSON; updated Song.
- GET /settings -> Settings (keys omitted); PUT /settings Settings -> sanitized Settings (blank apiKey preserves existing; explicit clearKey:true removes). POST /providers/test {baseUrl,apiKey?,model?} -> {models:string[]}.
- POST /songs/:id/recognize {lyricsText?:string,regions?:Region[]} -> Job (mode=recognition); GET /songs/:id/jobs -> Job[]. Does not overwrite score. POST /songs/:id/jobs/:jobId/apply {revision,removeOverlaps:boolean} -> Song; conflicts 409, rebase via manual draft import only. Remove overlaps only when explicit true. Can inspect draft in UI before applying.
- POST /metadata/preview {url} -> {title?,artist?,album?,description?,coverUrl?,platform,url,warning?}. No automatic save. POST /songs/:id/cover-url {url} fetches allowlisted cover CDN image and stores -> Song.
- GET /songs/:id/export/midi -> MIDI; GET /songs/:id/export/musicxml -> MusicXML; GET /songs/:id/export/project -> Song JSON. Frontend exports WAV from piano audio module and lyrics text.

Piano/audio module interfaces to agree directly between frontend/audio agents; only audio agent modifies web/audio/*.ts and web/components/PracticePanel.tsx, frontend agent owns other web files. Parent owns backend, package files and scripts. Frontend accesses local /api, no absolute machine paths.

## Implemented additions (2026-10-27)

- POST /songs/:id/assets/:asset/manage {revision,archived:true|false} archives/restores metadata without deleting files; or {revision,move:'up'|'down'} reorders score pages. Song may include archivedAssets:Asset[]; these remain available for source review but are excluded from new recognition/playback.
- POST /songs/:id/jobs/:job/recheck {} recomputes overlap evidence from saved pages, no VLM call. Job includes warnings, qualityIssues[{kind,message,...}], pages/raw responses/provenance and overlap previousCount/matchKind/evidenceHash. Confirmed fuzzy removal reruns evidence validation.
- Application of a recognition job atomically commits song, score history and applied status; recheck holds the same Store lock and never regresses status.
- API keys live in process memory only. Configuration persists, keys do not; hasKey refers to the current process.
- Vite static files use /static/ to avoid colliding with uploaded /assets/:id.


## Usability revision v2 additions (2026-10-27)

These are additive to the v1 API. Old documents without lyricsText, measures, measureId or job mode remain readable; existing unknown JSON fields are preserved. Schema validation still limits the score to a sorted, non-overlapping, monophonic linear melody and global BPM/key/meter. This does not introduce polyphony, mid-song meter/tempo/key changes or structural audio rearrangement.

- Song.lyricsText is optional, up to 20,000 Unicode characters; newline/CR/tab are permitted, other control characters rejected. PATCH remains revision guarded. Frontend unsaved text is additionally retained in the current browser; it is not server data until saved.
- POST /songs/:id/lyrics/align {revision,lyricsText} -> Job with mode='lyrics', baseRevision and the original score snapshot. Requires current revision, nonempty lyrics, existing notes, an active provider and no queued/running model job for that song. Produces a review draft, never applies immediately.
- A lyric-only result supplies one phrase per nonempty lyric line, using consecutive zero-based [start,end) note-index ranges that cover all notes. Lyric assignments are strictly increasing indices within their phrase, sounded notes only. Assigned text must match the corresponding manual line after removing punctuation/whitespace and case folding. The canonical original manual text is retained in lyricsText. Only note lyric/phraseId, score phrases and status may change; all other fields including IDs, order, pitch, onset, duration, source and measure metadata are compared with the original. Apply validates this again against the song, refuses removeOverlaps, and atomically commits score/history, lyricsText and job terminal status under revision protection.
- POST /songs/:id/recognize accepts an optional lyricsText (otherwise the song value is used) and optional regions. Region is {sourcePage:string,x:number,y:number,width:number,height:number,row?:number}, in original image pixels. Explicit regions must reference an active score asset belonging to the song; dimensions must be positive and within the source bounds. Maximum 400 supplied regions, 800 resulting segments; original score-page limit remains 20. There is currently no drag-to-crop frontend editor.
- Without explicit regions, conservative horizontal ink projection may split a page into rows. Uncertain layouts, including plausible score rows near the top that could otherwise be discarded as a header, fall back to the whole page with a warning. A crop is upscaled at most 4x, bounded by 1,200,000 target pixels and 4096 maximum side. The first row can carry a separate header-only image for key/BPM/meter; later rows inherit metadata defaults. This is a transcription aid, not a guarantee of correct notation.
- Recognition requests printed measures, with observed note rhythm symbols when available. Optional Score.measures entries store actual startBeat/duration, expectedBeats, sourcePage, source row and pickup marker; optional Note.measureId points to a unique measure. Optional rhythmEvidence retains observed underline/dot/dash/tuplet values, independently calculated duration and evidence source. Invalid symbols reject the response; disagreement marks the note uncertain and warns. Non-pickup bar totals that disagree with the meter warn without rescaling the note durations. Warnings, qualityIssues, raw model returns and image provenance remain review evidence.
- Row crops preserve their original sourcePage, unique segment IDs, source/sent image hashes, crop coordinates and dimensions. Saved-page overlap recheck groups adjacent rows by original page before comparing page boundaries; it does not deduplicate neighboring rows of one page. Recheck/apply remain serialized with the Store lock.
- Measure metadata validates IDs, ordered non-overlapping positive ranges, optional expectedBeats/row/pickup fields and referenced measure IDs. Frontend additionally checks contiguous coverage and note ownership before displaying printed bar boundaries; otherwise it uses global meter. Pitch/lyric edits retain timing and measures. Duration/insert/delete/meter edits clear stale measures and measureId references; duration changes shift subsequent notes by the delta, preserving existing leading and inter-note gaps. Insertion adds its occupied duration, deletion closes only the deleted note duration.
- POST /songs/:id/recordings/:assetId/delete {revision} -> updated Song. Requires the current revision, a UUID asset stored for this song, kind=recording, presence in the song asset list, and a regular non-symlink file directly inside the canonical data/assets directory. Refuses source audio and foreign-song assets. UI explicitly confirms record-and-file deletion. The verified file is renamed to a staging name before the database transaction; ordinary database failure restores it. After commit the staged file is removed. A process crash can leave a recoverable staged file; this is not a cross-filesystem atomicity guarantee. Cleanup failure returns recordingDeletionWarning with the successful response.
- Platform-link storage accepts valid y.qq.com subdomains such as i.y.qq.com; metadata input accepts the same host family. QQ songid/songmid/path and NetEase hash-song IDs are extracted before requesting allowlisted public song JSON. Nested singer/album fields yield artist/album/cover candidates; the frontend still previews and selectively saves fields. Network policy, bounded responses and safe redirect/DNS checks continue to apply.

Frontend playback interfaces: PracticeHandle.playFromBeat(beat,preRollBeats=1), seekBeat, seekPhrase, setLoopRange(start,end,enabled). Note clicks use the exact note onset minus configurable pre-roll, clamped to zero, and continue playback; explicit phrase playback remains separate. Score A/B selection is inclusive of the last selected note's full duration, mapped to the transport's half-open beat interval; selection updates settings without autoplay. PracticePanel workspaceView is practice|alignment|recordings|pitch|split; StandalonePitchPanel does not require a song. Alignment uses an independent raw-audio clock; negative mapped audio starts at zero. A two-anchor effective-BPM estimate adjusts piano practice speed, never the printed score BPM.

See [current handoff](07-handoff.md) for verified results and the pending live deployment boundary.

## Recognition harness / portable score v4 (2026-10-28)

- `GET /score-format` returns `{format:"shengjian.score",version:1,schema,template,prompt}`. Schema is JSON Schema2020-12; the generic synthetic example compiles through the same musical validator as imports.
- `GET /songs/:id/external-prompt` returns `{format,version,prompt,manifest:[{id,name,assetId}]}`. Manifest contains only current song score images in upload order. No audio, credentials or absolute paths are included; files are never sent to external tools automatically. Names are untrusted inert display text.
- `POST /songs/:id/import-score {revision,package,sourceMapping?}` creates a `mode=external,status=review` job, retaining `sourcePackage`, mapping, warnings, musical quality issues and baseRevision. No inference or song write. Package max2MB; whole request max2MB+32KB. Mapping is logical source ID→active score asset UUID belonging to that song; no implicit filename mapping, filesystem read, URL fetch or code execution. Bad data returns400 with paths; stale revision409. Store checks owner/revision under its lock after compilation too.
- Portable package uses rational quarter beats; optional observed rhythm must agree exactly with explicit duration. Null metadata inherits with warnings; null symbols are invalid except explicit unknown degree with uncertain=true. Bar mismatch is a warning, never forced duration normalization. Cross-bar ties merge sounding events but retain printed fragments and provenance. Apply uses existing atomic song/score-history/job version semantics, preserving song metadata.
- `POST /songs/:id/recognize` now defaults to `recognition_agent::run`. Its bounded JSON tool protocol supplies images/crops, bounded manual-lyrics chunks, observed symbols, host validation and targeted visual review. No old projection threshold path or model-supplied durations. Legacy stored jobs and parser tests remain supported. Supplying legacy `regions` returns400 instead of silently ignoring them.
- New jobs expose `workflow`, `workflowVersion`, `trace`, `counters`, `checks[]`, `sourcePackage`, `sourceMapping`, per-page coverage, `coverageComplete` and `partial`. Image provenance includes original/sent hashes and original coordinates. Counters are host budget reservations, not billed provider token counts. Failed jobs retain partial evidence and never change song contents. Review status with partial=true is visibly flagged.
- Recheck handles portable jobs from their compiled source groups without replacing original tool/image evidence. Repeated pages are kept; overlap suggestions require explicit user approval at existing apply entry. Compiler warnings survive recheck.

Full semantics, copy-prompt workflow and current limits: [recognition/import guide](08-recognition-and-external-import.md). Independent evaluation remains outside production code: [evaluation](recognition-evaluation.md).

## Library deletion / restoration additions (2026-10-28)

- `GET /songs` now excludes songs with a non-null `deletedAt`. It still includes archived songs; the client separates library/archive overviews.
- `POST /songs/:id/delete {revision}` -> deleted Song with `deletedAt`, incremented revision. Only archived songs, matching revision and no queued/running model jobs are eligible. This is reversible deletion: song/assets/history/jobs and binary files remain local. No permanent purge or background cleanup exists.
- `GET /trash` -> deleted Song[]. Do not load cover URLs here: normal asset access returns404 while the owner is deleted.
- `POST /trash/:id/restore {revision}` -> Song, removes `deletedAt`, keeps `archived=true`, increments revision. No implicit return to active library.
- Normal song reads, edits, assets, uploads, history, jobs and model submissions reject deleted owners with404. Restoring re-enables the existing UUID asset URLs. New inference-job writes validate owner under the Store lock, closing a race with deletion.
- Both deletion and restoration are transactional metadata updates. They do not delete files or add score-history entries. Unknown legacy song documents without `deletedAt` remain valid; no destructive migration.


## v5 client library batches (2026-10-29)

No new backend endpoint or persisted schema. The overview snapshots selected Song revisions and issues existing PATCH/archive/tag or POST/delete operations sequentially. Partial success is explicit; stale409 items retain their old selection until an explicit re-read. Filtering resets selection; select-all uses current visible matches. Archived-only delete confirmation lists the exact snapshot targets and uses the existing recoverable trash. There is no global batch transaction, automatic revision retry or permanent purge.

## Dual-line lyric convention (2026-10-29, v1 compatible)

The existing portable/internal note lyric remains a string. LF separates two aligned rows, e.g. `"Hello\n哈喽"`; an empty upper row is `"\n哈喽"`. Both rows share one note's timing; a tied continuation must have the whole string empty. The existing1000UTF-8-byte limit applies to all rows combined. Optional provenance.lyricRows describes first/second roles and kind (alternateVerse/translation/phonetic/unspecified); this is inert package provenance, not a new note field or playback control. Backend/schema require no update or migration.

The existing API base prompt/template remains valid single-line v1. All web copy entries append shared dual-line rules; web template downloads and docs snapshots use the shared two-verse example transformer. Existing raw MusicXML API still places LF inside one lyric/text. Web staff and web MusicXML download adapt it to numbered lyric elements; project exports retain the canonical string. No automatic translation, phonetic generation or repeat expansion is implied.

## v6 wishlist client convention (2026-10-29)

No new endpoint, backend or schema migration. The web client reserves Song.tags entry `愿望单` as explicit wishlist classification. Active library and wishlist are separate views of the same Song records; archives retain classification. User tag editors/batches preserve the reserved tag. Missing notes/assets never imply wishlist. Creating a wish uses existing POST then revision-guarded PATCH tags; after receiving the created ID the client checkpoints it before classification, and retries GET/PATCH the same ID. This is not an atomic create/classify transaction or POST idempotency guarantee. Completing a wish PATCHes only tags to remove classification, retains ID/metadata/assets/score/alignment/history, and opens materials.
