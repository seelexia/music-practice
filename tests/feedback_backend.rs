use music_practice::{recognition::parse_page, store::Store};
use serde_json::json;

fn lyric_score() -> serde_json::Value {
    json!({"bpm":80,"key":"C","timeSignature":[4,4],"status":"reviewed","phrases":[{"id":"old","label":"incorrect"}],"notes":[
        {"id":"a","beat":0,"duration":0.5,"midi":60,"lyric":"错","phraseId":"old"},
        {"id":"b","beat":0.5,"duration":1.5,"midi":62,"lyric":"字","phraseId":"old"},
        {"id":"c","beat":2,"duration":2,"midi":64,"lyric":"啊","phraseId":"old"}
    ]})
}

#[test]
fn lyric_alignment_preserves_timing_and_rejects_invented_or_out_of_order_words() {
    use music_practice::recognition::{parse_lyrics_alignment, validate_lyrics_only};
    let score = lyric_score();
    let output = json!({"phrases":[{"start":0,"end":2,"lyrics":[[0,"你"],[1,"好"]]},{"start":2,"end":3,"lyrics":[[2,"世界"]]}]});
    let draft = parse_lyrics_alignment(&output.to_string(), &score, "你好\n世界").unwrap();
    validate_lyrics_only(&score, &draft).unwrap();
    assert_eq!(draft["phrases"][1]["label"], "世界");
    for (old, new) in score["notes"]
        .as_array()
        .unwrap()
        .iter()
        .zip(draft["notes"].as_array().unwrap())
    {
        for field in ["id", "beat", "duration", "midi"] {
            assert_eq!(old[field], new[field]);
        }
    }
    for bad in [
        json!({"phrases":[{"start":0,"end":3,"lyrics":[[0,"你好世界外"]]}]}),
        json!({"phrases":[{"start":0,"end":3,"lyrics":[[2,"你好"],[1,"世界"]]}]}),
    ] {
        assert!(parse_lyrics_alignment(&bad.to_string(), &score, "你好世界").is_err());
    }
    let mut changed = draft.clone();
    changed["notes"][0]["duration"] = json!(1);
    assert!(validate_lyrics_only(&score, &changed).is_err());
}

#[test]
fn lyric_job_applies_text_and_score_together_and_protects_manual_revision() {
    let dir = tempfile::tempdir().unwrap();
    let db = Store::open(&dir.path().join("test.db")).unwrap();
    let s = db.create("fixture", "").unwrap();
    let id = s["id"].as_str().unwrap();
    let s = db
        .update(id, &json!({"revision":1,"score":lyric_score()}))
        .unwrap();
    let draft = music_practice::recognition::parse_lyrics_alignment(
        &json!({"phrases":[{"start":0,"end":3,"lyrics":[[0,"你"],[1,"好"]]}]}).to_string(),
        &s["score"],
        "你好",
    )
    .unwrap();
    let job = json!({"id":"lyrics-job","songId":id,"status":"review","mode":"lyrics","baseRevision":2,"lyricsText":"你好","draft":draft});
    db.save_job(&job).unwrap();
    let applied = db
        .apply_job(id, "lyrics-job", &json!({"revision":2}))
        .unwrap();
    assert_eq!(applied["lyricsText"], "你好");
    assert_eq!(applied["score"]["notes"][0]["lyric"], "你");
    assert_eq!(db.jobs(Some(id)).unwrap()[0]["status"], "applied");
}

