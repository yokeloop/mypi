use std::io::{BufRead, BufReader};
use std::time::Duration;

use serde_json::Value;

use crate::filters::Filters;
use crate::model::{Record, Section, display, is_project_code, is_task_key};

pub const API_VERSION: u64 = 1;
pub const PAGE_LIMIT: usize = 50;
pub const RELOAD_MAX: usize = 200;

#[derive(Debug, Clone, PartialEq)]
pub struct ApiFailure {
    pub status: u16,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Page {
    pub items: Vec<Record>,
    pub next: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Info {
    pub version: String,
    pub schema_version: String,
    pub instance: String,
}

fn failure(status: u16, code: &str, message: String) -> ApiFailure {
    ApiFailure {
        status,
        code: code.to_string(),
        message,
    }
}

fn bad_response(status: u16) -> ApiFailure {
    failure(
        status,
        "bad_response",
        "Unexpected response (not a mypi API?)".into(),
    )
}

pub fn unwrap(status: u16, body: &str) -> Result<Value, ApiFailure> {
    let ok = (200..=299).contains(&status);
    let http_error = || failure(status, "http_error", format!("HTTP {status}"));
    let mut envelope = match serde_json::from_str::<Value>(body) {
        Ok(Value::Object(envelope)) => envelope,
        _ if ok => return Err(bad_response(status)),
        _ => return Err(http_error()),
    };
    let version = envelope.get("apiVersion");
    if version.and_then(Value::as_u64) != Some(API_VERSION) {
        return Err(failure(
            status,
            "unsupported_api",
            format!(
                "The API speaks apiVersion {}; this TUI understands {API_VERSION}",
                display(version)
            ),
        ));
    }
    if let Some(Value::Object(error)) = envelope.get("error") {
        let text = |field: &str| error.get(field).and_then(Value::as_str).map(str::to_string);
        return Err(failure(
            status,
            &text("code").unwrap_or_else(|| format!("http_{status}")),
            text("message").unwrap_or_else(|| format!("HTTP {status}")),
        ));
    }
    if !ok {
        return Err(http_error());
    }
    envelope.remove("data").ok_or_else(|| bad_response(status))
}

pub fn as_page(data: Value) -> Result<Page, ApiFailure> {
    let Value::Object(mut data) = data else {
        return Err(bad_response(200));
    };
    let Some(Value::Array(items)) = data.remove("items") else {
        return Err(bad_response(200));
    };
    let items = items
        .into_iter()
        .filter_map(|item| match item {
            Value::Object(record) => Some(record),
            _ => None,
        })
        .collect();
    let next = match data.remove("next") {
        Some(Value::String(next)) => Some(next),
        _ => None,
    };
    Ok(Page { items, next })
}

pub fn as_info(data: Value) -> Result<Info, ApiFailure> {
    let Value::Object(data) = data else {
        return Err(bad_response(200));
    };
    Ok(Info {
        version: display(data.get("version")),
        schema_version: display(data.get("schemaVersion")),
        instance: display(data.get("instance")),
    })
}

pub fn list_request(
    section: Section,
    filters: &Filters,
    cursor: Option<&str>,
    limit: usize,
) -> (&'static str, Vec<(&'static str, String)>) {
    let (path, keys): (&'static str, &[&'static str]) = match section {
        Section::Projects => ("/v1/projects", &["org"]),
        Section::Tasks => ("/v1/tasks", &["project", "status", "q", "cursor", "limit"]),
        Section::Events => (
            "/v1/events",
            &["to", "from", "kind", "delivered", "q", "cursor", "limit"],
        ),
        Section::Journal => (
            "/v1/journal",
            &["scope", "type", "from", "to", "q", "cursor", "limit"],
        ),
    };
    let query = keys
        .iter()
        .filter_map(|&key| {
            let value = match key {
                "cursor" => cursor.map(str::to_string),
                "limit" => Some(limit.to_string()),
                _ => filters.get(key).map(|v| v.trim().to_string()),
            }
            .filter(|v| !v.is_empty())?;
            let value = match (section, key) {
                (Section::Events, "delivered") if value != "true" && value != "false" => {
                    return None;
                }
                (Section::Journal, "from") => format!("{value}T00:00:00Z"),
                (Section::Journal, "to") => format!("{value}T23:59:59Z"),
                (Section::Journal, "scope") if is_project_code(&value) => {
                    format!("project:{value}")
                }
                (Section::Journal, "scope") if is_task_key(&value) => format!("task:{value}"),
                _ => value,
            };
            Some((key, value))
        })
        .collect();
    (path, query)
}

#[derive(Clone)]
pub struct Client {
    base: String,
    token: String,
    agent: ureq::Agent,
    stream: ureq::Agent,
}

