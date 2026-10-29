use scraper::{Html, Selector};
use serde_json::{Value, json};
use std::{net::IpAddr, time::Duration};
use url::Url;

const HTML_LIMIT: usize = 2 * 1024 * 1024;
const IMAGE_LIMIT: usize = 10 * 1024 * 1024;

fn domain_matches(host: &str, domain: &str) -> bool {
    host == domain
        || host
            .strip_suffix(domain)
            .is_some_and(|prefix| prefix.ends_with('.'))
}

/// Validate syntax and host policy. DNS validation is deliberately repeated at fetch time.
pub fn validate_url(input: &str, cover: bool) -> Result<Url, String> {
    if input.len() > 4096 || input.chars().any(char::is_control) {
        return Err("链接过长或含控制字符".into());
    }
    let url = Url::parse(input.trim()).map_err(|_| "链接格式无效".to_owned())?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("仅支持不含账号密码的 HTTP(S) 链接".into());
    }
    if !matches!(url.port_or_known_default(), Some(80 | 443)) {
        return Err("链接端口不受支持".into());
    }
    let host = url.host_str().ok_or("链接缺少域名")?;
    let allowed = if cover {
        domain_matches(host, "hdslb.com")
            || host == "y.gtimg.cn"
            || host.strip_suffix(".music.126.net").is_some_and(|prefix| {
                prefix.strip_prefix('p').is_some_and(|number| {
                    !number.is_empty() && number.bytes().all(|c| c.is_ascii_digit())
                })
            })
    } else {
        [
            "bilibili.com",
            "b23.tv",
            "y.qq.com",
            "music.163.com",
            "163cn.tv",
        ]
        .iter()
        .any(|domain| domain_matches(host, domain))
    };
    if !allowed {
        return Err(if cover {
            "仅支持哔哩哔哩、QQ 音乐和网易云的指定封面 CDN"
        } else {
            "仅支持哔哩哔哩、QQ 音乐和网易云链接"
        }
        .into());
    }
    Ok(url)
}

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192
                    && (b == 168 || (b == 0 && matches!(c, 0 | 2)) || (b == 88 && c == 99)))
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(ip) => {
            // Accept ordinary global unicast only, excluding transition, special-purpose,
            // and documentation allocations. This also denies all mapped IPv4 addresses.
            let s = ip.segments();
            (s[0] & 0xe000) == 0x2000
                && !(s[0] == 0x2001 && (s[1] < 0x0200 || s[1] == 0x0db8))
                && s[0] != 0x2002
                && !(s[0] == 0x3fff && s[1] < 0x1000)
        }
    }
}

fn platform(url: &Url) -> &'static str {
    let host = url.host_str().unwrap_or_default();
    if domain_matches(host, "y.qq.com") {
        "qq"
    } else if domain_matches(host, "music.163.com") || domain_matches(host, "163cn.tv") {
        "netease"
    } else {
        "bilibili"
    }
}

fn song_identifier(url: &Url) -> Option<(String, bool)> {
    let pairs = |u: &Url| {
        u.query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect::<Vec<_>>()
    };
    let mut query = pairs(url);
    if let Some(fragment) = url.fragment() {
        if let Ok(fragment_url) = Url::parse(&format!(
            "https://music.163.com/{}",
            fragment.trim_start_matches('/')
        )) {
            query.extend(pairs(&fragment_url));
        }
    }
    let valid = |value: &str| {
        !value.is_empty() && value.len() <= 64 && value.bytes().all(|c| c.is_ascii_alphanumeric())
    };
    for key in ["songid", "songmid", "id", "mid"] {
        if let Some((_, value)) = query
            .iter()
            .find(|(k, v)| k.eq_ignore_ascii_case(key) && valid(v))
        {
            return Some((value.clone(), key.ends_with("mid")));
        }
    }
    let parts: Vec<_> = url.path_segments()?.filter(|p| !p.is_empty()).collect();
    if let Some(i) = parts
        .iter()
        .position(|s| s.eq_ignore_ascii_case("songDetail"))
    {
        let value = *parts.get(i + 1)?;
        if valid(value) {
            return Some((
                value.to_string(),
                !value.bytes().all(|c| c.is_ascii_digit()),
            ));
        }
    }
    None
}

