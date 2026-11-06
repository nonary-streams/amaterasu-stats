use amaterasu_module_sdk::{ApiFieldKind as Kind, ApiMethod, operation_api};

pub fn methods() -> Vec<ApiMethod> {
    let service = "nonary.stats/1";
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
        operation_api::method(service, "stats_read", &[], &[]),
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
