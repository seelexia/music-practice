use music_practice::score_package::{compile, rhythm_fraction, template};
use serde_json::{Value, json};
use std::collections::HashMap;
#[test]
fn explicit_null_symbols_are_not_defaulted() {
    for field in ["octave", "accidental"] {
        let mut p = template();
        p["measures"][0]["notes"][0][field] = Value::Null;
        assert!(compile(&p, &current(), &HashMap::new()).is_err());
    }
    for field in ["underlines", "dots", "extensions", "tuplet"] {
        assert!(rhythm_fraction(&json!({field:Value::Null})).is_err());
    }
    let mut p = template();
    p["measures"][0]["row"] = Value::Null;
    assert!(compile(&p, &current(), &HashMap::new()).is_err());
}
fn current() -> Value {
    json!({"key":"E","bpm":93,"timeSignature":[3,4]})
}
#[test]
fn exact_rhythm_and_observed_duration_must_agree() {
    assert_eq!(
        rhythm_fraction(&json!({"underlines":1,"dots":1,"extensions":2,"tuplet":[3,2]})).unwrap(),
        [5, 2]
    );
    let mut p = template();
    p["measures"][0]["notes"][0]["rhythm"] = json!({"underlines":1,"dots":0,"extensions":0});
    assert!(
        compile(&p, &current(), &HashMap::new())
            .unwrap_err()
            .contains("duration")
    );
}
#[test]
fn template_compiles_and_preserves_source_and_pitch() {
    let p = template();
    let mut map = HashMap::new();
    map.insert("page-1".into(), "asset-fixture".into());
    let c = compile(&p, &current(), &map).unwrap();
    assert_eq!(c.score["notes"][0]["midi"], 60);
    assert_eq!(c.score["notes"][0]["sourcePage"], "asset-fixture");
    assert_eq!(c.score["measures"][0]["duration"], 4.0);
    music_practice::score::validate_score(&c.score).unwrap();
}
#[test]
fn inheritance_and_irregular_bar_warn_without_rescaling() {
    let mut p = template();
    p["metadata"] = json!({"key":null,"bpm":null,"timeSignature":null});
    p["measures"][0]["notes"]
        .as_array_mut()
        .unwrap()
        .truncate(1);
    let c = compile(&p, &current(), &HashMap::new()).unwrap();
    assert_eq!(c.score["key"], "E");
    assert_eq!(c.score["notes"][0]["midi"], 64);
    assert_eq!(c.score["notes"][0]["duration"], 1.0);
    assert!(c.warnings.len() >= 4);
    assert!(
        c.quality_issues
            .iter()
            .any(|q| q["kind"] == "measure-duration")
    );
}
#[test]
fn ties_merge_sounding_events_but_keep_printed_fragments() {
    let mut p = template();
    p["measures"][0]["notes"]
        .as_array_mut()
        .unwrap()
        .truncate(1);
    p["measures"].as_array_mut().unwrap().push(json!({"id":"m2","sourceId":"page-1","row":2,"notes":[{"id":"n2","degree":1,"octave":0,"duration":[3,2],"lyric":"","phraseId":"p1","tieFrom":"n1"}]}));
    let c = compile(&p, &current(), &HashMap::new()).unwrap();
    assert_eq!(c.score["notes"].as_array().unwrap().len(), 1);
    assert_eq!(c.score["notes"][0]["duration"], 2.5);
    assert_eq!(c.score["measures"][1]["duration"], 1.5);
    p["measures"][1]["notes"][0]["degree"] = json!(2);
    assert!(compile(&p, &current(), &HashMap::new()).is_err());
}
#[test]
fn rejects_invalid_data_with_actionable_paths() {
    for (field, value) in [
        ("duration", json!([1, 0])),
        ("degree", json!(8)),
        ("phraseId", json!("missing")),
        ("octave", json!(20)),
    ] {
        let mut p = template();
        p["measures"][0]["notes"][0][field] = value;
        let e = compile(&p, &current(), &HashMap::new()).unwrap_err();
        assert!(e.contains("$.measures[0].notes[0]"), "{e}");
    }
    let mut p = template();
    p["measures"][0]["notes"][1]["id"] = json!("n1");
    assert!(compile(&p, &current(), &HashMap::new()).is_err());
    let mut p = template();
    p["measures"][0]["notes"][0]["degree"] = Value::Null;
    assert!(compile(&p, &current(), &HashMap::new()).is_err());
    p["measures"][0]["notes"][0]["uncertain"] = json!(true);
    let c = compile(&p, &current(), &HashMap::new()).unwrap();
    assert_eq!(c.score["notes"][0]["midi"], Value::Null);
    assert_eq!(c.score["notes"][0]["degree"], Value::Null);
}
#[test]
fn invalid_tuplet_data_cannot_panic() {
    for t in [
        json!([null, 2]),
        json!([2, null]),
        json!([0, 2]),
        json!([2, 0]),
        json!([17, 2]),
        json!([2]),
        json!({}),
    ] {
        assert!(rhythm_fraction(&json!({"tuplet":t})).is_err());
    }
}
#[test]
fn rejects_silent_schema_typos_and_impossible_references() {
    let mut p = template();
    p["measures"][0]["notes"][0]["duraton"] = json!([1, 1]);
    assert!(
        compile(&p, &current(), &HashMap::new())
            .unwrap_err()
            .contains("duraton")
    );
    let mut p = template();
    p["measures"][0]["sourceId"] = json!("unknown");
    assert!(compile(&p, &current(), &HashMap::new()).is_err());
    let mut p = template();
    p["measures"][0]["notes"][1]["tieFrom"] = json!("n1");
    assert!(compile(&p, &current(), &HashMap::new()).is_err());
    let mut p = template();
    p["metadata"]["timeSignature"] = json!([4, 3]);
    assert!(compile(&p, &current(), &HashMap::new()).is_err());
    let mut p = template();
    p["provenance"] = json!({"comment":"x".repeat(2*1024*1024)});
    assert!(
        compile(&p, &current(), &HashMap::new())
            .unwrap_err()
            .contains("2 MB")
    );
}