fn parse_music_json(value: &Value, url: &Url) -> Option<Value> {
    if value["code"] != 0 && value["code"] != 200 {
        return None;
    }
    let qq = platform(url) == "qq";
    let song = if qq {
        value["data"].as_array()?.first()?
    } else {
        value["songs"].as_array()?.first()?
    };
    let title = song["title"].as_str().or_else(|| song["name"].as_str())?;
    let mut result = json!({"platform":platform(url),"url":url.as_str(),"warning":"资料来自平台公开歌曲详情；请核对后选择应用。"});
    add_text(&mut result, "title", title);
    let artists = if qq {
        song["singer"].as_array()
    } else {
        song["artists"].as_array().or_else(|| song["ar"].as_array())
    };
    if let Some(artists) = artists {
        let names: Vec<_> = artists.iter().filter_map(|a| a["name"].as_str()).collect();
        add_text(&mut result, "artist", &names.join(" / "));
    }
    let album = if qq {
        &song["album"]
    } else {
        song.get("album").or_else(|| song.get("al"))?
    };
    if let Some(name) = album["name"].as_str() {
        add_text(&mut result, "album", name);
    }
    if qq {
        if let Some(mid) = album["mid"].as_str().filter(|s| {
            !s.is_empty() && s.len() <= 64 && s.bytes().all(|c| c.is_ascii_alphanumeric())
        }) {
            add_cover(
                &mut result,
                &format!("https://y.gtimg.cn/music/photo_new/T002R800x800M000{mid}.jpg"),
                url,
            );
        }
    } else if let Some(cover) = album["picUrl"].as_str() {
        add_cover(&mut result, cover, url);
    }
    if let Some(description) = song["subtitle"].as_str() {
        add_text(&mut result, "description", description);
    }
    Some(result)
}

async fn music_preview(url: &Url) -> Option<Value> {
    let (id, mid) = song_identifier(url)?;
    let endpoint = match platform(url) {
        "qq" => format!(
            "https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?{}={id}&tpl=yqq_song_detail&format=json",
            if mid { "songmid" } else { "songid" }
        ),
        "netease" if id.bytes().all(|c| c.is_ascii_digit()) => {
            format!("https://music.163.com/api/song/detail/?id={id}&ids=%5B{id}%5D")
        }
        _ => return None,
    };
    let (bytes, _) = download(&endpoint, false).await.ok()?;
    parse_music_json(&serde_json::from_slice::<Value>(&bytes).ok()?, url)
}

fn clean_text(input: &str) -> String {
    let mut text: String = input.chars().take(16_384).collect();
    for tag in ["script", "style"] {
        let pattern = regex::Regex::new(&format!(r"(?is)<{tag}\b[^>]*>.*?(?:</{tag}\s*>|$)"))
            .expect("static pattern");
        text = pattern.replace_all(&text, " ").into_owned();
    }
    let document = Html::parse_fragment(&text);
    let plain = document.root_element().text().collect::<Vec<_>>().join(" ");
    plain
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .filter(|c| !c.is_control())
        .take(4000)
        .collect()
}

fn add_text(result: &mut Value, key: &str, text: &str) {
    let text = clean_text(text);
    if !text.is_empty() {
        result[key] = Value::String(text);
    }
}

fn add_cover(result: &mut Value, cover: &str, base: &Url) {
    if let Ok(url) = base.join(cover.trim()) {
        if validate_url(url.as_str(), true).is_ok() {
            result["coverUrl"] = json!(url.as_str());
        }
    }
}

fn parse_html(html: &str, url: &Url) -> Value {
    let mut result = json!({"platform":platform(url), "url":url.as_str(), "warning":"网页资料可能不完整；请核对歌名，并手动填写歌手、专辑等信息。"});
    let document = Html::parse_document(html);
    let selector = Selector::parse("meta").expect("static selector");
    for node in document.select(&selector) {
        let key = node
            .value()
            .attr("property")
            .or_else(|| node.value().attr("name"))
            .unwrap_or_default()
            .to_ascii_lowercase();
        let Some(value) = node.value().attr("content") else {
            continue;
        };
        match key.as_str() {
            "og:title" => add_text(&mut result, "title", value),
            "og:description" => add_text(&mut result, "description", value),
            "description" if result.get("description").is_none() => {
                add_text(&mut result, "description", value)
            }
            "og:image" => add_cover(&mut result, value, url),
            // author and music:musician often identify an uploader or URL, not an artist.
            _ => {}
        }
    }
    result
}