#[test]
fn recording_deletion_rejects_wrong_song_kind_path_and_stale_revision() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("assets")).unwrap();
    let db = Store::open(&dir.path().join("test.db")).unwrap();
    let s = db.create("fixture", "").unwrap();
    let id = s["id"].as_str().unwrap();
    let aid = uuid::Uuid::new_v4().to_string();
    let path = dir.path().join("assets").join(&aid);
    std::fs::write(&path, b"recording fixture").unwrap();
    db.add_asset(
        id,
        &json!({"id":aid,"kind":"recording","name":"test","url":format!("/assets/{aid}")}),
    )
    .unwrap();
    assert!(db.delete_recording(dir.path(), id, &aid, 1).is_err());
    assert!(path.exists());
    let other = db.create("foreign", "").unwrap();
    assert!(
        db.delete_recording(dir.path(), other["id"].as_str().unwrap(), &aid, 1)
            .is_err()
    );
    assert!(path.exists());
    assert!(
        db.delete_recording(dir.path(), id, "../test.db", 2)
            .is_err()
    );
    let updated = db.delete_recording(dir.path(), id, &aid, 2).unwrap();
    assert_eq!(updated["assets"], json!([]));
    assert!(!path.exists());
    assert!(db.asset(&aid).is_err());
}

#[test]
fn recording_deletion_rolls_back_file_and_database_on_database_error_and_rejects_source_audio() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("assets")).unwrap();
    let path = dir.path().join("test.db");
    let db = Store::open(&path).unwrap();
    let song = db.create("fixture", "").unwrap();
    let sid = song["id"].as_str().unwrap();
    let recording = uuid::Uuid::new_v4().to_string();
    let source = uuid::Uuid::new_v4().to_string();
    for (id, kind) in [(&recording, "recording"), (&source, "audio")] {
        std::fs::write(dir.path().join("assets").join(id), b"fixture").unwrap();
        db.add_asset(sid, &json!({"id":id,"kind":kind})).unwrap();
    }
    assert!(db.delete_recording(dir.path(), sid, &source, 3).is_err());
    assert!(dir.path().join("assets").join(&source).exists());
    let sql = rusqlite::Connection::open(path).unwrap();
    sql.execute_batch("CREATE TRIGGER fail_song_update BEFORE UPDATE ON songs BEGIN SELECT RAISE(FAIL,'fixture failure'); END;").unwrap();
    assert!(db.delete_recording(dir.path(), sid, &recording, 3).is_err());
    assert!(dir.path().join("assets").join(&recording).exists());
    assert!(db.asset(&recording).is_ok());
    assert_eq!(db.get(sid).unwrap()["revision"], 3);
}

#[test]
fn accepts_mobile_qq_link_and_manual_lyrics_with_revision_guard() {
    let dir = tempfile::tempdir().unwrap();
    let db = Store::open(&dir.path().join("test.db")).unwrap();
    let s = db.create("fixture", "").unwrap();
    let song = s["id"].as_str().unwrap();
    let out = db.update(song, &json!({"revision":1,"lyricsText":"你好\n世界","links":{"bilibili":"","qq":"https://i.y.qq.com/v8/playsong.html?songid=614799549#webchat_redirect","netease":"https://music.163.com/#/song?id=123"}})).unwrap();
    assert_eq!(out["lyricsText"], "你好\n世界");
    assert!(
        db.update(song, &json!({"revision":2,"lyricsText":"字".repeat(20001)}))
            .is_err()
    );
    assert!(
        db.update(song, &json!({"revision":1,"lyricsText":"stale"}))
            .is_err()
    );
}

