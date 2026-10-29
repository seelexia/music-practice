use music_practice::store::Store;
use serde_json::{Value, json};

fn review_job(db: &Store) -> (String, String) {
    let song = db.create("atomic review", "").unwrap();
    let song_id = song["id"].as_str().unwrap().to_string();
    let score = json!({"bpm":120,"key":"C","timeSignature":[4,4],"status":"review",
        "phrases":[{"id":"page-p0","label":"fixture"}],
        "notes":[{"id":"page-n0","beat":0,"duration":1,"midi":60,"lyric":"一","phraseId":"page-p0","sourcePage":"page"}]});
    let job = json!({"id":"review-job","songId":song_id,"status":"review","baseRevision":1,
        "draft":score,"overlaps":[],"pages":[{"sourcePage":"page","noteOffset":0,"beatOffset":0,"draft":score}]});
    db.save_job(&job).unwrap();
    (song_id, "review-job".to_string())
}

async fn job_request(
    root: &std::path::Path,
    song: &str,
    job: &str,
    action: &str,
    body: Value,
) -> axum::response::Response {
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;
    music_practice::server::app(root)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/songs/{song}/jobs/{job}/{action}"))
                .header("host", "127.0.0.1:3210")
                .header("x-music-client", "web")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn failed_job_status_write_rolls_back_song_and_history() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.sqlite3");
    let db = Store::open(&path).unwrap();
    let (song, job) = review_job(&db);
    let sql = rusqlite::Connection::open(&path).unwrap();
    sql.execute_batch("CREATE TRIGGER fail_applied_job BEFORE INSERT ON jobs WHEN json_extract(NEW.doc,'$.status')='applied' BEGIN SELECT RAISE(FAIL,'fixture job write failed'); END;").unwrap();
    let response = job_request(dir.path(), &song, &job, "apply", json!({"revision":1})).await;
    assert_eq!(response.status(), axum::http::StatusCode::BAD_REQUEST);
    assert_eq!(
        db.get(&song).unwrap()["revision"],
        1,
        "failed apply must preserve song revision"
    );
    assert_eq!(db.get(&song).unwrap()["score"]["notes"], json!([]));
    assert_eq!(db.history(&song).unwrap(), json!([]));
    assert_eq!(db.jobs(Some(&song)).unwrap()[0]["status"], "review");
}

#[tokio::test]
async fn applied_job_recheck_preserves_status_song_and_history() {
    let dir = tempfile::tempdir().unwrap();
    let db = Store::open(&dir.path().join("library.sqlite3")).unwrap();
    let (song, job) = review_job(&db);
    assert_eq!(
        job_request(dir.path(), &song, &job, "apply", json!({"revision":1}))
            .await
            .status(),
        axum::http::StatusCode::OK
    );
    assert_eq!(db.get(&song).unwrap()["revision"], 2);
    assert_eq!(db.get(&song).unwrap()["score"]["notes"][0]["midi"], 60);
    assert_eq!(db.history(&song).unwrap()[0]["revision"], 1);
    assert_eq!(db.history(&song).unwrap()[0]["score"]["notes"], json!([]));
    assert_eq!(
        job_request(dir.path(), &song, &job, "recheck", json!({}))
            .await
            .status(),
        axum::http::StatusCode::OK
    );
    assert_eq!(db.jobs(Some(&song)).unwrap()[0]["status"], "applied");
    assert_eq!(db.get(&song).unwrap()["revision"], 2);
    assert_eq!(db.history(&song).unwrap().as_array().unwrap().len(), 1);
    assert_eq!(
        job_request(dir.path(), &song, &job, "apply", json!({"revision":1}))
            .await
            .status(),
        axum::http::StatusCode::BAD_REQUEST
    );
    assert_eq!(db.get(&song).unwrap()["revision"], 2);
}

#[tokio::test]
async fn stale_apply_preserves_manual_song_history_and_job() {
    let dir = tempfile::tempdir().unwrap();
    let db = Store::open(&dir.path().join("library.sqlite3")).unwrap();
    let (song, job) = review_job(&db);
    db.update(&song, &json!({"revision":1,"title":"manually updated"}))
        .unwrap();
    let before = db.get(&song).unwrap();
    for revision in [1, 2] {
        assert_eq!(
            job_request(
                dir.path(),
                &song,
                &job,
                "apply",
                json!({"revision":revision})
            )
            .await
            .status(),
            axum::http::StatusCode::CONFLICT
        );
        assert_eq!(db.get(&song).unwrap(), before);
        assert_eq!(db.history(&song).unwrap(), json!([]));
        assert_eq!(db.jobs(Some(&song)).unwrap()[0]["status"], "review");
    }
}