impl Client {
    pub fn new(base: String, token: String) -> Client {
        let agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(10)))
            .build()
            .new_agent();
        let stream = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(None)
            .timeout_connect(Some(Duration::from_secs(5)))
            .build()
            .new_agent();
        Client {
            base,
            token,
            agent,
            stream,
        }
    }

    fn unreachable(&self, error: ureq::Error) -> ApiFailure {
        failure(
            0,
            "unreachable",
            format!(
                "Cannot reach the mypi API at {}: {error}. Start it with mypi serve",
                self.base
            ),
        )
    }

    pub fn get(&self, path: &str, query: &[(&'static str, String)]) -> Result<Value, ApiFailure> {
        let mut response = self
            .agent
            .get(format!("{}{}", self.base, path))
            .query_pairs(query.iter().map(|(k, v)| (*k, v.as_str())))
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Accept", "application/json")
            .call()
            .map_err(|e| self.unreachable(e))?;
        let status = response.status().as_u16();
        let body = response
            .body_mut()
            .read_to_string()
            .map_err(|e| self.unreachable(e))?;
        unwrap(status, &body)
    }

    pub fn changes(&self) -> Result<Box<dyn BufRead + Send>, ApiFailure> {
        let mut response = self
            .stream
            .get(format!("{}/v1/changes", self.base))
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Accept", "text/event-stream")
            .call()
            .map_err(|e| self.unreachable(e))?;
        let status = response.status().as_u16();
        if status == 200 {
            return Ok(Box::new(BufReader::new(response.into_body().into_reader())));
        }
        let body = response
            .body_mut()
            .read_to_string()
            .map_err(|e| self.unreachable(e))?;
        Err(unwrap(status, &body)
            .err()
            .unwrap_or_else(|| failure(status, "http_error", format!("HTTP {status}"))))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn failure(status: u16, code: &str, message: &str) -> ApiFailure {
        ApiFailure {
            status,
            code: code.into(),
            message: message.into(),
        }
    }

    fn filters(pairs: &[(&'static str, &str)]) -> Filters {
        pairs.iter().map(|(k, v)| (*k, v.to_string())).collect()
    }

    fn pairs(list: &[(&'static str, &str)]) -> Vec<(&'static str, String)> {
        list.iter().map(|(k, v)| (*k, v.to_string())).collect()
    }

    #[test]
    fn unwrap_returns_data_and_maps_error_envelopes_versions_and_non_json() {
        assert_eq!(
            unwrap(200, r#"{"apiVersion":1,"data":{"a":1}}"#),
            Ok(json!({"a": 1}))
        );
        assert_eq!(
            unwrap(
                401,
                r#"{"apiVersion":1,"error":{"code":"unauthorized","message":"m"}}"#
            ),
            Err(failure(401, "unauthorized", "m"))
        );
        assert_eq!(
            unwrap(500, r#"{"apiVersion":1,"error":{"code":7}}"#),
            Err(failure(500, "http_500", "HTTP 500"))
        );
        assert_eq!(
            unwrap(200, r#"{"apiVersion":2,"data":{}}"#),
            Err(failure(
                200,
                "unsupported_api",
                "The API speaks apiVersion 2; this TUI understands 1"
            ))
        );
        assert_eq!(
            unwrap(200, r#"{"data":{}}"#),
            Err(failure(
                200,
                "unsupported_api",
                "The API speaks apiVersion —; this TUI understands 1"
            ))
        );
        assert_eq!(
            unwrap(502, "<html>"),
            Err(failure(502, "http_error", "HTTP 502"))
        );
        assert_eq!(
            unwrap(503, r#"{"apiVersion":1}"#),
            Err(failure(503, "http_error", "HTTP 503"))
        );
        let bad = failure(200, "bad_response", "Unexpected response (not a mypi API?)");
        assert_eq!(unwrap(200, "<html>"), Err(bad.clone()));
        assert_eq!(unwrap(200, r#"{"apiVersion":1}"#), Err(bad.clone()));
        assert_eq!(unwrap(200, "[1]"), Err(bad));
    }

    #[test]
    fn as_page_keeps_object_items_and_a_string_next() {
        let page =
            as_page(json!({"items":[{"key":"MP-1"},3,null,[]],"next":"abc","extra":1})).unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0]["key"], "MP-1");
        assert_eq!(page.next, Some("abc".into()));
        assert_eq!(as_page(json!({"items":[],"next":5})).unwrap().next, None);
        assert_eq!(as_page(json!({})).unwrap_err().code, "bad_response");
        let info = as_info(json!({"version":"0.10.0","schemaVersion":12,"instance":"i"})).unwrap();
        assert_eq!(info.version, "0.10.0");
        assert_eq!(info.schema_version, "12");
        assert_eq!(info.instance, "i");
        assert_eq!(as_info(json!([])).unwrap_err().code, "bad_response");
    }

    #[test]
    fn list_requests_send_only_known_non_empty_parameters_in_order() {
        assert_eq!(
            list_request(
                Section::Tasks,
                &filters(&[("project", "MP"), ("q", " ")]),
                Some("Y3Vy"),
                50
            ),
            (
                "/v1/tasks",
                pairs(&[("project", "MP"), ("cursor", "Y3Vy"), ("limit", "50")])
            )
        );
        assert_eq!(
            list_request(
                Section::Events,
                &filters(&[("delivered", "maybe"), ("kind", "message")]),
                None,
                50
            ),
            ("/v1/events", pairs(&[("kind", "message"), ("limit", "50")]))
        );
        assert_eq!(
            list_request(
                Section::Events,
                &filters(&[("delivered", "false")]),
                None,
                50
            )
            .1,
            pairs(&[("delivered", "false"), ("limit", "50")])
        );
        assert_eq!(
            list_request(
                Section::Journal,
                &filters(&[
                    ("from", "2026-11-01"),
                    ("to", "2026-11-03"),
                    ("scope", "MP")
                ]),
                None,
                50
            ),
            (
                "/v1/journal",
                pairs(&[
                    ("scope", "project:MP"),
                    ("from", "2026-11-01T00:00:00Z"),
                    ("to", "2026-11-03T23:59:59Z"),
                    ("limit", "50")
                ])
            )
        );
        assert_eq!(
            list_request(Section::Journal, &filters(&[("scope", "MP-1")]), None, 50).1[0],
            ("scope", "task:MP-1".to_string())
        );
        assert_eq!(
            list_request(Section::Journal, &filters(&[("scope", "fx/one")]), None, 50).1[0],
            ("scope", "fx/one".to_string())
        );
        assert_eq!(
            list_request(
                Section::Projects,
                &filters(&[("org", "yokeloop"), ("q", "x")]),
                Some("c"),
                50
            ),
            ("/v1/projects", pairs(&[("org", "yokeloop")]))
        );
    }
}
