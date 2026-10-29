use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use music_practice::store::Store;
use serde_json::{Value, json};
use tower::ServiceExt;

async fn call(app: &Router, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("host", "127.0.0.1:3210")
                .header("x-music-client", "web")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn archived_delete_hides_all_access_and_restore_preserves_files_history_and_metadata() {
    let dir = tempfile::tempdir().unwrap();
    let db = Store::open(&dir.path().join("library.sqlite3")).unwrap();
    let song = db.create("recoverable fixture", "artist").unwrap();
    let sid = song["id"].as_str().unwrap();
    let aid = uuid::Uuid::new_v4().to_string();
    std::fs::create_dir(dir.path().join("assets")).unwrap();
    let file = dir.path().join("assets").join(&aid);
    std::fs::write(&file, b"fixture binary").unwrap();
    db.add_asset(sid,&json!({"id":aid,"kind":"audio","name":"source.wav","mime":"audio/wav","url":format!("/assets/{aid}")})).unwrap();
    let song=db.update(sid,&json!({"revision":2,"archived":true,"lyricsText":"keep me","tags":["练习"],"score":{"bpm":100,"key":"C","timeSignature":[4,4],"status":"corrected","notes":[],"phrases":[]}})).unwrap();
    let history = db.history(sid).unwrap();
    drop(db);
    let app = music_practice::server::app(dir.path());
    let (status, deleted) = call(
        &app,
        "POST",
        &format!("/api/songs/{sid}/delete"),
        json!({"revision":3}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(deleted["deletedAt"].is_string());
    assert_eq!(deleted["revision"], 4);
    assert_eq!(
        call(&app, "GET", "/api/songs", Value::Null).await.1,
        json!([])
    );
    for path in [
        format!("/api/songs/{sid}"),
        format!("/assets/{aid}"),
        format!("/api/songs/{sid}/history"),
        format!("/api/songs/{sid}/jobs"),
    ] {
        assert_eq!(
            call(&app, "GET", &path, Value::Null).await.0,
            StatusCode::NOT_FOUND,
            "{path}"
        );
    }
    assert_eq!(
        call(
            &app,
            "PATCH",
            &format!("/api/songs/{sid}"),
            json!({"revision":4,"title":"no"})
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/api/songs/{sid}/recognize"),
            json!({})
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert!(file.exists());
    let trash = call(&app, "GET", "/api/trash", Value::Null).await.1;
    assert_eq!(trash[0]["id"], sid);
    assert_eq!(trash[0]["lyricsText"], "keep me");
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/api/trash/{sid}/restore"),
            json!({"revision":3})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let (status, restored) = call(
        &app,
        "POST",
        &format!("/api/trash/{sid}/restore"),
        json!({"revision":4}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(restored.get("deletedAt").is_none());
    assert_eq!(restored["archived"], true);
    assert_eq!(restored["revision"], 5);
    for field in ["score", "lyricsText", "tags", "assets", "artist"] {
        assert_eq!(restored[field], song[field]);
    }
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/api/songs/{sid}/history"),
            Value::Null
        )
        .await
        .1,
        history
    );
    assert_eq!(
        call(&app, "GET", &format!("/assets/{aid}"), Value::Null)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(std::fs::read(&file).unwrap(), b"fixture binary");
    assert_eq!(
        call(&app, "GET", "/api/trash", Value::Null).await.1,
        json!([])
    );
}

#[tokio::test]
async fn deletion_rejects_active_stale_and_busy_songs_and_database_failure_rolls_back() {
    let dir = tempfile::tempdir().unwrap();
    let app = music_practice::server::app(dir.path());
    let song = call(&app, "POST", "/api/songs", json!({"title":"checks"}))
        .await
        .1;
    let sid = song["id"].as_str().unwrap();
    let path = format!("/api/songs/{sid}/delete");
    assert_eq!(
        call(&app, "POST", &path, json!({"revision":1})).await.0,
        StatusCode::BAD_REQUEST
    );
    call(
        &app,
        "PATCH",
        &format!("/api/songs/{sid}"),
        json!({"revision":1,"archived":true}),
    )
    .await;
    assert_eq!(
        call(&app, "POST", &path, json!({"revision":1})).await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(&app, "POST", &path, json!({})).await.0,
        StatusCode::BAD_REQUEST
    );
    let sql = rusqlite::Connection::open(dir.path().join("library.sqlite3")).unwrap();
    for status in ["queued", "running"] {
        sql.execute(
            "INSERT OR REPLACE INTO jobs VALUES('busy',?1,?2)",
            rusqlite::params![
                sid,
                json!({"id":"busy","songId":sid,"status":status}).to_string()
            ],
        )
        .unwrap();
        assert_eq!(
            call(&app, "POST", &path, json!({"revision":2})).await.0,
            StatusCode::CONFLICT
        );
    }
    sql.execute("DELETE FROM jobs WHERE id='busy'", []).unwrap();
    sql.execute_batch("CREATE TRIGGER reject_delete BEFORE UPDATE ON songs WHEN json_extract(NEW.doc,'$.deletedAt') IS NOT NULL BEGIN SELECT RAISE(FAIL,'fixture'); END;").unwrap();
    assert_eq!(
        call(&app, "POST", &path, json!({"revision":2})).await.0,
        StatusCode::BAD_REQUEST
    );
    let after = call(&app, "GET", &format!("/api/songs/{sid}"), Value::Null)
        .await
        .1;
    assert_eq!(after["revision"], 2);
    assert!(after.get("deletedAt").is_none());
    assert_eq!(
        call(&app, "GET", "/api/trash", Value::Null).await.1,
        json!([])
    );
}

#[tokio::test]
async fn failed_upload_metadata_transaction_removes_only_its_new_uuid_file() {
    let dir = tempfile::tempdir().unwrap();
    let app = music_practice::server::app(dir.path());
    let song = call(
        &app,
        "POST",
        "/api/songs",
        json!({"title":"upload fixture"}),
    )
    .await
    .1;
    let sid = song["id"].as_str().unwrap();
    let mut wav = vec![0u8; 44];
    wav[..4].copy_from_slice(b"RIFF");
    wav[8..12].copy_from_slice(b"WAVE");
    let upload = || {
        Request::builder()
            .method("POST")
            .uri(format!("/api/songs/{sid}/assets?kind=audio"))
            .header("host", "127.0.0.1:3210")
            .header("x-music-client", "web")
            .header("content-type", "audio/wav")
            .header("x-file-name", "fixture.wav")
            .body(Body::from(wav.clone()))
            .unwrap()
    };
    let response = app.clone().oneshot(upload()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let original: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    let asset = original["assets"][0]["id"].as_str().unwrap();
    let sql = rusqlite::Connection::open(dir.path().join("library.sqlite3")).unwrap();
    sql.execute_batch("CREATE TRIGGER reject_upload BEFORE INSERT ON assets BEGIN SELECT RAISE(FAIL,'fixture failure'); END;").unwrap();
    let response = app.clone().oneshot(upload()).await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let files: Vec<_> = std::fs::read_dir(dir.path().join("assets"))
        .unwrap()
        .map(|f| f.unwrap().file_name())
        .collect();
    assert_eq!(
        files.len(),
        1,
        "failed transaction must not leave an untracked uploaded file"
    );
    assert_eq!(files[0].to_str().unwrap(), asset);
    assert_eq!(
        std::fs::read(dir.path().join("assets").join(asset)).unwrap(),
        wav
    );
    assert_eq!(
        call(&app, "GET", &format!("/api/songs/{sid}"), Value::Null)
            .await
            .1,
        original
    );
}