fn parse_bilibili(value: &Value, url: &Url) -> Option<Value> {
    if value.get("code")?.as_i64()? != 0 {
        return None;
    }
    let data = value.get("data")?;
    let title = data.get("title")?.as_str()?;
    let mut result = json!({"platform":"bilibili", "url":url.as_str(), "warning":"已读取视频标题与简介；上传者不一定是歌手，请人工核对歌曲资料。"});
    add_text(&mut result, "title", title);
    if let Some(description) = data.get("desc").and_then(Value::as_str) {
        add_text(&mut result, "description", description);
    }
    if let Some(cover) = data.get("pic").and_then(Value::as_str) {
        add_cover(&mut result, cover, url);
    }
    Some(result)
}

fn image_mime(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Ok("image/jpeg")
    } else if bytes.len() >= 16
        && &bytes[..4] == b"RIFF"
        && &bytes[8..12] == b"WEBP"
        && matches!(&bytes[12..16], b"VP8 " | b"VP8L" | b"VP8X")
    {
        Ok("image/webp")
    } else {
        Err("封面内容必须为 PNG、JPEG 或 WebP 图片".into())
    }
}

fn append_limited(body: &mut Vec<u8>, chunk: &[u8], limit: usize) -> Result<(), String> {
    if chunk.len() > limit.saturating_sub(body.len()) {
        return Err("下载内容超过大小限制".into());
    }
    body.extend_from_slice(chunk);
    Ok(())
}

async fn download(input: &str, cover: bool) -> Result<(Vec<u8>, Url), String> {
    let mut url = validate_url(input, cover)?;
    let limit = if cover { IMAGE_LIMIT } else { HTML_LIMIT };
    for redirects in 0..=5 {
        // Revalidate each redirect before resolving it. Pin all validated answers into
        // a fresh client: no second DNS lookup, proxy, or pooled connection can bypass this.
        url = validate_url(url.as_str(), cover)?;
        url.set_fragment(None);
        let host = url.host_str().ok_or("链接缺少域名")?.to_owned();
        let port = url.port_or_known_default().ok_or("端口无效")?;
        let addresses = tokio::time::timeout(
            Duration::from_secs(4),
            tokio::net::lookup_host((host.as_str(), port)),
        )
        .await
        .map_err(|_| "域名解析超时".to_owned())?
        .map_err(|_| "域名解析失败".to_owned())?
        .collect::<Vec<_>>();
        if addresses.is_empty() || addresses.iter().any(|address| !public_ip(address.ip())) {
            return Err("域名解析至非公网地址，已拒绝访问".into());
        }
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .resolve_to_addrs(&host, &addresses)
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(15))
            .user_agent("MusicPractice/0.1 (metadata preview)")
            .build()
            .map_err(|_| "无法创建下载客户端".to_owned())?;
        let mut response = client
            .get(url.clone())
            .header(reqwest::header::ACCEPT_ENCODING, "identity")
            .send()
            .await
            .map_err(|_| "平台请求失败或超时；可手动填写资料".to_owned())?;
        if response.status().is_redirection() {
            if redirects == 5 {
                return Err("平台重定向次数过多".into());
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or("平台重定向缺少有效地址")?;
            url = url
                .join(location)
                .map_err(|_| "平台重定向地址无效".to_owned())?;
            continue;
        }
        if !response.status().is_success() {
            return Err(format!(
                "平台返回 HTTP {}；可手动填写资料",
                response.status().as_u16()
            ));
        }
        if response
            .content_length()
            .is_some_and(|length| length > limit as u64)
        {
            return Err("下载内容超过大小限制".into());
        }
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "下载响应内容失败".to_owned())?
        {
            append_limited(&mut body, &chunk, limit)?;
        }
        return Ok((body, url));
    }
    Err("平台重定向次数过多".into())
}

async fn bilibili_preview(url: &Url) -> Option<Value> {
    if !domain_matches(url.host_str()?, "bilibili.com") {
        return None;
    }
    let mut parts = url.path_segments()?;
    if parts.next()? != "video" {
        return None;
    }
    let bvid = parts.next()?;
    if bvid.len() != 12
        || !bvid.starts_with("BV")
        || !bvid.bytes().all(|byte| byte.is_ascii_alphanumeric())
    {
        return None;
    }
    let endpoint = format!("https://api.bilibili.com/x/web-interface/view?bvid={bvid}");
    let (bytes, _) = download(&endpoint, false).await.ok()?;
    let value = serde_json::from_slice::<Value>(&bytes).ok()?;
    parse_bilibili(&value, url)
}

