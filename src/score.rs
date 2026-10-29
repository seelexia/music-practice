use serde_json::{Value, json};
use std::collections::HashSet;

pub fn number(v: &Value, name: &str, lo: f64, hi: f64) -> Result<f64, String> {
    let n = v.as_f64().ok_or(format!("{name} 必须是数字"))?;
    if !n.is_finite() || n < lo || n > hi {
        return Err(format!("{name} 应在 {lo} 到 {hi} 之间"));
    }
    Ok(n)
}
pub fn empty() -> Value {
    json!({"bpm":80,"key":"C","timeSignature":[4,4],"status":"empty","notes":[],"phrases":[]})
}
pub fn validate_score(s: &Value) -> Result<(), String> {
    number(&s["bpm"], "速度", 20., 300.)?;
    let key = s["key"].as_str().ok_or("缺少调号")?;
    if key.len() > 16 {
        return Err("调号过长".into());
    }
    let ts = s["timeSignature"].as_array().ok_or("缺少拍号")?;
    if ts.len() != 2
        || !matches!(ts[0].as_u64(), Some(1..=32))
        || !matches!(ts[1].as_u64(), Some(1 | 2 | 4 | 8 | 16))
    {
        return Err("无效拍号".into());
    }
    let notes = s["notes"].as_array().ok_or("缺少音符数组")?;
    let phrases = s["phrases"].as_array().ok_or("缺少乐句数组")?;
    if notes.len() > 20000 || phrases.len() > 4000 {
        return Err("乐谱过大".into());
    }
    let mut pids = HashSet::new();
    for p in phrases {
        let id = p["id"]
            .as_str()
            .filter(|x| !x.is_empty() && x.len() < 128)
            .ok_or("乐句 ID 无效")?;
        if !pids.insert(id) {
            return Err("乐句 ID 重复".into());
        }
        if p["label"].as_str().unwrap_or("").len() > 2000 {
            return Err("乐句标签过长".into());
        }
    }
    let mut ids = HashSet::new();
    if let Some(measures) = s.get("measures") {
        let measures = measures
            .as_array()
            .filter(|m| m.len() <= 10000)
            .ok_or("小节数组无效或过大")?;
        let (mut previous_end, mut mids) = (0., HashSet::new());
        for m in measures {
            let id = m["id"]
                .as_str()
                .filter(|s| !s.is_empty() && s.len() < 128)
                .ok_or("小节ID无效")?;
            if !mids.insert(id) {
                return Err("小节ID重复".into());
            }
            let start = number(&m["startBeat"], "小节起点", 0., 100000.)?;
            let duration = number(&m["duration"], "小节时值", 1. / 128., 10000.)?;
            if start + 0.000001 < previous_end {
                return Err("小节起点须按序且不能重叠".into());
            }
            previous_end = start + duration;
            if let Some(expected) = m.get("expectedBeats") {
                number(expected, "预期小节拍数", 1. / 16., 128.)?;
            }
            if let Some(row) = m.get("row") {
                if !matches!(row.as_u64(), Some(1..=1000)) {
                    return Err("谱行编号无效".into());
                }
            }
            if m.get("pickup").is_some_and(|v| !v.is_boolean()) {
                return Err("弱起标记无效".into());
            }
        }
        for n in notes {
            if n.get("measureId")
                .is_some_and(|v| !mids.contains(v.as_str().unwrap_or("")))
            {
                return Err("音符没有对应小节".into());
            }
        }
    }
    let mut previous = 0.;
    let mut previous_end = 0.;
    for n in notes {
        let id = n["id"]
            .as_str()
            .filter(|x| !x.is_empty() && x.len() < 128)
            .ok_or("音符 ID 无效")?;
        if !ids.insert(id) {
            return Err("音符 ID 重复".into());
        }
        let beat = number(&n["beat"], "音符起点", 0., 100000.)?;
        if beat + 0.000001 < previous {
            return Err("音符须按起点排序".into());
        }
        previous = beat;
        let duration = number(&n["duration"], "音符时值", 1. / 128., 256.)?;
        if beat + 0.000001 < previous_end {
            return Err("当前版本仅支持单声部主旋律，音符不能时间重叠".into());
        }
        previous_end = beat + duration;
        if n.get("midi").is_none() {
            return Err("音符须指定 MIDI 音高或 null 休止".into());
        }
        if !n["midi"].is_null() {
            let pitch = number(&n["midi"], "MIDI 音高", 0., 127.)?;
            if pitch.fract() != 0. {
                return Err("MIDI 音高须为整数".into());
            }
        }
        let lyric = n["lyric"].as_str().ok_or("歌词须为文本")?;
        if lyric.len() > 1000 {
            return Err("单音歌词过长".into());
        }
        if !pids.contains(n["phraseId"].as_str().unwrap_or("")) {
            return Err("音符没有对应乐句".into());
        }
    }
    Ok(())
}
pub fn validate_alignment(a: &Value) -> Result<(), String> {
    number(&a["offset"], "offset", -3600., 3600.)?;
    let anchors = a["anchors"].as_array().ok_or("缺少锚点数组")?;
    if anchors.len() > 2000 {
        return Err("锚点过多".into());
    }
    let (mut b, mut s) = (-1., -1.);
    for anchor in anchors {
        let nb = number(&anchor["beat"], "锚点拍数", 0., 100000.)?;
        let ns = number(&anchor["seconds"], "锚点秒数", 0., 86400.)?;
        if nb <= b || ns <= s {
            return Err("锚点的拍数和秒数必须严格递增".into());
        }
        b = nb;
        s = ns;
    }
    Ok(())
}
fn vlq(mut n: u32) -> Vec<u8> {
    let mut out = vec![(n & 127) as u8];
    n >>= 7;
    while n > 0 {
        out.push(((n & 127) | 128) as u8);
        n >>= 7;
    }
    out.reverse();
    out
}
pub fn midi(score: &Value) -> Result<Vec<u8>, String> {
    validate_score(score)?;
    let tempo = (60_000_000. / score["bpm"].as_f64().unwrap()) as u32;
    let meter = score["timeSignature"].as_array().unwrap();
    let numerator = meter[0].as_u64().unwrap() as u8;
    let denominator = meter[1].as_u64().unwrap().ilog2() as u8;
    let mut track = vec![
        0,
        255,
        81,
        3,
        (tempo >> 16) as u8,
        (tempo >> 8) as u8,
        tempo as u8,
        0,
        255,
        88,
        4,
        numerator,
        denominator,
        24,
        8,
        0,
        192,
        0,
    ];
    let mut events: Vec<(u32, u8, u8, u8)> = vec![];
    for n in score["notes"].as_array().unwrap() {
        if let Some(pitch) = n["midi"].as_f64() {
            let start = (n["beat"].as_f64().unwrap() * 480.).round() as u32;
            let end = start + (n["duration"].as_f64().unwrap() * 480.).round() as u32;
            events.push((start, 0x90, pitch as u8, 90));
            events.push((end, 0x80, pitch as u8, 0));
        }
    }
    events.sort_by_key(|e| (e.0, e.1));
    let mut prev = 0;
    for (tick, status, pitch, vel) in events {
        track.extend(vlq(tick - prev));
        track.extend([status, pitch, vel]);
        prev = tick;
    }
    let final_tick = score["notes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| {
            ((n["beat"].as_f64().unwrap() + n["duration"].as_f64().unwrap()) * 480.).round() as u32
        })
        .max()
        .unwrap_or(0);
    track.extend(vlq(final_tick.saturating_sub(prev)));
    track.extend([255, 47, 0]);
    let mut out = b"MThd".to_vec();
    out.extend([0, 0, 0, 6, 0, 0, 0, 1, 1, 224]);
    out.extend(b"MTrk");
    out.extend((track.len() as u32).to_be_bytes());
    out.extend(track);
    Ok(out)
}
pub fn overlap(a: &Value, b: &Value) -> usize {
    let Some(an) = a["notes"].as_array() else {
        return 0;
    };
    let Some(bn) = b["notes"].as_array() else {
        return 0;
    };
    // Only a suggestion: actual deletion requires the user's explicit action.
    for k in (6..=an.len().min(bn.len()).min(250)).rev() {
        if an[an.len() - k..].iter().zip(&bn[..k]).all(|(x, y)| {
            x["midi"] == y["midi"]
                && x["lyric"] == y["lyric"]
                && (x["duration"].as_f64().unwrap_or(0.) - y["duration"].as_f64().unwrap_or(999.))
                    .abs()
                    < 0.01
        }) {
            return k;
        }
    }
    0
}
pub fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
pub fn musicxml(score: &Value, title: &str) -> Result<String, String> {
    validate_score(score)?;
    let divisions = 480.;
    let beats = score["timeSignature"][0].as_f64().unwrap();
    let beat_type = score["timeSignature"][1].as_f64().unwrap();
    let measure_beats = beats * 4. / beat_type;
    let notes = score["notes"].as_array().unwrap();
    let key = score["key"]
        .as_str()
        .unwrap_or("C")
        .trim()
        .trim_start_matches("1=")
        .replace('♭', "b")
        .replace('♯', "#");
    let fifths = match key.as_str() {
        "Cb" => -7,
        "Gb" => -6,
        "Db" => -5,
        "Ab" => -4,
        "Eb" => -3,
        "Bb" => -2,
        "F" => -1,
        "G" => 1,
        "D" => 2,
        "A" => 3,
        "E" => 4,
        "B" => 5,
        "F#" => 6,
        "C#" => 7,
        _ => 0,
    };
    let end = notes
        .iter()
        .map(|n| n["beat"].as_f64().unwrap() + n["duration"].as_f64().unwrap())
        .fold(0., f64::max);
    let mut xml = format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?><score-partwise version=\"4.0\"><work><work-title>{}</work-title></work><part-list><score-part id=\"P1\"><part-name>Piano</part-name><score-instrument id=\"I1\"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id=\"I1\"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part></part-list><part id=\"P1\">",
        xml_escape(title)
    );
    for m in 0..((end / measure_beats).ceil() as usize).max(1) {
        let start = m as f64 * measure_beats;
        let stop = start + measure_beats;
        xml.push_str(&format!("<measure number=\"{}\">", m + 1));
        if m == 0 {
            xml.push_str(&format!("<attributes><divisions>480</divisions><key><fifths>{fifths}</fifths></key><time><beats>{beats}</beats><beat-type>{beat_type}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><sound tempo=\"{}\"/></direction>",score["bpm"]));
        }
        let mut pos = start;
        for n in notes {
            let nb = n["beat"].as_f64().unwrap();
            let ne = nb + n["duration"].as_f64().unwrap();
            if nb >= stop || ne <= start {
                continue;
            }
            let from = nb.max(start);
            let to = ne.min(stop);
            if from > pos + 0.001 {
                xml.push_str(&format!(
                    "<note><rest/><duration>{}</duration></note>",
                    ((from - pos) * divisions).round() as u64
                ));
            }
            xml.push_str(&format!(
                "<note id=\"{}-m{m}\">",
                xml_escape(n["id"].as_str().unwrap())
            ));
            if let Some(p) = n["midi"].as_f64() {
                let p = p as i64;
                let sharp = [
                    ("C", 0),
                    ("C", 1),
                    ("D", 0),
                    ("D", 1),
                    ("E", 0),
                    ("F", 0),
                    ("F", 1),
                    ("G", 0),
                    ("G", 1),
                    ("A", 0),
                    ("A", 1),
                    ("B", 0),
                ];
                let flat = [
                    ("C", 0),
                    ("D", -1),
                    ("D", 0),
                    ("E", -1),
                    ("E", 0),
                    ("F", 0),
                    ("G", -1),
                    ("G", 0),
                    ("A", -1),
                    ("A", 0),
                    ("B", -1),
                    ("B", 0),
                ];
                let (name, alter) = if fifths < 0 { flat } else { sharp }[(p % 12) as usize];
                xml.push_str(&format!(
                    "<pitch><step>{name}</step><alter>{alter}</alter><octave>{}</octave></pitch>",
                    p / 12 - 1
                ));
            } else {
                xml.push_str("<rest/>");
            }
            xml.push_str(&format!(
                "<duration>{}</duration>",
                ((to - from) * divisions).round() as u64
            ));
            if nb < start {
                xml.push_str("<tie type=\"stop\"/>");
            }
            if ne > stop {
                xml.push_str("<tie type=\"start\"/>");
            }
            if nb >= start {
                if let Some(lyric) = n["lyric"].as_str().filter(|s| !s.is_empty()) {
                    xml.push_str(&format!(
                        "<lyric><text>{}</text></lyric>",
                        xml_escape(lyric)
                    ));
                }
            }
            xml.push_str("</note>");
            pos = to;
        }
        if pos < stop - 0.001 {
            xml.push_str(&format!(
                "<note><rest/><duration>{}</duration></note>",
                ((stop - pos) * divisions).round() as u64
            ));
        }
        xml.push_str("</measure>");
    }
    xml.push_str("</part></score-partwise>");
    Ok(xml)
}
