use music_practice::recognition_agent::{AgentState, Limits, derive_rhythm};
use serde_json::{Value, json};

fn manifest() -> Vec<Value> {
    vec![
        json!({"id":"page-1","width":913,"height":677}),
        json!({"id":"page-2","width":701,"height":1021}),
    ]
}

fn state() -> AgentState {
    AgentState::new(manifest(), Limits::default()).unwrap()
}
#[test]
fn provider_working_memory_keeps_existing_regions_and_metadata_between_views() {
    let mut s = state();
    view(&mut s, "page-1");
    s.apply(&json!({"tool":"set_metadata","metadata":{"key":"F#","bpm":91,"timeSignature":[3,8]}}))
        .unwrap();
    s.apply(&json!({"tool":"inspect_crop","sourceId":"page-1","regionId":"detail-a","bounds":[9,11,100,80]})).unwrap();
    next(&mut s);
    let memory = s.working_context();
    assert_eq!(memory["metadata"]["key"], "F#");
    let regions = memory["inspectedRegions"].as_array().unwrap();
    assert!(
        regions
            .iter()
            .any(|r| r["regionId"] == "detail-a" && r["bounds"] == json!([9, 11, 100, 80]))
    );
    assert!(regions.iter().any(|r| r["regionId"] == "page-1:whole"));
}
#[test]
fn repeated_crop_geometry_is_rejected_even_under_a_new_name() {
    let mut s = state();
    view(&mut s, "page-1");
    s.apply(&json!({"tool":"inspect_crop","sourceId":"page-1","regionId":"detail-a","bounds":[9,11,100,80]})).unwrap();
    next(&mut s);
    assert!(s.apply(&json!({"tool":"inspect_crop","sourceId":"page-1","regionId":"renamed","bounds":[9,11,100,80]})).unwrap_err().contains("already inspected"));
}
#[test]
fn musical_error_in_replacement_preserves_valid_symbols_and_focus_ledger() {
    let mut s = state();
    view(&mut s, "page-1");
    let good = submit(
        "m-one",
        "page-1",
        "page-1:whole",
        1,
        json!({"underlines":0,"dots":0,"extensions":0}),
    );
    s.apply(&good).unwrap();
    let before = s.package();
    let mut invalid = good.clone();
    invalid["measures"][0]["notes"][0]["tieFrom"] = json!("missing");
    assert!(s.apply(&invalid).is_err());
    assert_eq!(s.package(), before);
    assert_eq!(
        s.observation_focus("page-1:whole")["alreadySubmitted"][0]["id"],
        "m-one"
    );
    let mut without_flag = good;
    without_flag["measures"][0]["notes"][0]
        .as_object_mut()
        .unwrap()
        .remove("uncertain");
    s.apply(&without_flag).unwrap();
    assert_eq!(s.package()["measures"][0]["notes"][0]["uncertain"], false);
}

fn next(s: &mut AgentState) {
    s.begin_request(100).unwrap();
}

fn view(s: &mut AgentState, page: &str) {
    next(s);
    s.apply(&json!({"tool":"inspect_page","sourceId":page}))
        .unwrap();
    next(s);
}

fn submit(id: &str, page: &str, region: &str, order: u64, rhythm: Value) -> Value {
    json!({"tool":"submit_symbols","sourceId":page,"regionId":region,"row":1,"measures":[{"id":id,"order":order,"notes":[{"id":format!("{id}-n"),"degree":3,"octave":-1,"lyric":"","rhythm":rhythm,"uncertain":false}]}]})
}

#[test]
fn rhythm_is_exact_and_dashes_extend_the_observed_event() {
    assert_eq!(
        derive_rhythm(&json!({"underlines":2,"dots":2,"extensions":1,"tuplet":[3,2]})).unwrap(),
        [31, 24]
    );
    assert_eq!(
        derive_rhythm(&json!({"underlines":1,"dots":1,"extensions":0})).unwrap(),
        [3, 4]
    );
    assert!(
        derive_rhythm(&json!({"underlines":1,"dots":0,"extensions":0,"tuplet":[0,2]})).is_err()
    );
    assert!(derive_rhythm(&json!({"underlines":1,"dots":0})).is_err());
}