/// Public-page best effort only: no authentication, account cookies, or media download.
pub async fn preview(input: &str) -> Result<Value, String> {
    let url = validate_url(input, false)?;
    if let Some(value) = bilibili_preview(&url).await {
        return Ok(value);
    }
    if let Some(value) = music_preview(&url).await {
        return Ok(value);
    }
    match download(url.as_str(), false).await {
        Ok((bytes, final_url)) => {
            if final_url != url {
                if let Some(mut value) = bilibili_preview(&final_url).await {
                    value["url"] = json!(url.as_str());
                    return Ok(value);
                }
                if let Some(mut value) = music_preview(&final_url).await {
                    value["url"] = json!(url.as_str());
                    return Ok(value);
                }
            }
            let mut value = parse_html(&String::from_utf8_lossy(&bytes), &final_url);
            value["url"] = json!(url.as_str());
            Ok(value)
        }
        Err(error) => Ok(json!({"platform":platform(&url), "url":url.as_str(), "warning":error})),
    }
}

pub async fn fetch_cover(input: &str) -> Result<(Vec<u8>, String), String> {
    let (bytes, _) = download(input, true).await?;
    let mime = image_mime(&bytes)?.to_owned();
    Ok((bytes, mime))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_real_qq_mobile_song_fixture_and_fragment_ids() {
        let url = validate_url(
            "https://i.y.qq.com/v8/playsong.html?songid=614799549#webchat_redirect",
            false,
        )
        .unwrap();
        assert_eq!(song_identifier(&url), Some(("614799549".into(), false)));
        let fixture: Value =
            serde_json::from_str(include_str!("../tests/fixtures/qq-song-614799549.json")).unwrap();
        let result = parse_music_json(&fixture, &url).unwrap();
        assert_eq!(result["title"], "昔涟");
        assert_eq!(result["artist"], "张韶涵 / HOYO-MiX");
        assert!(result["album"].as_str().unwrap().contains("Ripples"));
        assert!(
            result["coverUrl"]
                .as_str()
                .unwrap()
                .contains("000eyy8U24wicN")
        );
        let netease = validate_url("https://music.163.com/#/song?id=123456", false).unwrap();
        assert_eq!(song_identifier(&netease), Some(("123456".into(), false)));
        assert_eq!(
            song_identifier(
                &Url::parse("https://y.qq.com/n/ryqq_v2/songDetail/002rhFKO3EjKAg").unwrap()
            ),
            Some(("002rhFKO3EjKAg".into(), true))
        );
        assert!(
            song_identifier(
                &Url::parse("https://i.y.qq.com/v8/playsong.html?songid=../outside").unwrap()
            )
            .is_none()
        );
    }

    #[test]
    fn only_allows_platform_hosts_without_credentials_or_unusual_ports() {
        for link in [
            "https://www.bilibili.com/video/BV1xx411c7mD",
            "https://b23.tv/abc",
            "https://y.qq.com/n/ryqq/songDetail/abc",
            "http://music.163.com/#/song?id=1",
        ] {
            assert!(validate_url(link, false).is_ok(), "{link}");
        }
        for link in [
            "https://bilibili.com.evil.test/",
            "https://evilbilibili.com/",
            "file:///tmp/test",
            "https://user:pass@y.qq.com/",
            "https://y.qq.com:8080/",
            "http://127.0.0.1/",
            "https://y.qq.com./",
            "https://music.126.net/",
        ] {
            assert!(validate_url(link, false).is_err(), "{link}");
        }
    }

    #[test]
    fn restricts_covers_to_explicit_image_cdns() {
        for link in [
            "https://i0.hdslb.com/bfs/archive/p.jpg",
            "https://y.gtimg.cn/music/photo/a.jpg",
            "https://p1.music.126.net/test.jpg",
            "https://p10.music.126.net/test.jpg",
        ] {
            assert!(validate_url(link, true).is_ok(), "{link}");
        }
        for link in [
            "https://www.bilibili.com/a.png",
            "https://evilhdslb.com/a.png",
            "https://p1.music.126.net.evil.test/a.png",
            "https://evil.music.126.net/a.png",
            "https://y.gtimg.cn:81/a.png",
        ] {
            assert!(validate_url(link, true).is_err(), "{link}");
        }
    }

    #[test]
    fn denies_non_public_dns_answers_including_ipv6_and_mapped_ipv4() {
        for address in [
            "0.0.0.0",
            "10.0.0.1",
            "100.64.1.1",
            "127.0.0.1",
            "169.254.169.254",
            "172.31.1.1",
            "192.168.1.1",
            "192.0.2.1",
            "198.19.1.1",
            "198.51.100.2",
            "203.0.113.1",
            "224.1.1.1",
            "255.255.255.255",
            "::1",
            "::",
            "fc00::1",
            "fe80::1",
            "ff02::1",
            "2001:db8::1",
            "2002:7f00:1::",
            "::ffff:127.0.0.1",
            "64:ff9b::7f00:1",
        ] {
            assert!(!public_ip(address.parse().unwrap()), "{address}");
        }
        for address in ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "240e:1::1"] {
            assert!(public_ip(address.parse().unwrap()), "{address}");
        }
    }

    #[test]
    fn html_metadata_is_plain_text_and_cover_is_allowlisted() {
        let url = Url::parse("https://y.qq.com/n/ryqq/songDetail/abc").unwrap();
        let result = parse_html(
            r#"<html><head><meta property="og:title" content="&lt;b&gt;Song&lt;/b&gt; &amp; Friends"><meta name="description" content="&lt;script&gt;bad()&lt;/script&gt; Good song"><meta property="og:image" content="//y.gtimg.cn/a.jpg"><meta name="author" content="Uploader"></head></html>"#,
            &url,
        );
        assert_eq!(result["title"], "Song & Friends");
        assert_eq!(result["description"], "Good song");
        assert_eq!(result["coverUrl"], "https://y.gtimg.cn/a.jpg");
        assert!(
            result.get("artist").is_none(),
            "uploader is not the musician"
        );
        assert!(result.get("warning").is_some());
    }

    #[test]
    fn missing_metadata_never_fabricates_fields_or_exposes_unapproved_covers() {
        let url = Url::parse("https://music.163.com/song?id=1").unwrap();
        let result = parse_html(
            "<title>Access denied</title><meta property='og:image' content='http://127.0.0.1/a.png'>",
            &url,
        );
        assert!(result.get("title").is_none());
        assert!(result.get("artist").is_none());
        assert!(result.get("coverUrl").is_none());
        assert!(result.get("warning").is_some());
    }

    #[test]
    fn bilibili_api_uses_video_metadata_without_calling_uploader_artist() {
        let url = Url::parse("https://www.bilibili.com/video/BV1xx411c7mD").unwrap();
        let result = parse_bilibili(&json!({"code":0,"data":{"title":"<b>Music</b>","desc":"Description", "pic":"http://i0.hdslb.com/a.jpg","owner":{"name":"Uploader"}}}), &url).unwrap();
        assert_eq!(result["title"], "Music");
        assert_eq!(result["coverUrl"], "http://i0.hdslb.com/a.jpg");
        assert!(result.get("artist").is_none());
        assert!(parse_bilibili(&json!({"code":-404}), &url).is_none());
    }

    #[test]
    fn image_magic_does_not_trust_file_extension_or_content_type() {
        assert_eq!(image_mime(b"\x89PNG\r\n\x1a\nmore").unwrap(), "image/png");
        assert_eq!(image_mime(b"\xff\xd8\xffmore").unwrap(), "image/jpeg");
        assert_eq!(
            image_mime(b"RIFF\x10\x00\x00\x00WEBPVP8 more").unwrap(),
            "image/webp"
        );
        assert!(image_mime(b"<svg xmlns='http://www.w3.org/2000/svg'></svg>").is_err());
        assert!(image_mime(b"GIF89atest").is_err());
        assert!(image_mime(b"RIFFxxxxxxxxWAVE").is_err());
    }

    #[test]
    fn streamed_body_limit_rejects_the_overflowing_chunk() {
        let mut body = vec![1, 2];
        append_limited(&mut body, &[3, 4], 4).unwrap();
        assert_eq!(body, [1, 2, 3, 4]);
        assert!(append_limited(&mut body, &[5], 4).is_err());
        assert_eq!(body, [1, 2, 3, 4]);
    }
}
