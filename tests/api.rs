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
async fn js(resp: axum::response::Response) -> Value {
    serde_json::from_slice(&resp.into_body().collect().await.unwrap().to_bytes()).unwrap()
}
#[tokio::test]
async fn create_update_list_and_health() {
    let d = tempfile::tempdir().unwrap();
    let app = music_practice::server::app(d.path());
    let health = app
        .clone()
        .oneshot(req("GET", "/api/health", json!(null)))
        .await
        .unwrap();
    assert_eq!(health.status(), StatusCode::OK);
    let c = app
        .clone()
        .oneshot(req("POST", "/api/songs", json!({"title":"昔涟"})))
        .await
        .unwrap();
    assert_eq!(c.status(), StatusCode::OK);
    let s = js(c).await;
    let id = s["id"].as_str().unwrap();
    let edited = app
        .clone()
        .oneshot(req(
            "PATCH",
            &format!("/api/songs/{id}"),
            json!({"revision":1,"artist":"张韶涵"}),
        ))
        .await
        .unwrap();
    assert_eq!(js(edited).await["artist"], "张韶涵");
    let stale = app
        .clone()
        .oneshot(req(
            "PATCH",
            &format!("/api/songs/{id}"),
            json!({"revision":1,"title":"stale"}),
        ))
        .await
        .unwrap();
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    let list = js(app
        .oneshot(req("GET", "/api/songs", json!(null)))
        .await
        .unwrap())
    .await;
    assert_eq!(list.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn new_lyrics_and_recording_routes_reject_stale_or_invalid_inputs_without_mutating_song() {
    let d = tempfile::tempdir().unwrap();
    let app = music_practice::server::app(d.path());
    let song = js(app
        .clone()
        .oneshot(req("POST", "/api/songs", json!({"title":"fixture"})))
        .await
        .unwrap())
    .await;
    let id = song["id"].as_str().unwrap();
    let stale = app
        .clone()
        .oneshot(req(
            "POST",
            &format!("/api/songs/{id}/lyrics/align"),
            json!({"revision":0,"lyricsText":"你好"}),
        ))
        .await
        .unwrap();
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    let empty = app
        .clone()
        .oneshot(req(
            "POST",
            &format!("/api/songs/{id}/lyrics/align"),
            json!({"revision":1,"lyricsText":"你好"}),
        ))
        .await
        .unwrap();
    assert_eq!(empty.status(), StatusCode::BAD_REQUEST);
    let recording = app
        .clone()
        .oneshot(req(
            "POST",
            &format!("/api/songs/{id}/recordings/not-a-uuid/delete"),
            json!({"revision":1}),
        ))
        .await
        .unwrap();
    assert_eq!(recording.status(), StatusCode::BAD_REQUEST);
    let after = js(app
        .oneshot(req("GET", &format!("/api/songs/{id}"), json!(null)))
        .await
        .unwrap())
    .await;
    assert_eq!(after, song);
}
#[tokio::test]
async fn blocks_cross_origin_and_missing_write_header() {
    let d = tempfile::tempdir().unwrap();
    let app = music_practice::server::app(d.path());
    let mut r = req("POST", "/api/songs", json!({"title":"bad"}));
    r.headers_mut()
        .insert("origin", "https://evil.example".parse().unwrap());
    assert_eq!(
        app.clone().oneshot(r).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let mut r = req("POST", "/api/songs", json!({"title":"bad"}));
    r.headers_mut().remove("x-music-client");
    assert_eq!(
        app.oneshot(r).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
}
#[tokio::test]
async fn rejects_disguised_upload_and_unsafe_provider() {
    let d = tempfile::tempdir().unwrap();
    let app = music_practice::server::app(d.path());
    let s = js(app
        .clone()
        .oneshot(req("POST", "/api/songs", json!({"title":"test"})))
        .await
        .unwrap())
    .await;
    let r = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/songs/{}/assets?kind=cover",
            s["id"].as_str().unwrap()
        ))
        .header("host", "localhost:3210")
        .header("x-music-client", "web")
        .header("x-file-name", "evil.png")
        .header("content-type", "image/png")
        .body(Body::from("<script>bad</script>"))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(r).await.unwrap().status(),
        StatusCode::BAD_REQUEST
    );
    let r = req(
        "PUT",
        "/api/settings",
        json!({"providers":[{"id":"x","name":"bad","baseUrl":"file:///etc/passwd","model":"vlm","timeoutSeconds":10}],"activeProviderId":"x"}),
    );
    assert_eq!(
        app.oneshot(r).await.unwrap().status(),
        StatusCode::BAD_REQUEST
    );
}
