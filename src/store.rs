use crate::score;
use rusqlite::{Connection, params};
use serde_json::{Value, json};
use std::{path::Path, sync::Mutex};
pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
pub fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
pub struct Store {
    db: Mutex<Connection>,
}
impl Store {
    pub fn open(path: &Path) -> Result<Self, String> {
        let db = Connection::open(path).map_err(|e| e.to_string())?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS songs(id TEXT PRIMARY KEY,doc TEXT NOT NULL); CREATE TABLE IF NOT EXISTS history(song_id TEXT,revision INTEGER,at TEXT,score TEXT,PRIMARY KEY(song_id,revision)); CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,song_id TEXT,doc TEXT); CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,song_id TEXT,doc TEXT); CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY,doc TEXT);").map_err(|e|e.to_string())?;
        let s = Self { db: Mutex::new(db) };
        // Interrupted inference must never look like a job that is still running.
        for mut j in s.jobs(None)? {
            if j["status"] == "running" || j["status"] == "queued" {
                j["status"] = json!("failed");
                j["error"] = json!("服务重启中断了识谱，请重新运行；原谱面未改变。");
                s.save_job(&j)?;
            }
        }
        Ok(s)
    }
    pub fn create(&self, title: &str, artist: &str) -> Result<Value, String> {
        if title.trim().is_empty() || title.len() > 1000 || artist.len() > 1000 {
            return Err("请填写有效歌名（最多1000字节）".into());
        }
        let s = json!({"id":id(),"revision":1,"title":title.trim(),"artist":artist,"album":"","composer":"","lyricist":"","description":"","tags":[],"links":{"bilibili":"","qq":"","netease":""},"coverId":null,"assets":[],"score":score::empty(),"alignment":{"offset":0,"anchors":[]},"archived":false,"createdAt":now(),"updatedAt":now()});
        self.db
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO songs VALUES(?1,?2)",
                params![s["id"].as_str(), s.to_string()],
            )
            .map_err(|e| e.to_string())?;
        Ok(s)
    }
    fn read_any(db: &Connection, id: &str) -> Result<Value, String> {
        let text: String = db
            .query_row("SELECT doc FROM songs WHERE id=?1", [id], |r| r.get(0))
            .map_err(|_| "404: 歌曲不存在".to_string())?;
        serde_json::from_str(&text).map_err(|e| e.to_string())
    }
    fn read(db: &Connection, id: &str) -> Result<Value, String> {
        let song = Self::read_any(db, id)?;
        if !song["deletedAt"].is_null() {
            return Err("404: 歌曲已移入回收站".into());
        }
        Ok(song)
    }
    pub fn get(&self, id: &str) -> Result<Value, String> {
        Self::read(&self.db.lock().unwrap(), id)
    }
    pub fn manage_asset(&self, song: &str, asset: &str, patch: &Value) -> Result<Value, String> {
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let mut s = Self::read(&tx, song)?;
        if patch["revision"] != s["revision"] {
            return Err("409: 素材版本已变化，请刷新后再管理".into());
        }
        if s.get("archivedAssets").is_none() {
            s["archivedAssets"] = json!([]);
        }
        if let Some(archived) = patch["archived"].as_bool() {
            let from = if archived { "assets" } else { "archivedAssets" };
            let to = if archived { "archivedAssets" } else { "assets" };
            let index = s[from]
                .as_array()
                .unwrap()
                .iter()
                .position(|a| a["id"] == asset)
                .ok_or("404: 素材不在此歌曲中")?;
            let a = s[from].as_array_mut().unwrap().remove(index);
            s[to].as_array_mut().unwrap().push(a);
            if archived && s["coverId"] == asset {
                s["coverId"] = Value::Null;
            }
        } else if let Some(direction) = patch["move"].as_str() {
            let assets = s["assets"].as_array_mut().unwrap();
            let indices: Vec<usize> = assets
                .iter()
                .enumerate()
                .filter(|(_, a)| a["kind"] == "score")
                .map(|(i, _)| i)
                .collect();
            let at = indices
                .iter()
                .position(|i| assets[*i]["id"] == asset)
                .ok_or("404: 谱图不存在")?;
            let target = match direction {
                "up" => at.checked_sub(1),
                "down" => (at + 1 < indices.len()).then_some(at + 1),
                _ => return Err("排序方向无效".into()),
            };
            if let Some(target) = target {
                assets.swap(indices[at], indices[target]);
            }
        } else {
            return Err("请选择归档、恢复或调整谱图顺序".into());
        }
        s["revision"] = json!(s["revision"].as_u64().unwrap() + 1);
        s["updatedAt"] = json!(now());
        tx.execute(
            "UPDATE songs SET doc=?2 WHERE id=?1",
            params![song, s.to_string()],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(s)
    }
    pub fn list(&self) -> Result<Value, String> {
        self.list_deleted(false)
    }
    pub fn trash(&self) -> Result<Value, String> {
        self.list_deleted(true)
    }
    fn list_deleted(&self, deleted: bool) -> Result<Value, String> {
        let db = self.db.lock().unwrap();
        let mut st = db
            .prepare("SELECT doc FROM songs ORDER BY rowid DESC")
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut out = vec![];
        for row in rows {
            let song: Value = serde_json::from_str(&row.map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            if !song["deletedAt"].is_null() == deleted {
                out.push(song);
            }
        }
        Ok(json!(out))
    }
    pub fn delete_song(&self, id: &str, revision: u64) -> Result<Value, String> {
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let mut song = Self::read(&tx, id)?;
        if song["revision"].as_u64() != Some(revision) {
            return Err("409: 歌曲版本已变化，请刷新后再删除".into());
        }
        if song["archived"] != true {
            return Err("请先归档歌曲，再移入回收站".into());
        }
        let busy: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM jobs WHERE song_id=?1 AND json_extract(doc,'$.status') IN ('queued','running'))", [id], |r|r.get(0)).map_err(|e|e.to_string())?;
        if busy {
            return Err("409: 歌曲仍有模型任务，请等待完成后再删除".into());
        }
        let at = now();
        song["deletedAt"] = json!(at);
        song["updatedAt"] = json!(at);
        song["revision"] = json!(revision + 1);
        tx.execute(
            "UPDATE songs SET doc=?2 WHERE id=?1",
            params![id, song.to_string()],
        )
        .map_err(|e| e.to_string())?;
        // Reversible deletion: retain assets, history and jobs in this same database.
        // Files remain at their UUID paths and are inaccessible until restoration.
        tx.commit().map_err(|e| e.to_string())?;
        Ok(song)
    }
    pub fn restore_song(&self, id: &str, revision: u64) -> Result<Value, String> {
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let mut song = Self::read_any(&tx, id)?;
        if song["deletedAt"].is_null() {
            return Err("404: 回收站中没有此歌曲".into());
        }
        if song["revision"].as_u64() != Some(revision) {
            return Err("409: 回收站歌曲版本已变化，请刷新后恢复".into());
        }
        song.as_object_mut().unwrap().remove("deletedAt");
        song["archived"] = json!(true);
        song["revision"] = json!(revision + 1);
        song["updatedAt"] = json!(now());
        tx.execute(
            "UPDATE songs SET doc=?2 WHERE id=?1",
            params![id, song.to_string()],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(song)
    }
    pub fn update(&self, id: &str, patch: &Value) -> Result<Value, String> {
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let song = Self::update_in(&tx, id, patch)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(song)
    }
    fn update_in(db: &Connection, id: &str, patch: &Value) -> Result<Value, String> {
        let mut s = Self::read(db, id)?;
        if patch["revision"].as_u64() != s["revision"].as_u64() {
            return Err("409: 歌曲已改变，请刷新后再保存；本次编辑未覆盖已有内容".into());
        }
        for key in [
            "title",
            "artist",
            "album",
            "composer",
            "lyricist",
            "description",
            "lyricsText",
        ] {
            if let Some(v) = patch.get(key) {
                let text = v.as_str().ok_or("元信息必须为文本")?;
                if key == "lyricsText" {
                    crate::recognition::lyrics_text(v)?;
                }
                if (if key == "lyricsText" {
                    text.chars().count()
                } else {
                    text.len()
                }) > if matches!(key, "description" | "lyricsText") {
                    20000
                } else {
                    1000
                } || (key == "title" && text.trim().is_empty())
                {
                    return Err("文字长度无效".into());
                }
                s[key] = v.clone();
            }
        }
        if let Some(tags) = patch.get("tags") {
            let a = tags
                .as_array()
                .filter(|a| a.len() <= 100)
                .ok_or("标签必须为数组且不超过100项")?;
            if a.iter().any(|x| x.as_str().is_none_or(|s| s.len() > 100)) {
                return Err("标签过长或格式错误".into());
            }
            s["tags"] = tags.clone();
        }
        if let Some(links) = patch.get("links") {
            for key in ["bilibili", "qq", "netease"] {
                let link = links[key].as_str().ok_or("缺少平台链接字段")?;
                if link.len() > 4000 {
                    return Err("链接过长".into());
                }
                if !link.is_empty() {
                    let u = crate::metadata::validate_url(link, false)?;
                    let h = u.host_str().unwrap_or("");
                    let valid = match key {
                        "bilibili" => {
                            h == "b23.tv" || h == "bilibili.com" || h.ends_with(".bilibili.com")
                        }
                        "qq" => h == "y.qq.com" || h.ends_with(".y.qq.com"),
                        _ => {
                            h == "music.163.com" || h.ends_with(".music.163.com") || h == "163cn.tv"
                        }
                    };
                    if !valid {
                        return Err("链接与所选音乐平台不匹配".into());
                    }
                }
            }
            s["links"] = links.clone();
        }
        if let Some(v) = patch.get("archived") {
            if !v.is_boolean() {
                return Err("归档状态无效".into());
            }
            s["archived"] = v.clone();
        }
        if let Some(v) = patch.get("coverId") {
            if !v.is_null()
                && !s["assets"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|a| a["id"] == *v && (a["kind"] == "cover" || a["kind"] == "score"))
            {
                return Err("封面必须来自本歌曲的图片素材".into());
            }
            s["coverId"] = v.clone();
        }
        if let Some(v) = patch.get("alignment") {
            score::validate_alignment(v)?;
            s["alignment"] = v.clone();
        }
        if let Some(v) = patch.get("score") {
            score::validate_score(v)?;
            db.execute(
                "INSERT OR IGNORE INTO history VALUES(?1,?2,?3,?4)",
                params![id, s["revision"].as_u64(), now(), s["score"].to_string()],
            )
            .map_err(|e| e.to_string())?;
            s["score"] = v.clone();
        }
        s["revision"] = json!(s["revision"].as_u64().unwrap() + 1);
        s["updatedAt"] = json!(now());
        db.execute(
            "UPDATE songs SET doc=?2 WHERE id=?1",
            params![id, s.to_string()],
        )
        .map_err(|e| e.to_string())?;
        Ok(s)
    }
    pub fn add_asset(&self, song_id: &str, asset: &Value) -> Result<Value, String> {
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let mut s = Self::read(&tx, song_id)?;
        s["assets"].as_array_mut().unwrap().push(asset.clone());
        if asset["kind"] == "cover" {
            s["coverId"] = asset["id"].clone();
        }
        s["revision"] = json!(s["revision"].as_u64().unwrap() + 1);
        s["updatedAt"] = json!(now());
        tx.execute(
            "INSERT INTO assets VALUES(?1,?2,?3)",
            params![asset["id"].as_str(), song_id, asset.to_string()],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE songs SET doc=?2 WHERE id=?1",
            params![song_id, s.to_string()],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(s)
    }
    pub fn asset(&self, id: &str) -> Result<Value, String> {
        let db = self.db.lock().unwrap();
        let (song_id, text): (String, String) = db
            .query_row("SELECT song_id,doc FROM assets WHERE id=?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .map_err(|_| "404: 素材不存在".to_string())?;
        Self::read(&db, &song_id)?;
        serde_json::from_str(&text).map_err(|e| e.to_string())
    }
    pub fn delete_recording(
        &self,
        root: &Path,
        song_id: &str,
        asset_id: &str,
        revision: u64,
    ) -> Result<Value, String> {
        if uuid::Uuid::parse_str(asset_id).is_err() {
            return Err("录音ID无效".into());
        }
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let mut song = Self::read(&tx, song_id)?;
        if song["revision"].as_u64() != Some(revision) {
            return Err("409: 歌曲版本已变化，请刷新后再删除录音".into());
        }
        let document: String = tx
            .query_row(
                "SELECT doc FROM assets WHERE id=?1 AND song_id=?2",
                params![asset_id, song_id],
                |r| r.get(0),
            )
            .map_err(|_| "404: 录音不属于此歌曲")?;
        let asset: Value = serde_json::from_str(&document).map_err(|_| "录音元信息无效")?;
        if asset["kind"] != "recording" || asset["id"] != asset_id {
            return Err("只允许删除本歌曲的录音，不能删除原音频".into());
        }
        let mut found = false;
        for field in ["assets", "archivedAssets"] {
            if let Some(assets) = song[field].as_array_mut() {
                if assets
                    .iter()
                    .any(|a| a["id"] == asset_id && a["kind"] != "recording")
                {
                    return Err("素材类型不一致".into());
                }
                let previous = assets.len();
                assets.retain(|a| a["id"] != asset_id);
                found |= assets.len() != previous;
            }
        }
        if !found {
            return Err("404: 歌曲中没有此录音".into());
        }
        let assets = root.join("assets");
        let canonical_assets = assets.canonicalize().map_err(|_| "素材目录不存在")?;
        let canonical_root = root.canonicalize().map_err(|_| "数据目录不存在")?;
        if canonical_assets.parent() != Some(canonical_root.as_path()) {
            return Err("素材目录不在歌曲数据根目录内".into());
        }
        let file = assets.join(asset_id);
        let info = std::fs::symlink_metadata(&file).map_err(|_| "录音文件不存在")?;
        if !info.is_file()
            || info.file_type().is_symlink()
            || file.canonicalize().map_err(|_| "录音路径无效")?.parent()
                != Some(canonical_assets.as_path())
        {
            return Err("录音路径不在素材目录内".into());
        }
        // Stage only this verified UUID file. The database transaction and file move
        // roll back together on ordinary errors; a crash leaves a recoverable trash file.
        let trash = assets.join(format!(".recording-trash-{}", id()));
        std::fs::rename(&file, &trash).map_err(|e| format!("无法暂存待删除录音：{e}"))?;
        let result = (|| {
            song["revision"] = json!(revision + 1);
            song["updatedAt"] = json!(now());
            tx.execute(
                "DELETE FROM assets WHERE id=?1 AND song_id=?2",
                params![asset_id, song_id],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "UPDATE songs SET doc=?2 WHERE id=?1",
                params![song_id, song.to_string()],
            )
            .map_err(|e| e.to_string())?;
            tx.commit().map_err(|e| e.to_string())
        })();
        if let Err(error) = result {
            std::fs::rename(&trash, &file)
                .map_err(|restore| format!("{error}；录音仍保存在暂存目录，恢复失败：{restore}"))?;
            return Err(error);
        }
        if std::fs::remove_file(&trash).is_err() {
            song["recordingDeletionWarning"] = json!("录音记录已删除，暂存文件待清理");
        }
        Ok(song)
    }
    pub fn save_take(&self, song_id: &str, asset_id: &str, take: Value) -> Result<Value, String> {
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let mut s = Self::read(&tx, song_id)?;
        let a = s["assets"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|a| a["id"] == asset_id && a["kind"] == "recording")
            .ok_or("404: 录音不存在")?;
        a["take"] = take;
        tx.execute(
            "UPDATE assets SET doc=?2 WHERE id=?1",
            params![asset_id, a.to_string()],
        )
        .map_err(|e| e.to_string())?;
        s["revision"] = json!(s["revision"].as_u64().unwrap() + 1);
        s["updatedAt"] = json!(now());
        tx.execute(
            "UPDATE songs SET doc=?2 WHERE id=?1",
            params![song_id, s.to_string()],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(s)
    }
    pub fn history(&self, id: &str) -> Result<Value, String> {
        let db = self.db.lock().unwrap();
        Self::read(&db, id)?;
        let mut st = db
            .prepare(
                "SELECT revision,at,score FROM history WHERE song_id=?1 ORDER BY revision DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([id], |r| {
                Ok((
                    r.get::<_, u64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut out = vec![];
        for row in rows {
            let (rev, at, score) = row.map_err(|e| e.to_string())?;
            out.push(json!({"revision":rev,"at":at,"score":serde_json::from_str::<Value>(&score).map_err(|e|e.to_string())?}));
        }
        Ok(json!(out))
    }
    pub fn settings(&self) -> Value {
        let db = self.db.lock().unwrap();
        let text: Result<String, _> =
            db.query_row("SELECT doc FROM settings WHERE id=1", [], |r| r.get(0));
        text.ok().and_then(|t|serde_json::from_str(&t).ok()).unwrap_or(json!({"providers":[{"id":"local-vlm","name":"本地 VLM","baseUrl":"http://127.0.0.1:18080/v1","model":"vlm","timeoutSeconds":300}],"activeProviderId":"local-vlm"}))
    }
    pub fn save_settings(&self, v: &Value) -> Result<(), String> {
        self.db
            .lock()
            .unwrap()
            .execute(
                "INSERT OR REPLACE INTO settings VALUES(1,?1)",
                [v.to_string()],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn save_job(&self, j: &Value) -> Result<(), String> {
        Self::save_job_in(&self.db.lock().unwrap(), j)
    }
    pub fn save_import_job(&self, j: &Value) -> Result<(), String> {
        let db = self.db.lock().unwrap();
        let song = Self::read(&db, j["songId"].as_str().ok_or("缺少歌曲ID")?)?;
        if song["revision"] != j["baseRevision"] {
            return Err("409: 歌曲版本已变化，请刷新后再导入".into());
        }
        Self::save_job_in(&db, j)
    }
    fn save_job_in(db: &Connection, j: &Value) -> Result<(), String> {
        Self::read(db, j["songId"].as_str().ok_or("任务缺少歌曲ID")?)?;
        db.execute(
            "INSERT OR REPLACE INTO jobs VALUES(?1,?2,?3)",
            params![j["id"].as_str(), j["songId"].as_str(), j.to_string()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
    fn read_job(db: &Connection, song: &str, job: &str) -> Result<Value, String> {
        let text: String = db
            .query_row(
                "SELECT doc FROM jobs WHERE id=?1 AND song_id=?2",
                params![job, song],
                |row| row.get(0),
            )
            .map_err(|_| "404: 识谱任务不存在".to_string())?;
        serde_json::from_str(&text).map_err(|e| e.to_string())
    }
    pub fn recheck_job(&self, song: &str, job: &str) -> Result<Value, String> {
        // Hold the same lock as apply while reading, recomputing and persisting.
        // A recheck must never write an old review status over an applied job.
        let db = self.db.lock().unwrap();
        Self::read(&db, song)?;
        let mut current = Self::read_job(&db, song, job)?;
        if current["status"] == "running" || current["status"] == "queued" {
            return Err("请等待识谱完成再检查页面重叠".into());
        }
        if current.get("sourcePackage").is_some() {
            crate::score_package::recheck_review(&mut current)?;
        } else {
            crate::recognition::recheck_job(&mut current)?;
        }
        Self::save_job_in(&db, &current)?;
        Ok(current)
    }
    pub fn apply_job(&self, song: &str, job: &str, patch: &Value) -> Result<Value, String> {
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let mut current = Self::read_job(&tx, song, job)?;
        if current["status"] != "review" {
            return Err("任务还没有可应用的草稿".into());
        }
        if patch["revision"].as_u64().is_none() || patch["revision"] != current["baseRevision"] {
            return Err(
                "409: 识谱后的歌曲已有修改；请在草稿中核对后手工合并，不覆盖现有版本".into(),
            );
        }
        let mut draft = current["draft"].clone();
        if current["mode"] == "lyrics" {
            crate::recognition::validate_lyrics_only(&Self::read(&tx, song)?["score"], &draft)?;
            if patch["removeOverlaps"] == true {
                return Err("歌词校正不能删除或合并音符".into());
            }
        }
        if patch["removeOverlaps"] == true {
            crate::recognition::remove_overlaps(&mut draft, &current["overlaps"])?;
        }
        draft["status"] = json!("reviewed");
        let mut song_patch = json!({"revision":patch["revision"],"score":draft});
        if current.get("lyricsText").is_some() {
            song_patch["lyricsText"] = current["lyricsText"].clone();
        }
        let updated = Self::update_in(&tx, song, &song_patch)?;
        current["status"] = json!("applied");
        Self::save_job_in(&tx, &current)?;
        // Song revision, score history and terminal job status commit together.
        tx.commit().map_err(|e| e.to_string())?;
        Ok(updated)
    }
    pub fn jobs(&self, song: Option<&str>) -> Result<Vec<Value>, String> {
        let db = self.db.lock().unwrap();
        if let Some(song) = song {
            Self::read(&db, song)?;
        }
        let mut st = db
            .prepare("SELECT doc FROM jobs WHERE (?1 IS NULL OR song_id=?1) ORDER BY rowid DESC")
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([song], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut out = vec![];
        for row in rows {
            out.push(
                serde_json::from_str(&row.map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?,
            );
        }
        Ok(out)
    }
}
