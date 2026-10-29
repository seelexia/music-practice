use music_practice::score::*;
use serde_json::{Value, json};
fn fixture() -> Value {
    json!({"bpm":120,"key":"C","timeSignature":[4,4],"status":"review","phrases":[{"id":"p","label":"一句"}],"notes":[{"id":"n1","beat":0,"duration":1,"midi":60,"degree":1,"octave":0,"lyric":"你","phraseId":"p"},{"id":"n2","beat":1,"duration":2,"midi":62,"degree":2,"octave":0,"lyric":"好","phraseId":"p"}]})
}
#[test]
fn accepts_real_score_and_rejects_bad_note() {
    let mut s = fixture();
    assert!(validate_score(&s).is_ok());
    s["notes"][0]["duration"] = json!(0);
    assert!(validate_score(&s).is_err());
    s = fixture();
    s["notes"][1]["id"] = json!("n1");
    assert!(validate_score(&s).is_err());
    s = fixture();
    s["notes"][0]["midi"] = json!(128);
    assert!(validate_score(&s).is_err());
}
#[test]
fn validates_monotonic_anchors() {
    assert!(
        validate_alignment(
            &json!({"offset":-2,"anchors":[{"beat":0,"seconds":2},{"beat":4,"seconds":6}]})
        )
        .is_ok()
    );
    assert!(
        validate_alignment(
            &json!({"offset":0,"anchors":[{"beat":4,"seconds":6},{"beat":2,"seconds":7}]})
        )
        .is_err()
    );
}
#[test]
fn midi_has_piano_notes_and_real_duration() {
    let b = midi(&fixture()).unwrap();
    assert_eq!(&b[..4], b"MThd");
    assert!(b.windows(2).any(|x| x == [0xc0, 0]));
    assert!(b.windows(3).any(|x| x == [0x90, 60, 90]));
    assert!(b.windows(3).any(|x| x == [0x80, 62, 0]));
    assert!(b.ends_with(&[0, 255, 47, 0]));
}
#[test]
fn integer_float_pitch_remains_a_note_in_exports() {
    let mut s = fixture();
    s["notes"][0]["midi"] = json!(60.0);
    assert!(validate_score(&s).is_ok());
    let b = midi(&s).unwrap();
    assert!(b.windows(3).any(|x| x == [0x90, 60, 90]));
    let xml = musicxml(&s, "float").unwrap();
    assert!(xml.contains("<step>C</step><alter>0</alter><octave>4</octave>"));
}
#[test]
fn rejects_unsupported_overlap_and_keeps_valid_gaps() {
    let mut s = fixture();
    s["notes"][1]["beat"] = json!(0.5);
    assert!(validate_score(&s).is_err());
    s["notes"][1]["beat"] = json!(2);
    assert!(validate_score(&s).is_ok());
}
#[test]
fn midi_keeps_trailing_rests_and_meter() {
    let mut s = fixture();
    s["notes"][1]["midi"] = Value::Null;
    s["notes"][1]["duration"] = json!(3);
    s["timeSignature"] = json!([6, 8]);
    let b = midi(&s).unwrap();
    assert!(b.ends_with(&[0x8b, 0x20, 0xff, 0x2f, 0]));
    assert!(b.windows(7).any(|x| x == [255, 88, 4, 6, 3, 24, 8]));
    s["notes"][0]["midi"] = Value::Null;
    assert!(midi(&s).unwrap().ends_with(&[0x8f, 0, 0xff, 0x2f, 0]));
}
#[test]
fn musicxml_has_key_and_unique_tied_fragments() {
    let mut s = fixture();
    s["key"] = json!("Bb");
    s["notes"].as_array_mut().unwrap().truncate(1);
    s["notes"][0]["duration"] = json!(8);
    let x = musicxml(&s, "example").unwrap();
    assert!(x.contains("<fifths>-2</fifths>"));
    assert!(x.contains("<tie type=\"start\"/>"));
    assert!(x.contains("<tie type=\"stop\"/>"));
    let ids: Vec<_> = regex::Regex::new("<note id=\"([^\"]+)\"")
        .unwrap()
        .captures_iter(&x)
        .map(|c| c[1].to_string())
        .collect();
    assert_eq!(ids.len(), 2);
    assert_ne!(ids[0], ids[1]);
}
#[test]
fn overlap_requires_multiple_matching_notes() {
    let mut s = fixture();
    let base = s["notes"].as_array().unwrap().clone();
    let notes = s["notes"].as_array_mut().unwrap();
    for i in 0..6 {
        let mut n = base[i % 2].clone();
        n["midi"] = json!(60 + i);
        notes.push(n);
    }
    assert_eq!(overlap(&s, &s), 8);
    let mut b = s.clone();
    b["notes"][0]["midi"] = json!(80);
    assert_eq!(overlap(&s, &b), 0);
}
