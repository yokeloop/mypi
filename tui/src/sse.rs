use std::time::Duration;

pub const RETRY: Duration = Duration::from_secs(2);

#[derive(Debug, PartialEq)]
pub struct SseEvent {
    pub event: String,
    pub data: String,
}

#[derive(Default)]
pub struct SseParser {
    event: String,
    data: Vec<String>,
}

impl SseParser {
    pub fn push(&mut self, line: &str) -> Option<SseEvent> {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.is_empty() {
            let event = std::mem::take(&mut self.event);
            let data = std::mem::take(&mut self.data);
            if data.is_empty() {
                return None;
            }
            return Some(SseEvent {
                event: if event.is_empty() {
                    "message".to_string()
                } else {
                    event
                },
                data: data.join("\n"),
            });
        }
        if line.starts_with(':') {
            return None;
        }
        let (field, value) = line.split_once(':').unwrap_or((line, ""));
        let value = value.strip_prefix(' ').unwrap_or(value);
        match field {
            "event" => self.event = value.to_string(),
            "data" => self.data.push(value.to_string()),
            _ => {}
        }
        None
    }
}

#[derive(Default)]
pub struct ChangeState {
    last: Option<u64>,
    stale: bool,
}

impl ChangeState {
    pub fn on_change(&mut self, data: &str) -> bool {
        let id = serde_json::from_str::<serde_json::Value>(data)
            .ok()
            .and_then(|v| v.get("changeId").and_then(serde_json::Value::as_u64));
        let Some(id) = id else {
            return false;
        };
        let refetch = self.stale || (self.last.is_some() && self.last != Some(id));
        self.last = Some(id);
        self.stale = false;
        refetch
    }

    pub fn on_disconnect(&mut self) {
        self.stale = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(parser: &mut SseParser, lines: &[&str]) -> Vec<SseEvent> {
        lines.iter().filter_map(|line| parser.push(line)).collect()
    }

    #[test]
    fn parser_yields_change_events_and_skips_comments_ids_and_retry() {
        let mut parser = SseParser::default();
        assert_eq!(
            feed(
                &mut parser,
                &[
                    "retry: 2000",
                    "id: 7",
                    "event: change",
                    "data: {\"changeId\":7}",
                    ""
                ]
            ),
            vec![SseEvent {
                event: "change".into(),
                data: "{\"changeId\":7}".into()
            }]
        );
        assert!(feed(&mut parser, &[": keepalive", ""]).is_empty());
        assert_eq!(
            feed(&mut parser, &["data: a\r", "data: b", ""]),
            vec![SseEvent {
                event: "message".into(),
                data: "a\nb".into()
            }]
        );
    }

    #[test]
    fn change_tracking_refetches_on_a_new_id_or_after_a_disconnect_and_ignores_the_first_and_malformed()
     {
        let mut changes = ChangeState::default();
        assert!(!changes.on_change(r#"{"changeId":3}"#));
        assert!(!changes.on_change(r#"{"changeId":3}"#));
        assert!(changes.on_change(r#"{"changeId":4}"#));
        assert!(!changes.on_change("nope"));
        assert_eq!(changes.last, Some(4));
        changes.on_disconnect();
        assert!(changes.on_change(r#"{"changeId":4}"#));
        assert!(!changes.on_change(r#"{"changeId":4}"#));
    }
}
