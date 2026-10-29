use crate::{
    score,
    store::{Store, id, now},
};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::{HeaderMap, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::{Path as FsPath, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tower::ServiceExt;
use tower_http::services::{ServeDir, ServeFile};

pub struct AppState {
    pub store: Store,
    pub root: PathBuf,
    pub keys: Mutex<HashMap<String, String>>,
    pub inference: tokio::sync::Semaphore,
}
pub type Shared = Arc<AppState>;
pub struct ApiError(pub StatusCode, pub String);
impl From<String> for ApiError {
    fn from(e: String) -> Self {
        let status = if e.starts_with("409:") {
            StatusCode::CONFLICT
        } else if e.starts_with("404:") {
            StatusCode::NOT_FOUND
        } else {
            StatusCode::BAD_REQUEST
        };
        Self(status, e)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error":self.1}))).into_response()
    }
}
type J = Result<Json<Value>, ApiError>;
pub fn app(root: &FsPath) -> Router {
    std::fs::create_dir_all(root.join("assets")).expect("create data directory");
    let state = Arc::new(AppState {
        store: Store::open(&root.join("library.sqlite3")).expect("open database"),
        root: root.to_path_buf(),
        keys: Mutex::new(HashMap::new()),
        inference: tokio::sync::Semaphore::new(1),
    });
    Router::new()
        .route(
            "/api/health",
            get(|| async { Json(json!({"ok":true,"version":"0.1.0"})) }),
        )
        .route("/api/songs", get(list).post(create))
        .route("/api/score-format", get(score_format))
        .route("/api/songs/{id}/external-prompt", get(external_prompt))
        .route("/api/songs/{id}/import-score", post(import_score))
        .route("/api/trash", get(trash))
        .route("/api/trash/{id}/restore", post(restore_song))
        .route("/api/songs/{id}", get(song).patch(update))
        .route("/api/songs/{id}/delete", post(delete_song))
        .route("/api/songs/{id}/assets", post(upload))
        .route("/api/songs/{id}/assets/{asset}/manage", post(manage_asset))
        .route("/api/songs/{id}/history", get(history))
        .route("/api/songs/{id}/recordings/{asset}/take", post(save_take))
        .route(
            "/api/songs/{id}/recordings/{asset}/delete",
            post(delete_recording),
        )
        .route("/api/songs/{id}/export/{format}", get(export))
        .route("/api/songs/{id}/recognize", post(recognize))
        .route("/api/songs/{id}/lyrics/align", post(align_lyrics))
        .route("/api/songs/{id}/jobs", get(jobs))
        .route("/api/songs/{id}/jobs/{job}/apply", post(apply_job))
        .route("/api/songs/{id}/jobs/{job}/recheck", post(recheck_job))
        .route("/api/settings", get(settings).put(save_settings))
        .route("/api/providers/test", post(test_provider))
        .route("/api/metadata/preview", post(metadata_preview))
        .route("/api/songs/{id}/cover-url", post(cover_url))
        .route("/assets/{id}", get(asset_file))
        .fallback_service(
            ServeDir::new("dist").not_found_service(ServeFile::new("dist/index.html")),
        )
        .layer(DefaultBodyLimit::max(100 * 1024 * 1024))
        .layer(middleware::from_fn(guard))
        .with_state(state)
}
async fn guard(req: Request, next: Next) -> Response {
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|x| x.to_str().ok())
        .unwrap_or("");
    let parsed = url::Url::parse(&format!("http://{host}"));
    if !parsed.is_ok_and(|u| matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))) {
        return ApiError(StatusCode::FORBIDDEN, "仅允许本机地址访问".into()).into_response();
    }
    if let Some(origin) = req.headers().get(header::ORIGIN) {
        if origin.to_str().unwrap_or("") != format!("http://{host}") {
            return ApiError(StatusCode::FORBIDDEN, "不允许跨来源访问".into()).into_response();
        }
    }
    if !matches!(
        *req.method(),
        axum::http::Method::GET | axum::http::Method::HEAD
    ) && req
        .headers()
        .get("x-music-client")
        .and_then(|v| v.to_str().ok())
        != Some("web")
    {
        return ApiError(StatusCode::FORBIDDEN, "缺少本机页面请求标记".into()).into_response();
    }
    let mut response = next.run(req).await;
    response
        .headers_mut()
        .insert("x-content-type-options", "nosniff".parse().unwrap());
    response
        .headers_mut()
        .insert("referrer-policy", "no-referrer".parse().unwrap());
    response
        .headers_mut()
        .insert("x-frame-options", "DENY".parse().unwrap());
    response.headers_mut().insert("content-security-policy","default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; object-src 'none'".parse().unwrap());
    if response
        .headers()
        .get(header::CONTENT_TYPE)
        .is_some_and(|x| x.to_str().unwrap_or("").contains("application/json"))
    {
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    }
    response
}
async fn list(State(s): State<Shared>) -> J {
    Ok(Json(s.store.list()?))
}
async fn score_format() -> J {
    Ok(Json(
        json!({"format":crate::score_package::FORMAT,"version":crate::score_package::VERSION,"schema":crate::score_package::schema(),"template":crate::score_package::template(),"prompt":crate::score_package::prompt(&json!([]))}),
    ))
}
async fn external_prompt(State(s): State<Shared>, Path(id): Path<String>) -> J {
    let song = s.store.get(&id)?;
    let manifest: Vec<Value> = song["assets"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|a| a["kind"] == "score")
        .enumerate()
        .map(|(i, a)| json!({"id":format!("page-{}",i+1),"name":a["name"],"assetId":a["id"]}))
        .collect();
    Ok(Json(
        json!({"format":crate::score_package::FORMAT,"version":crate::score_package::VERSION,"prompt":crate::score_package::prompt(&json!(manifest)),"manifest":manifest}),
    ))
}
async fn import_score(State(s): State<Shared>, Path(id): Path<String>, Json(v): Json<Value>) -> J {
    if v.to_string().len() > crate::score_package::MAX_BYTES + 32768 {
        return Err("转谱请求过大（JSON 包最多 2 MB）".to_string().into());
    }
    let song = s.store.get(&id)?;
    if v["revision"].as_u64().is_none() || v["revision"] != song["revision"] {
        return Err("409: 歌曲版本已变化，请刷新后再导入".to_string().into());
    }
    let mapping: HashMap<String, String> = if let Some(m) = v.get("sourceMapping") {
        serde_json::from_value(m.clone())
            .map_err(|_| "sourceMapping 需要 来源ID:本曲谱图ID 的对象".to_string())?
    } else {
        HashMap::new()
    };
    let assets: Vec<&Value> = song["assets"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|a| a["kind"] == "score")
        .collect();
    for (sid, aid) in &mapping {
        if !assets.iter().any(|a| a["id"] == *aid) {
            return Err(format!("sourceMapping.{sid}: 只能关联本曲当前可用的谱图").into());
        }
    }
    let compiled = crate::score_package::compile(&v["package"], &song["score"], &mapping)?;
    let mut job = json!({"id":crate::store::id(),"songId":id,"mode":"external","status":"review","progress":"外部转谱已校验，等待对照原图审阅","baseRevision":song["revision"],"createdAt":now(),"workflow":{"id":"portable-score-import","version":1},"draft":compiled.score,"warnings":compiled.warnings,"qualityIssues":compiled.quality_issues,"sourcePackage":v["package"],"sourceMapping":mapping,"checks":[{"kind":"structure-and-music","ok":true,"message":"结构与节奏自洽检查通过；不代表转谱准确"}],"trace":[],"overlaps":[]});
    crate::score_package::recheck_review(&mut job)?;
    s.store.save_import_job(&job)?;
    Ok(Json(job))
}
async fn trash(State(s): State<Shared>) -> J {
    Ok(Json(s.store.trash()?))
}
async fn delete_song(State(s): State<Shared>, Path(id): Path<String>, Json(v): Json<Value>) -> J {
    let revision = v["revision"]
        .as_u64()
        .ok_or_else(|| "请提供当前歌曲版本".to_string())?;
    Ok(Json(s.store.delete_song(&id, revision)?))
}
async fn restore_song(State(s): State<Shared>, Path(id): Path<String>, Json(v): Json<Value>) -> J {
    let revision = v["revision"]
        .as_u64()
        .ok_or_else(|| "请提供回收站歌曲版本".to_string())?;
    Ok(Json(s.store.restore_song(&id, revision)?))
}
async fn create(State(s): State<Shared>, Json(v): Json<Value>) -> J {
    Ok(Json(s.store.create(
        v["title"].as_str().unwrap_or(""),
        v["artist"].as_str().unwrap_or(""),
    )?))
}
async fn song(State(s): State<Shared>, Path(id): Path<String>) -> J {
    Ok(Json(s.store.get(&id)?))
}
async fn update(State(s): State<Shared>, Path(id): Path<String>, Json(v): Json<Value>) -> J {
    Ok(Json(s.store.update(&id, &v)?))
}
async fn manage_asset(
    State(s): State<Shared>,
    Path((id, asset)): Path<(String, String)>,
    Json(v): Json<Value>,
) -> J {
    Ok(Json(s.store.manage_asset(&id, &asset, &v)?))
}
async fn history(State(s): State<Shared>, Path(id): Path<String>) -> J {
    Ok(Json(s.store.history(&id)?))
}
async fn save_take(
    State(s): State<Shared>,
    Path((id, asset)): Path<(String, String)>,
    Json(v): Json<Value>,
) -> J {
    if v.to_string().len() > 16 * 1024 * 1024 {
        return Err("录音事件记录过大".to_string().into());
    }
    Ok(Json(s.store.save_take(&id, &asset, v)?))
}
async fn delete_recording(
    State(s): State<Shared>,
    Path((id, asset)): Path<(String, String)>,
    Json(v): Json<Value>,
) -> J {
    let revision = v["revision"]
        .as_u64()
        .ok_or_else(|| "请提供当前歌曲版本".to_string())?;
    Ok(Json(
        s.store.delete_recording(&s.root, &id, &asset, revision)?,
    ))
}
#[derive(Deserialize)]
struct UploadQuery {
    kind: String,
}
pub fn detect_mime(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if data.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else if data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WAVE") {
        Some("audio/wav")
    } else if data.starts_with(b"ID3") || (data.len() > 2 && data[0] == 255 && data[1] & 224 == 224)
    {
        Some("audio/mpeg")
    } else if data.get(4..8) == Some(b"ftyp") {
        Some("video/mp4")
    } else if data.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        Some("audio/webm")
    } else if data.starts_with(b"OggS") {
        Some("audio/ogg")
    } else {
        None
    }
}
pub async fn save_asset(
    s: &Shared,
    song_id: &str,
    kind: &str,
    name: &str,
    bytes: &[u8],
) -> Result<Value, String> {
    s.store.get(song_id)?;
    if !matches!(kind, "score" | "audio" | "video" | "cover" | "recording") {
        return Err("无效素材类型".into());
    }
    if bytes.is_empty() || bytes.len() > 100 * 1024 * 1024 {
        return Err("文件为空或超过100MB".into());
    }
    let mut mime = detect_mime(bytes)
        .ok_or("不支持的文件内容（支持PNG/JPEG/WebP、MP3/WAV/OGG/WebM、MP4）")?
        .to_string();
    let mut data = bytes.to_vec();
    if matches!(kind, "cover" | "score") {
        if !mime.starts_with("image/") {
            return Err("谱图和封面必须是图片".into());
        }
        let reader = image::ImageReader::new(std::io::Cursor::new(bytes))
            .with_guessed_format()
            .map_err(|e| e.to_string())?;
        let (w, h) = reader.into_dimensions().map_err(|_| "图片无法读取")?;
        if w == 0 || h == 0 || w > 16000 || h > 16000 || (w as u64 * h as u64) > 40_000_000 {
            return Err("图片尺寸超限（最大4000万像素）".into());
        }
        if kind == "cover" {
            let img = image::load_from_memory(bytes)
                .map_err(|_| "封面解码失败")?
                .thumbnail(800, 800);
            let mut out = std::io::Cursor::new(vec![]);
            img.write_to(&mut out, image::ImageFormat::Png)
                .map_err(|e| e.to_string())?;
            data = out.into_inner();
            mime = "image/png".into();
        }
    } else if matches!(kind, "audio" | "recording") && !mime.starts_with("audio/") {
        return Err("请选择支持的音频文件".into());
    } else if kind == "video" {
        if mime == "audio/webm" {
            mime = "video/webm".into();
        } else if mime != "video/mp4" {
            return Err("请选择MP4或WebM视频".into());
        }
    }
    let aid = id();
    let path = s.root.join("assets").join(&aid);
    // Generated UUID filename, never a user-controlled path.
    use tokio::io::AsyncWriteExt;
    let mut f = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .await
        .map_err(|e| e.to_string())?;
    let written = async {
        f.write_all(&data).await.map_err(|e| e.to_string())?;
        f.sync_all().await.map_err(|e| e.to_string())
    }
    .await;
    // Close the request-owned handle before cleaning up on Windows. This UUID
    // was successfully create_new'd above, so no pre-existing file is removed.
    drop(f);
    if let Err(error) = written {
        return Err(clean_failed_upload(&path, error).await);
    }
    let safe_name = name
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or("asset")
        .chars()
        .filter(|c| !c.is_control())
        .take(200)
        .collect::<String>();
    let a = json!({"id":aid,"name":safe_name,"kind":kind,"mime":mime,"size":data.len(),"sha256":format!("{:x}",Sha256::digest(&data)),"url":format!("/assets/{aid}"),"createdAt":now()});
    match s.store.add_asset(song_id, &a) {
        Ok(song) => Ok(song),
        Err(error) => Err(clean_failed_upload(&path, error).await),
    }
}
async fn clean_failed_upload(path: &FsPath, error: String) -> String {
    match tokio::fs::remove_file(path).await {
        Ok(()) => error,
        Err(cleanup) if cleanup.kind() == std::io::ErrorKind::NotFound => error,
        Err(_) => format!("{error}；本次上传的临时文件未能清理，请保留错误信息"),
    }
}
async fn upload(
    State(s): State<Shared>,
    Path(id): Path<String>,
    Query(q): Query<UploadQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> J {
    let name = headers
        .get("x-file-name")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("upload");
    let form = format!("name={name}");
    let name = url::form_urlencoded::parse(form.as_bytes())
        .next()
        .map(|(_, v)| v.to_string())
        .unwrap_or("upload".into());
    Ok(Json(save_asset(&s, &id, &q.kind, &name, &body).await?))
}
async fn asset_file(
    State(s): State<Shared>,
    Path(id): Path<String>,
    req: Request,
) -> Result<Response, ApiError> {
    let a = s.store.asset(&id)?;
    let mut r = ServeFile::new(s.root.join("assets").join(id))
        .oneshot(req)
        .await
        .map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .into_response();
    r.headers_mut().insert(
        header::CONTENT_TYPE,
        a["mime"]
            .as_str()
            .unwrap_or("application/octet-stream")
            .parse()
            .unwrap(),
    );
    Ok(r)
}
async fn export(
    State(s): State<Shared>,
    Path((id, format)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let song = s.store.get(&id)?;
    let (mime, name, bytes) = match format.as_str() {
        "midi" => ("audio/midi", "score.mid", score::midi(&song["score"])?),
        "musicxml" => (
            "application/vnd.recordare.musicxml+xml",
            "score.musicxml",
            score::musicxml(&song["score"], song["title"].as_str().unwrap_or("Score"))?
                .into_bytes(),
        ),
        "project" => (
            "application/json",
            "song.json",
            serde_json::to_vec_pretty(&song).unwrap(),
        ),
        _ => return Err("未知导出格式".to_string().into()),
    };
    Ok((
        [
            (header::CONTENT_TYPE, mime.to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{name}\""),
            ),
        ],
        bytes,
    )
        .into_response())
}
pub fn provider_url(base: &str) -> Result<url::Url, String> {
    let u = url::Url::parse(base).map_err(|_| "API地址格式不正确")?;
    if !matches!(u.scheme(), "http" | "https")
        || u.host_str().is_none()
        || !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
    {
        return Err("API地址须为无内嵌凭据或查询参数的HTTP(S)地址".into());
    }
    Ok(u)
}
async fn settings(State(s): State<Shared>) -> J {
    let mut v = s.store.settings();
    let keys = s.keys.lock().unwrap();
    for p in v["providers"].as_array_mut().unwrap() {
        p["hasKey"] = json!(keys.contains_key(p["id"].as_str().unwrap_or("")));
    }
    Ok(Json(v))
}
async fn save_settings(State(s): State<Shared>, Json(mut v): Json<Value>) -> J {
    let providers = v["providers"]
        .as_array_mut()
        .filter(|v| !v.is_empty() && v.len() <= 20)
        .ok_or_else(|| "请保留1到20套API配置".to_string())?;
    let mut ids = std::collections::HashSet::new();
    let mut key_changes = vec![];
    for p in providers {
        let pid = p["id"]
            .as_str()
            .filter(|x| !x.is_empty() && x.len() < 128)
            .ok_or_else(|| "配置ID无效".to_string())?
            .to_string();
        if !ids.insert(pid.clone()) {
            return Err("配置ID重复".to_string().into());
        }
        provider_url(p["baseUrl"].as_str().unwrap_or(""))?;
        for key in ["name", "model"] {
            if p[key]
                .as_str()
                .is_none_or(|v| v.trim().is_empty() || v.len() > 500)
            {
                return Err("请填写配置名称和模型名".to_string().into());
            }
        }
        score::number(&p["timeoutSeconds"], "超时秒数", 5., 600.)?;
        let key = p["apiKey"].as_str().unwrap_or("").to_string();
        if key.len() > 4096 {
            return Err("密钥过长".to_string().into());
        }
        key_changes.push((pid, key, p["clearKey"] == true));
        p.as_object_mut().unwrap().remove("apiKey");
        p.as_object_mut().unwrap().remove("clearKey");
        p.as_object_mut().unwrap().remove("hasKey");
    }
    if !ids.contains(v["activeProviderId"].as_str().unwrap_or("")) {
        return Err("请选择有效的默认API配置".to_string().into());
    }
    s.store.save_settings(&v)?;
    {
        let mut keys = s.keys.lock().unwrap();
        for (id, key, clear) in key_changes {
            if clear {
                keys.remove(&id);
            } else if !key.is_empty() {
                keys.insert(id, key);
            }
        }
        keys.retain(|k, _| ids.contains(k));
    }
    settings(State(s)).await
}
pub fn client(timeout: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(timeout))
        .build()
        .map_err(|e| e.to_string())
}
pub fn model_names(data: &Value) -> Result<Vec<String>, String> {
    let models = data["data"]
        .as_array()
        .filter(|m| m.len() <= 512)
        .ok_or("模型列表格式错误或超过512项")?;
    let mut names = vec![];
    for model in models {
        let id = model["id"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 256)
            .ok_or("模型名称缺失或过长")?;
        names.push(id.to_string());
    }
    Ok(names)
}
async fn bounded_json(mut response: reqwest::Response) -> Result<Value, String> {
    const LIMIT: usize = 2 * 1024 * 1024;
    if response.content_length().is_some_and(|n| n > LIMIT as u64) {
        return Err("模型响应超过2MB限制".into());
    }
    let mut bytes = vec![];
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取模型响应失败")? {
        if bytes.len() + chunk.len() > LIMIT {
            return Err("模型响应超过2MB限制".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "模型未返回有效JSON".into())
}
async fn test_provider(State(s): State<Shared>, Json(v): Json<Value>) -> J {
    let base = v["baseUrl"].as_str().unwrap_or("");
    provider_url(base)?;
    let mut req = client(20)?.get(format!("{}/models", base.trim_end_matches('/')));
    let key = v["apiKey"]
        .as_str()
        .filter(|x| !x.is_empty())
        .map(str::to_string)
        .or_else(|| {
            s.keys
                .lock()
                .unwrap()
                .get(v["id"].as_str().unwrap_or(""))
                .cloned()
        });
    if let Some(key) = key {
        req = req.bearer_auth(key);
    }
    let response = req.send().await.map_err(|e| format!("模型连接失败：{e}"))?;
    if !response.status().is_success() {
        return Err(format!("模型列表返回HTTP {}", response.status()).into());
    }
    let data = bounded_json(response).await?;
    let models = model_names(&data)?;
    Ok(Json(json!({"models":models})))
}
async fn metadata_preview(Json(v): Json<Value>) -> J {
    Ok(Json(
        crate::metadata::preview(v["url"].as_str().unwrap_or("")).await?,
    ))
}
async fn cover_url(State(s): State<Shared>, Path(id): Path<String>, Json(v): Json<Value>) -> J {
    let (bytes, _) = crate::metadata::fetch_cover(v["url"].as_str().unwrap_or("")).await?;
    Ok(Json(
        save_asset(&s, &id, "cover", "cover.png", &bytes).await?,
    ))
}
async fn recognize(
    State(s): State<Shared>,
    Path(id): Path<String>,
    body: Option<Json<Value>>,
) -> J {
    let options = body.map(|v| v.0).unwrap_or(json!({}));
    if options.get("regions").is_some() {
        return Err(
            "新版识谱由图像工具选择区域，不再接受旧版 regions；请移除此字段后重试"
                .to_string()
                .into(),
        );
    }
    let song = s.store.get(&id)?;
    if s.store
        .jobs(Some(&id))?
        .iter()
        .any(|j| j["status"] == "queued" || j["status"] == "running")
    {
        return Err("已有识谱任务进行中".to_string().into());
    }
    let assets: Vec<Value> = song["assets"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|a| a["kind"] == "score")
        .cloned()
        .collect();
    if assets.is_empty() || assets.len() > 20 {
        return Err("请先上传1到20张谱图；视频可先在素材页截取谱图"
            .to_string()
            .into());
    }
    let settings = s.store.settings();
    let provider = settings["providers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == settings["activeProviderId"])
        .ok_or_else(|| "请选择API配置".to_string())?
        .clone();
    let mut job = json!({"id":crate::store::id(),"songId":id,"mode":"recognition","status":"queued","progress":"等待模型","baseRevision":song["revision"],"createdAt":now()});
    if let Some(text) = options.get("lyricsText").or_else(|| song.get("lyricsText")) {
        crate::recognition::lyrics_text(text)?;
        job["lyricsText"] = text.clone();
    }
    s.store.save_job(&job)?;
    let j = job.clone();
    tokio::spawn(async move {
        crate::recognition_agent::run(s, song, assets, provider, j).await;
    });
    Ok(Json(job))
}
async fn align_lyrics(State(s): State<Shared>, Path(id): Path<String>, Json(v): Json<Value>) -> J {
    let song = s.store.get(&id)?;
    if v["revision"] != song["revision"] {
        return Err("409: 歌曲版本已变化，请刷新后再校正歌词".to_string().into());
    }
    let text = crate::recognition::lyrics_text(&v["lyricsText"])?;
    if text.trim().is_empty()
        || song["score"]["notes"]
            .as_array()
            .is_none_or(|n| n.is_empty())
    {
        return Err("请先保存音符并填写逐行歌词".to_string().into());
    }
    if s.store
        .jobs(Some(&id))?
        .iter()
        .any(|j| j["status"] == "queued" || j["status"] == "running")
    {
        return Err("已有模型任务进行中".to_string().into());
    }
    let settings = s.store.settings();
    let provider = settings["providers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == settings["activeProviderId"])
        .ok_or_else(|| "请选择API配置".to_string())?
        .clone();
    let job = json!({"id":crate::store::id(),"songId":id,"mode":"lyrics","status":"queued","progress":"等待歌词校正","baseRevision":song["revision"],"lyricsText":text,"baseScore":song["score"],"createdAt":now()});
    s.store.save_job(&job)?;
    let j = job.clone();
    tokio::spawn(async move {
        crate::recognition::run_lyrics(s, song, provider, j).await;
    });
    Ok(Json(job))
}
async fn jobs(State(s): State<Shared>, Path(id): Path<String>) -> J {
    Ok(Json(json!(s.store.jobs(Some(&id))?)))
}
async fn recheck_job(State(s): State<Shared>, Path((id, jid)): Path<(String, String)>) -> J {
    Ok(Json(s.store.recheck_job(&id, &jid)?))
}
async fn apply_job(
    State(s): State<Shared>,
    Path((id, jid)): Path<(String, String)>,
    Json(v): Json<Value>,
) -> J {
    Ok(Json(s.store.apply_job(&id, &jid, &v)?))
}