#[test]
fn crops_require_overview_and_are_checked_against_original_bounds() {
    let mut s = state();
    next(&mut s);
    let crop = json!({"tool":"inspect_crop","sourceId":"page-1","regionId":"unseen","bounds":[71,59,711,201]});
    assert!(s.apply(&crop).is_err());
    s.apply(&json!({"tool":"inspect_page","sourceId":"page-1"}))
        .unwrap();
    assert!(
        s.apply(&crop).is_err(),
        "an image cannot be observed in the request that selected it"
    );
    next(&mut s);
    assert!(s.apply(&json!({"tool":"inspect_crop","sourceId":"page-1","regionId":"bad","bounds":[900,59,20,201]})).is_err());
    assert!(s.apply(&json!({"tool":"inspect_crop","sourceId":"page-1","regionId":"bad","bounds":[0,0,0,201]})).is_err());
    assert!(s.apply(&json!({"tool":"inspect_crop","sourceId":"../../file","regionId":"bad","bounds":[0,0,1,1]})).is_err());
    let result = s.apply(&crop).unwrap();
    assert_eq!(result["image"]["bounds"], json!([71, 59, 711, 201]));
}

#[test]
fn each_provider_turn_can_request_only_one_distinct_image_region() {
    let mut s = state();
    next(&mut s);
    s.apply(&json!({"tool":"inspect_page","sourceId":"page-1"}))
        .unwrap();
    assert!(
        s.apply(&json!({"tool":"inspect_page","sourceId":"page-2"}))
            .is_err()
    );
    next(&mut s);
    s.apply(&json!({"tool":"inspect_page","sourceId":"page-2"}))
        .unwrap();
}

#[test]
fn unknown_tools_and_model_arithmetic_are_rejected_without_losing_prior_work() {
    let mut s = state();
    view(&mut s, "page-1");
    s.apply(&submit(
        "m-one",
        "page-1",
        "page-1:whole",
        1,
        json!({"underlines":1,"dots":0,"extensions":0}),
    ))
    .unwrap();
    assert!(
        s.apply(&json!({"tool":"shell","command":"anything"}))
            .is_err()
    );
    let mut invalid = submit(
        "m-two",
        "page-1",
        "page-1:whole",
        2,
        json!({"underlines":0,"dots":0,"extensions":0}),
    );
    invalid["measures"][0]["notes"][0]["duration"] = json!([4, 1]);
    assert!(s.apply(&invalid).is_err());
    assert_eq!(s.package()["measures"].as_array().unwrap().len(), 1);
    assert_eq!(
        s.package()["measures"][0]["notes"][0]["duration"],
        json!([1, 2])
    );
}

#[test]
fn source_order_and_abnormal_bars_survive_targeted_replacement() {
    let mut s = state();
    for page in ["page-2", "page-1"] {
        view(&mut s, page);
        s.apply(&submit(
            &format!("{page}-m"),
            page,
            &format!("{page}:whole"),
            1,
            json!({"underlines":0,"dots":0,"extensions":4}),
        ))
        .unwrap();
    }
    let mut fix = submit(
        "page-1-m",
        "page-1",
        "page-1:whole",
        1,
        json!({"underlines":0,"dots":1,"extensions":3}),
    );
    fix["measures"][0]["notes"][0]["degree"] = json!(0);
    fix["measures"][0]["notes"][0]["octave"] = json!(0);
    s.apply(&fix).unwrap();
    let p = s.package();
    assert_eq!(p["measures"][0]["sourceId"], "page-1");
    assert_eq!(p["measures"][0]["notes"][0]["degree"], 0);
    assert_eq!(p["measures"][0]["notes"][0]["duration"], json!([9, 2]));
    assert_eq!(p["measures"][1]["notes"][0]["duration"], json!([5, 1]));
}

