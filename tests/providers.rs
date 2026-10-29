use music_practice::server::model_names;
use serde_json::json;
#[test]
fn model_list_limits_remote_count_and_names() {
    assert_eq!(
        model_names(&json!({"data":[{"id":"vlm"}]})).unwrap(),
        vec!["vlm"]
    );
    assert!(model_names(&json!({"data":vec![json!({"id":"x"});513]})).is_err());
    assert!(model_names(&json!({"data":[{"id":"x".repeat(1000)}]})).is_err());
    assert!(model_names(&json!({"something":"else"})).is_err());
}