#[test]
fn concurrent_rechecks_cannot_regress_applied_job_status() {
    use std::sync::{Arc, Barrier};
    let dir = tempfile::tempdir().unwrap();
    let db = Arc::new(Store::open(&dir.path().join("library.sqlite3")).unwrap());
    let (song, job) = review_job(&db);
    let start = Arc::new(Barrier::new(3));
    let rechecks: Vec<_> = (0..2)
        .map(|_| {
            let db = Arc::clone(&db);
            let start = Arc::clone(&start);
            let (song, job) = (song.clone(), job.clone());
            std::thread::spawn(move || {
                start.wait();
                for _ in 0..40 {
                    db.recheck_job(&song, &job).unwrap();
                }
            })
        })
        .collect();
    start.wait();
    let applied = db.apply_job(&song, &job, &json!({"revision":1})).unwrap();
    for recheck in rechecks {
        recheck.join().unwrap();
    }
    assert_eq!(applied["revision"], 2);
    assert_eq!(db.jobs(Some(&song)).unwrap()[0]["status"], "applied");
    assert_eq!(db.get(&song).unwrap()["revision"], 2);
    assert_eq!(db.history(&song).unwrap().as_array().unwrap().len(), 1);
}
#[test]
fn saves_reopens_and_conflicts_instead_of_losing_edits() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.db");
    let db = Store::open(&path).unwrap();
    let s = db.create("昔涟", "张韶涵").unwrap();
    let id = s["id"].as_str().unwrap();
    let edited = db
        .update(id, &json!({"revision":1,"album":"测试"}))
        .unwrap();
    assert_eq!(edited["revision"], 2);
    assert!(
        db.update(id, &json!({"revision":1,"title":"过期页面"}))
            .unwrap_err()
            .contains("409")
    );
    drop(db);
    let db = Store::open(&path).unwrap();
    assert_eq!(db.get(id).unwrap()["album"], "测试");
}
#[test]
fn invalid_patch_does_not_change_song() {
    let d = tempfile::tempdir().unwrap();
    let db = Store::open(&d.path().join("library.db")).unwrap();
    let s = db.create("歌", "").unwrap();
    let id = s["id"].as_str().unwrap();
    assert!(db.update(id, &json!({"revision":1,"title":""})).is_err());
    assert!(
        db.update(
            id,
            &json!({"revision":1,"links":{"bilibili":"javascript:alert(1)","qq":"","netease":""}})
        )
        .is_err()
    );
    assert_eq!(db.get(id).unwrap()["revision"], 1);
    assert_eq!(db.get(id).unwrap()["title"], "歌");
}
#[test]
fn asset_archive_restores_original_and_order_is_versioned() {
    let d = tempfile::tempdir().unwrap();
    let db = Store::open(&d.path().join("library.db")).unwrap();
    let s = db.create("order", "").unwrap();
    let id = s["id"].as_str().unwrap();
    db.add_asset(id, &json!({"id":"a","kind":"score","name":"a.png"}))
        .unwrap();
    db.add_asset(id, &json!({"id":"b","kind":"score","name":"b.png"}))
        .unwrap();
    let s = db
        .manage_asset(id, "b", &json!({"revision":3,"move":"up"}))
        .unwrap();
    assert_eq!(s["assets"][0]["id"], "b");
    assert!(
        db.manage_asset(id, "a", &json!({"revision":3,"archived":true}))
            .is_err()
    );
    let s = db
        .manage_asset(id, "b", &json!({"revision":4,"archived":true}))
        .unwrap();
    assert_eq!(s["assets"].as_array().unwrap().len(), 1);
    assert_eq!(s["archivedAssets"][0]["id"], "b");
    assert_eq!(db.asset("b").unwrap()["name"], "b.png");
    let s = db
        .manage_asset(id, "b", &json!({"revision":5,"archived":false}))
        .unwrap();
    assert_eq!(s["assets"].as_array().unwrap().len(), 2);
    assert!(s["archivedAssets"].as_array().unwrap().is_empty());
}