#[test]
fn budgets_are_finite_and_exhaustion_preserves_partial_symbols() {
    let mut limits = Limits::default();
    limits.max_actions = 2;
    let mut s = AgentState::new(manifest(), limits).unwrap();
    view(&mut s, "page-1");
    s.apply(&submit(
        "m-one",
        "page-1",
        "page-1:whole",
        1,
        json!({"underlines":0,"dots":0,"extensions":0}),
    ))
    .unwrap();
    assert!(
        s.apply(&json!({"tool":"validate"}))
            .unwrap_err()
            .contains("budget")
    );
    assert_eq!(s.package()["measures"][0]["id"], "m-one");
}

#[test]
fn finish_cannot_claim_unvisited_or_unvalidated_pages_are_complete() {
    let mut s = state();
    assert!(s.apply(&json!({"tool":"finish","pages":[{"sourceId":"page-1","complete":true},{"sourceId":"page-2","complete":true}]})).is_err());
    view(&mut s, "page-1");
    s.apply(&submit(
        "m-one",
        "page-1",
        "page-1:whole",
        1,
        json!({"underlines":0,"dots":0,"extensions":0}),
    ))
    .unwrap();
    assert!(!s.coverage_complete());
    assert!(s.apply(&json!({"tool":"finish","pages":[{"sourceId":"page-1","complete":true},{"sourceId":"page-2","complete":false,"note":"unreadable"}]})).is_err());
}

