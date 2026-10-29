use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
fn req(method: &str, path: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(path)
        .header("host", "127.0.0.1:3210")
        .header("x-music-client", "web")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}
async fn js(r: axum::response::Response) -> Value {
    serde_json::from_slice(&r.into_body().collect().await.unwrap().to_bytes()).unwrap()
}
#[tokio::test]
async fn external_import_is_review_only_and_versioned() {
    let d = tempfile::tempdir().unwrap();
    let app = music_practice::server::app(d.path());
    let song = js(app
        .clone()
        .oneshot(req(
            "POST",
            "/api/songs",
            json!({"title":"fixture-original","artist":"artist"}),
        ))
        .await
        .unwrap())
    .await;
    let id = song["id"].as_str().unwrap();
    let package = music_practice::score_package::template();
    let response = app
        .clone()
        .oneshot(req(
            "POST",
            &format!("/api/songs/{id}/import-score"),
            json!({"revision":1,"package":package}),
        ))
        .await
        .unwrap();
    let status = response.status();
    let job = js(response).await;
    assert_eq!(status, StatusCode::OK, "{job}");
    assert_eq!(job["status"], "review");
    assert_eq!(job["mode"], "external");
    assert_eq!(job["sourcePackage"], package);
    let unchanged = js(app
        .clone()
        .oneshot(req("GET", &format!("/api/songs/{id}"), Value::Null))
        .await
        .unwrap())
    .await;
    assert_eq!(song, unchanged);
    let applied = js(app
        .clone()
        .oneshot(req(
            "POST",
            &format!("/api/songs/{id}/jobs/{}/apply", job["id"].as_str().unwrap()),
            json!({"revision":1}),
        ))
        .await
        .unwrap())
    .await;
    assert_eq!(applied["title"], song["title"]);
    assert_eq!(applied["artist"], song["artist"]);
    assert_eq!(applied["score"]["notes"].as_array().unwrap().len(), 4);
    let stale = app
        .clone()
        .oneshot(req(
            "POST",
            &format!("/api/songs/{id}/import-score"),
            json!({"revision":1,"package":package}),
        ))
        .await
        .unwrap();
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    let prompt = js(app
        .clone()
        .oneshot(req(
            "GET",
            &format!("/api/songs/{id}/external-prompt"),
            Value::Null,
        ))
        .await
        .unwrap())
    .await;
    assert!(
        prompt["prompt"]
            .as_str()
            .unwrap()
            .contains("shengjian.score")
    );
    assert_eq!(prompt["manifest"], json!([]));
    let format = js(app
        .oneshot(req("GET", "/api/score-format", Value::Null))
        .await
        .unwrap())
    .await;
    assert_eq!(format["template"], package);
    assert_eq!(
        format["schema"]["$schema"],
        "https://json-schema.org/draft/2020-12/schema"
    );
}
#[tokio::test]
async fn invalid_or_foreign_source_mapping_does_not_create_jobs() {
    let d = tempfile::tempdir().unwrap();
    let app = music_practice::server::app(d.path());
    let song = js(app
        .clone()
        .oneshot(req("POST", "/api/songs", json!({"title":"fixture"})))
        .await
        .unwrap())
    .await;
    let id = song["id"].as_str().unwrap();
    let mut package = music_practice::score_package::template();
    package["measures"][0]["notes"][0]["duration"] = json!([1, 0]);
    let r = app
        .clone()
        .oneshot(req(
            "POST",
            &format!("/api/songs/{id}/import-score"),
            json!({"revision":1,"package":package}),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::BAD_REQUEST);
    assert!(js(r).await["error"].as_str().unwrap().contains("duration"));
    let r=app.clone().oneshot(req("POST",&format!("/api/songs/{id}/import-score"),json!({"revision":1,"package":music_practice::score_package::template(),"sourceMapping":{"page-1":"foreign-file"}}))).await.unwrap();
    assert_eq!(r.status(), StatusCode::BAD_REQUEST);
    let jobs = js(app
        .oneshot(req("GET", &format!("/api/songs/{id}/jobs"), Value::Null))
        .await
        .unwrap())
    .await;
    assert_eq!(jobs, json!([]));
}
