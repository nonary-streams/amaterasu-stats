use amaterasu_module_sdk::{ApiFieldKind as Kind, ApiMethod, operation_api};
pub(crate) fn methods() -> Vec<ApiMethod> {
    let service = "nonary.stats-history/1";
    vec![
        operation_api::method(service, "settings_get", &[], &[]),
        operation_api::method(
            service,
            "settings_update",
            &[
                ("settings", Kind::Object),
                ("expected_revision", Kind::Integer),
            ],
            &[],
        ),
        operation_api::method(service, "history_status", &[], &[]),
        operation_api::method(
            service,
            "list_sessions",
            &[],
            &[("limit", Kind::Integer), ("offset", Kind::Integer)],
        ),
        operation_api::method(
            service,
            "session_detail",
            &[("session_id", Kind::String)],
            &[],
        ),
        operation_api::method(
            service,
            "timeline_open",
            &[("session_id", Kind::String)],
            &[("sample_limit", Kind::Integer)],
        ),
        operation_api::method(
            service,
            "timeline_page",
            &[
                ("session_id", Kind::String),
                ("kind", Kind::String),
                ("cursor", Kind::Object),
            ],
            &[("limit", Kind::Integer)],
        ),
        operation_api::method(
            service,
            "delete_session",
            &[("session_id", Kind::String)],
            &[],
        ),
    ]
}

#[cfg(test)]
mod tests {
    #[test]
    fn published_contract_matches_registered_methods() {
        let published: serde_json::Value =
            serde_json::from_str(include_str!("../metadata/api.json")).unwrap();
        assert_eq!(serde_json::to_value(super::methods()).unwrap(), published);
    }
}