#[test]
fn reads_printed_measures_without_rescaling_wrong_duration() {
    let page = parse_page(
        &json!({"bpm":80,"key":"C","timeSignature":[4,4],"measures":[
            {"row":1,"notes":[[1,0,0.5,"你"],[2,0,0.5,"好"],[3,0,1,""],[4,0,2,""]]},
            {"row":1,"notes":[[5,0,0.5,"世"],[6,0,0.5,"界"]]}
        ]})
        .to_string(),
        "page-a",
    )
    .unwrap();
    assert_eq!(page["measures"][0]["duration"], 4.0);
    assert_eq!(page["measures"][1]["startBeat"], 4.0);
    assert_eq!(page["measures"][1]["duration"], 1.0);
    assert_eq!(page["notes"][4]["beat"], 4.0);
    assert_eq!(page["notes"][4]["duration"], 0.5);
    assert!(
        page["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w.as_str().unwrap().contains("小节"))
    );
}

#[test]
fn detects_music_rows_without_title_and_keeps_crop_margins() {
    let mut image = image::GrayImage::from_pixel(700, 1200, image::Luma([255]));
    for (from, to) in [(30, 210), (260, 310), (400, 450), (540, 590)] {
        for y in from..to {
            for x in 80..650 {
                image.put_pixel(x, y, image::Luma([0]));
            }
        }
    }
    let regions =
        music_practice::recognition::detect_score_regions(&image::DynamicImage::ImageLuma8(image));
    assert_eq!(regions.len(), 3);
    assert!(regions[0]["y"].as_u64().unwrap() < 260);
    assert!(regions[0]["y"].as_u64().unwrap() > 240);
    assert!(regions[0]["height"].as_u64().unwrap() > 50);
}

#[test]
fn split_title_and_credit_lines_are_not_mistaken_for_early_music() {
    // Same vertical geometry as the two supplied numbered-score pages: the title
    // and credits are separated by 14px, far closer than any musical rows.
    let mut image = image::GrayImage::from_pixel(727, 1307, image::Luma([255]));
    for (from, to) in [
        (39, 82),
        (95, 225),
        (263, 312),
        (378, 452),
        (500, 559),
        (621, 682),
        (743, 803),
        (866, 925),
        (979, 1047),
        (1101, 1169),
        (1231, 1291),
    ] {
        for y in from..to {
            for x in 80..650 {
                image.put_pixel(x, y, image::Luma([0]));
            }
        }
    }
    let regions =
        music_practice::recognition::detect_score_regions(&image::DynamicImage::ImageLuma8(image));
    assert_eq!(regions.len(), 9);
    assert_eq!(regions[0]["row"], 1);
    assert!(regions[0]["y"].as_u64().unwrap() < 263);
    assert!(regions[0]["y"].as_u64().unwrap() > 225);
    assert!(regions[8]["y"].as_u64().unwrap() <= 1231);
}

#[test]
fn continuation_page_with_early_music_row_uses_safe_full_page_fallback() {
    let mut image = image::GrayImage::from_pixel(700, 1200, image::Luma([255]));
    for (from, to) in [(80, 130), (300, 350), (500, 550), (700, 750)] {
        for y in from..to {
            for x in 80..650 {
                image.put_pixel(x, y, image::Luma([0]));
            }
        }
    }
    assert!(
        music_practice::recognition::detect_score_regions(&image::DynamicImage::ImageLuma8(image))
            .is_empty()
    );
}

#[test]
fn independently_checks_symbol_duration_and_flags_contradiction_without_rescaling() {
    let score = json!({"bpm":67,"key":"Bb","timeSignature":[4,4],"measures":[{"notes":[
        [3,0,0.5,"曾",false,{"u":1,"dots":0,"dashes":0}],
        [1,0,0.5,"许",false,{"u":1,"dots":0,"dashes":0}],
        [5,0,0.75,"下",false,{"u":1,"dots":1,"dashes":0}],
        [6,0,0.25,"心",false,{"u":2,"dots":0,"dashes":0}],
        [4,0,1.5,"愿",false,{"u":0,"dots":1,"dashes":0}],
        [2,0,0.25,"等",false,{"u":2,"dots":0,"dashes":0}],
        [3,0,0.25,"待",false,{"u":2,"dots":0,"dashes":0}]
    ]}]});
    let page = parse_page(&score.to_string(), "page-a").unwrap();
    assert_eq!(page["measures"][0]["duration"], 4.0);
    let mut bad = score.clone();
    bad["measures"][0]["notes"][5][5]["u"] = json!(1);
    let bad = parse_page(&bad.to_string(), "page-a").unwrap();
    assert_eq!(bad["notes"][5]["duration"], 0.25);
    assert_eq!(bad["notes"][5]["uncertain"], true);
    assert!(
        bad["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w.as_str().unwrap().contains("符号"))
    );
}