#[test]
fn host_checks_and_later_targeted_review_are_required_before_finish() {
    let mut s = state();
    view(&mut s, "page-1");
    s.apply(&submit(
        "m-one",
        "page-1",
        "page-1:whole",
        1,
        json!({"underlines":0,"dots":0,"extensions":0}),
    ))
    .unwrap();
    let finish = json!({"tool":"finish","pages":[{"sourceId":"page-1","complete":true},{"sourceId":"page-2","complete":false,"note":"Notation unreadable"}]});
    let checks = s.apply(&json!({"tool":"validate"})).unwrap();
    assert_eq!(checks["valid"], true);
    next(&mut s);
    assert!(
        s.apply(&finish).is_err(),
        "finish requires image review after host validation"
    );
    s.apply(&json!({"tool":"review","measureIds":["m-one"]}))
        .unwrap();
    assert!(
        s.apply(&finish).is_err(),
        "review image must be visible in a later request"
    );
    next(&mut s);
    s.apply(&finish).unwrap();
    assert!(s.finished);
    assert!(!s.coverage_complete());
    assert!(
        s.package()["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v.as_str().unwrap().contains("incomplete"))
    );
}

#[test]
fn failed_compilation_cannot_be_presented_as_validated() {
    let mut s = state();
    view(&mut s, "page-1");
    let mut notes = submit(
        "m-one",
        "page-1",
        "page-1:whole",
        1,
        json!({"underlines":0,"dots":0,"extensions":0}),
    );
    notes["measures"][0]["notes"][0]["tieFrom"] = json!("missing-note");
    assert!(s.apply(&notes).is_err());
    let checks = s.apply(&json!({"tool":"validate"})).unwrap();
    assert_eq!(checks["valid"], false);
    next(&mut s);
    assert!(s.apply(&json!({"tool":"finish","pages":[{"sourceId":"page-1","complete":true},{"sourceId":"page-2","complete":false,"note":"Unvisited"}]})).is_err());
}

#[test]
fn malformed_submission_is_atomic_and_never_erases_valid_evidence() {
    let mut s = state();
    view(&mut s, "page-1");
    s.apply(&submit(
        "m-one",
        "page-1",
        "page-1:whole",
        1,
        json!({"underlines":1,"dots":1,"extensions":0}),
    ))
    .unwrap();
    let old = s.package();
    let mut invalid = submit(
        "m-one",
        "page-1",
        "page-1:whole",
        1,
        json!({"underlines":0,"dots":0,"extensions":0}),
    );
    invalid["measures"][0]["notes"][0]["degree"] = json!(null);
    assert!(s.apply(&invalid).is_err());
    assert_eq!(s.package(), old);
    invalid["measures"][0]["notes"][0]["uncertain"] = json!(true);
    s.apply(&invalid).unwrap();
    assert_eq!(
        s.package()["measures"][0]["notes"][0]["degree"],
        Value::Null
    );
}

#[test]
fn request_and_token_budget_cannot_wrap_or_be_reused_after_finish() {
    let limits = Limits {
        max_requests: 2,
        max_tokens: 150,
        ..Limits::default()
    };
    let mut s = AgentState::new(manifest(), limits).unwrap();
    s.begin_request(100).unwrap();
    assert!(s.begin_request(u64::MAX).is_err());
    assert_eq!(s.requests, 1);
    s.begin_request(50).unwrap();
    assert!(s.begin_request(0).is_err());
    assert_eq!(s.tokens, 150);
}

#[test]
fn token_budget_rejects_overflow_even_when_limit_is_u64_max() {
    let mut s = AgentState::new(
        manifest(),
        Limits {
            max_tokens: u64::MAX,
            ..Limits::default()
        },
    )
    .unwrap();
    s.begin_request(u64::MAX).unwrap();
    assert!(s.begin_request(1).is_err());
    assert_eq!(s.requests, 1);
    assert_eq!(s.tokens, u64::MAX);
}

#[test]
fn observed_phrase_can_span_barlines_and_a_tie_has_no_second_attack() {
    let mut s = state();
    view(&mut s, "page-1");
    let mut first = submit(
        "bar-a",
        "page-1",
        "page-1:whole",
        1,
        json!({"underlines":0,"dots":0,"extensions":0}),
    );
    first["measures"][0]["phraseId"] = json!("visible-phrase");
    let mut second = submit(
        "bar-b",
        "page-1",
        "page-1:whole",
        2,
        json!({"underlines":1,"dots":0,"extensions":0}),
    );
    second["measures"][0]["phraseId"] = json!("visible-phrase");
    second["measures"][0]["notes"][0]["tieFrom"] = json!("bar-a-n");
    s.apply(&first).unwrap();
    s.apply(&second).unwrap();
    let package = s.package();
    assert_eq!(package["phrases"].as_array().unwrap().len(), 1);
    let compiled = music_practice::score_package::compile(
        &package,
        &music_practice::score::empty(),
        &Default::default(),
    )
    .unwrap();
    assert_eq!(compiled.score["notes"].as_array().unwrap().len(), 1);
    assert_eq!(
        compiled.score["notes"][0]["durationFraction"],
        json!([3, 2])
    );
    assert_eq!(compiled.score["measures"].as_array().unwrap().len(), 2);
}

#[test]
fn replacement_invalidates_both_host_validation_and_visual_review() {
    let mut s = state();
    view(&mut s, "page-1");
    s.apply(&submit(
        "bar-a",
        "page-1",
        "page-1:whole",
        1,
        json!({"underlines":0,"dots":0,"extensions":0}),
    ))
    .unwrap();
    s.apply(&json!({"tool":"validate"})).unwrap();
    next(&mut s);
    s.apply(&json!({"tool":"review","measureIds":["bar-a"]}))
        .unwrap();
    next(&mut s);
    s.apply(&submit(
        "bar-a",
        "page-1",
        "page-1:whole",
        1,
        json!({"underlines":1,"dots":0,"extensions":0}),
    ))
    .unwrap();
    assert!(s.checks["valid"].is_null());
    assert!(s.apply(&json!({"tool":"finish","pages":[{"sourceId":"page-1","complete":true},{"sourceId":"page-2","complete":false,"note":"Unreadable"}]})).is_err());
}

// The only substituted boundary is the external vision provider. Persistence,
// image tools, arithmetic and compiler are the real production implementations.
async fn fixture_run(
    responses: Vec<Value>,
) -> (
    tempfile::TempDir,
    music_practice::server::Shared,
    Value,
    Value,
) {
    fixture_run_lyrics(responses, None).await
}

async fn fixture_run_lyrics(
    responses: Vec<Value>,
    lyrics: Option<&str>,
) -> (
    tempfile::TempDir,
    music_practice::server::Shared,
    Value,
    Value,
) {
    use axum::{Json, Router, routing::post};
    use music_practice::{server::AppState, store::Store};
    use std::{
        collections::{HashMap, VecDeque},
        sync::{Arc, Mutex},
    };
    let responses = Arc::new(Mutex::new(VecDeque::from(responses)));
    let handler = responses.clone();
    let router=Router::new().route("/v1/chat/completions",post(move |Json(_request):Json<Value>| {
        let handler=handler.clone();
        async move {
            let content=handler.lock().unwrap().pop_front().unwrap_or(json!({"actions":[{"tool":"shell","command":"inert untrusted text"}]}));
            Json(content.get("_providerEnvelope").cloned().unwrap_or_else(||json!({"choices":[{"finish_reason":"stop","message":{"content":content.to_string()}}]})))
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("assets")).unwrap();
    let shared = Arc::new(AppState {
        store: Store::open(&dir.path().join("library.sqlite3")).unwrap(),
        root: dir.path().to_path_buf(),
        keys: Mutex::new(HashMap::new()),
        inference: tokio::sync::Semaphore::new(1),
    });
    let song = shared.store.create("Synthetic unseen score", "").unwrap();
    let aid = uuid::Uuid::new_v4().to_string();
    image::RgbImage::from_pixel(213, 157, image::Rgb([255, 255, 255]))
        .save_with_format(
            dir.path().join("assets").join(&aid),
            image::ImageFormat::Png,
        )
        .unwrap();
    let asset = json!({"id":aid,"kind":"score","name":"synthetic.png","mime":"image/png"});
    let song = shared
        .store
        .add_asset(song["id"].as_str().unwrap(), &asset)
        .unwrap();
    let mut job = json!({"id":uuid::Uuid::new_v4().to_string(),"songId":song["id"],"baseRevision":song["revision"],"status":"queued","createdAt":"synthetic"});
    if let Some(lyrics) = lyrics {
        job["lyricsText"] = json!(lyrics);
    }
    music_practice::recognition_agent::run(shared.clone(),song.clone(),vec![asset],json!({"id":"fixture","baseUrl":format!("http://{address}/v1"),"model":"synthetic","timeoutSeconds":5}),job).await;
    task.abort();
    let saved = shared
        .store
        .jobs(Some(song["id"].as_str().unwrap()))
        .unwrap()
        .remove(0);
    (dir, shared, song, saved)
}

#[tokio::test]
async fn provider_tool_loop_retains_exact_evidence_and_never_changes_the_song() {
    let symbols = submit(
        "fixture-measure",
        "page-1",
        "crop-a",
        1,
        json!({"underlines":1,"dots":1,"extensions":0}),
    );
    let (_dir,shared,song,job)=fixture_run(vec![
        json!({"actions":[{"tool":"inspect_page","sourceId":"page-1"}]}),
        json!({"actions":[{"tool":"inspect_crop","sourceId":"page-1","regionId":"crop-a","bounds":[9,11,180,100]}]}),
        json!({"actions":[symbols]}),
        json!({"actions":[{"tool":"validate"}]}),
        json!({"actions":[{"tool":"review","measureIds":["fixture-measure"]}]}),
        json!({"actions":[{"tool":"finish","pages":[{"sourceId":"page-1","complete":true}]}]})
    ]).await;
    assert_eq!(job["status"], "review", "{}", job);
    assert_eq!(job["coverageComplete"], true);
    assert_eq!(
        job["sourcePackage"]["measures"][0]["notes"][0]["duration"],
        json!([3, 4])
    );
    assert_eq!(job["draft"]["notes"][0]["duration"], 0.75);
    assert_eq!(job["counters"]["requests"], 6);
    assert!(
        job["trace"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["action"]["tool"] == "review")
    );
    assert!(job["checks"][0]["valid"].as_bool().unwrap());
    assert!(job["pages"][0]["originalSha256"].as_str().is_some());
    assert!(
        job["trace"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["kind"] == "image-presented"
                && entry["evidence"]["bounds"] == json!([9, 11, 180, 100]))
    );
    assert_eq!(
        shared.store.get(song["id"].as_str().unwrap()).unwrap(),
        song
    );
}

#[tokio::test]
async fn adversarial_provider_tools_stop_at_finite_retries_with_partial_symbols_preserved() {
    let (_dir,shared,song,job)=fixture_run(vec![
        json!({"actions":[{"tool":"inspect_page","sourceId":"page-1"}]}),
        json!({"actions":[submit("keep-me","page-1","page-1:whole",1,json!({"underlines":2,"dots":0,"extensions":0}))]}),
    ]).await;
    assert_eq!(job["status"], "failed");
    assert_eq!(job["sourcePackage"]["measures"][0]["id"], "keep-me");
    assert!(
        job["counters"]["requests"].as_u64().unwrap() <= Limits::default().max_retries as u64 + 3
    );
    assert!(
        job["trace"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["ok"] == false)
    );
    assert_eq!(
        shared.store.get(song["id"].as_str().unwrap()).unwrap(),
        song
    );
}

#[tokio::test]
async fn oversized_provider_reply_is_rejected_before_any_embedded_tool_runs() {
    let (_dir,shared,song,job)=fixture_run(vec![json!({"actions":[{"tool":"inspect_page","sourceId":"page-1"}],"continuation":"x".repeat(270_000)})]).await;
    assert_eq!(job["status"], "failed");
    assert_eq!(job["sourcePackage"]["measures"], json!([]));
    assert!(
        job["trace"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["kind"] == "provider-error"
                && entry["error"].as_str().unwrap().contains("256KB"))
    );
    assert!(
        !job["trace"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["action"]["tool"] == "inspect_page")
    );
    assert_eq!(
        shared.store.get(song["id"].as_str().unwrap()).unwrap(),
        song
    );
}

#[tokio::test]
async fn truncated_provider_output_cannot_execute_a_valid_looking_action() {
    let response = json!({"choices":[{"finish_reason":"length","message":{"content":json!({"actions":[{"tool":"inspect_page","sourceId":"page-1"}]}).to_string()}}]});
    let (_dir, _shared, _song, job) =
        fixture_run(vec![json!({"_providerEnvelope":response})]).await;
    assert_eq!(job["status"], "failed");
    assert!(
        !job["trace"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["action"]["tool"] == "inspect_page")
    );
    assert!(job["trace"].as_array().unwrap().iter().any(|entry| {
        entry["error"]
            .as_str()
            .is_some_and(|text| text.contains("incomplete"))
    }));
}

#[tokio::test]
async fn invalid_tool_can_be_corrected_with_targeted_symbols_within_budget() {
    let mut wrong = submit(
        "fixture-measure",
        "page-1",
        "page-1:whole",
        1,
        json!({"underlines":1,"dots":0,"extensions":0}),
    );
    wrong["measures"][0]["notes"][0]["duration"] = json!([99, 1]);
    let (_dir,_shared,_song,job)=fixture_run(vec![
        json!({"actions":[{"tool":"inspect_page","sourceId":"page-1"}]}),
        json!({"actions":[wrong]}),
        json!({"actions":[submit("fixture-measure","page-1","page-1:whole",1,json!({"underlines":1,"dots":0,"extensions":0}))]}),
        json!({"actions":[{"tool":"validate"}]}),
        json!({"actions":[{"tool":"review","measureIds":["fixture-measure"]}]}),
        json!({"actions":[{"tool":"finish","pages":[{"sourceId":"page-1","complete":true}]}]})
    ]).await;
    assert_eq!(job["status"], "review", "{job}");
    assert_eq!(job["counters"]["retries"], 1);
    assert_eq!(
        job["sourcePackage"]["measures"][0]["notes"][0]["duration"],
        json!([1, 2])
    );
}

#[tokio::test]
async fn preprocessing_failure_still_exposes_empty_ledger_and_never_claims_coverage() {
    use music_practice::{server::AppState, store::Store};
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex},
    };
    let dir = tempfile::tempdir().unwrap();
    let shared = Arc::new(AppState {
        store: Store::open(&dir.path().join("library.sqlite3")).unwrap(),
        root: dir.path().to_path_buf(),
        keys: Mutex::new(HashMap::new()),
        inference: tokio::sync::Semaphore::new(1),
    });
    let song = shared.store.create("No image fixture", "").unwrap();
    let job =
        json!({"id":uuid::Uuid::new_v4().to_string(),"songId":song["id"],"createdAt":"synthetic"});
    music_practice::recognition_agent::run(shared.clone(), song.clone(), vec![], json!({}), job)
        .await;
    let saved = shared
        .store
        .jobs(Some(song["id"].as_str().unwrap()))
        .unwrap()
        .remove(0);
    assert_eq!(saved["status"], "failed");
    assert_eq!(saved["counters"]["requests"], 0);
    assert_eq!(saved["sourcePackage"]["format"], "shengjian.score");
    assert_eq!(saved["coverageComplete"], false);
    assert_eq!(saved["partial"], true);
    assert_eq!(
        shared.store.get(song["id"].as_str().unwrap()).unwrap(),
        song
    );
}

#[tokio::test]
async fn manual_lyrics_are_read_as_bounded_data_and_retained_without_song_writes() {
    let mut symbols = submit(
        "fixture-measure",
        "page-1",
        "page-1:whole",
        1,
        json!({"underlines":1,"dots":0,"extensions":0}),
    );
    symbols["measures"][0]["notes"][0]["lyric"] = json!("风");
    let (_dir, shared, song, job) = fixture_run_lyrics(
        vec![
            json!({"actions":[{"tool":"read_lyrics","start":0,"limit":2}]}),
            json!({"actions":[{"tool":"inspect_page","sourceId":"page-1"}]}),
            json!({"actions":[symbols]}),
            json!({"actions":[{"tool":"validate"}]}),
            json!({"actions":[{"tool":"review","measureIds":["fixture-measure"]}]}),
            json!({"actions":[{"tool":"finish","pages":[{"sourceId":"page-1","complete":true}]}]}),
        ],
        Some("风🙂\n山"),
    )
    .await;
    assert_eq!(job["status"], "review", "{job}");
    let read = job["trace"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["action"]["tool"] == "read_lyrics")
        .unwrap();
    assert_eq!(read["result"]["text"], "风🙂");
    assert_eq!(read["result"]["nextStart"], 2);
    assert_eq!(read["result"]["totalChars"], 4);
    assert_eq!(read["result"]["hasMore"], true);
    assert_eq!(job["sourcePackage"]["measures"][0]["notes"][0]["degree"], 3);
    assert_eq!(
        job["sourcePackage"]["measures"][0]["notes"][0]["duration"],
        json!([1, 2])
    );
    assert_eq!(job["lyricsText"], "风🙂\n山");
    assert_eq!(job["sourceMapping"]["page-1"], song["assets"][0]["id"]);
    assert_eq!(
        shared.store.get(song["id"].as_str().unwrap()).unwrap(),
        song
    );
}
