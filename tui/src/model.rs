use serde_json::Value;

pub type Record = serde_json::Map<String, Value>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Section {
    Projects,
    Tasks,
    Events,
    Journal,
}

pub const SECTIONS: [Section; 4] = [
    Section::Projects,
    Section::Tasks,
    Section::Events,
    Section::Journal,
];

impl Section {
    pub fn title(self) -> &'static str {
        match self {
            Section::Projects => "Projects",
            Section::Tasks => "Tasks",
            Section::Events => "Events",
            Section::Journal => "Journal",
        }
    }

    pub fn index(self) -> usize {
        match self {
            Section::Projects => 0,
            Section::Tasks => 1,
            Section::Events => 2,
            Section::Journal => 3,
        }
    }

    pub fn known(self) -> &'static [&'static str] {
        match self {
            Section::Projects => &[
                "code",
                "org",
                "slug",
                "identity",
                "repository",
                "checkoutPath",
            ],
            Section::Tasks => &[
                "key",
                "project",
                "number",
                "title",
                "status",
                "isTerminal",
                "contextDir",
                "worktreePath",
                "createdAt",
                "updatedAt",
            ],
            Section::Events => &[
                "id",
                "from",
                "to",
                "kind",
                "text",
                "createdAt",
                "deliveredAt",
            ],
            Section::Journal => &["id", "at", "scope", "type", "text", "artifacts"],
        }
    }

    pub fn identity(self, r: &Record) -> Option<String> {
        let field = match self {
            Section::Projects => "code",
            Section::Tasks => "key",
            Section::Events | Section::Journal => "id",
        };
        r.get(field).map(|v| display(Some(v)))
    }

    pub fn open_key(self, r: &Record) -> Option<String> {
        let (field, valid): (&str, fn(&str) -> bool) = match self {
            Section::Projects => ("code", is_project_code),
            Section::Tasks => ("key", is_task_key),
            Section::Events | Section::Journal => return None,
        };
        r.get(field)
            .and_then(Value::as_str)
            .filter(|s| valid(s))
            .map(str::to_string)
    }
}

pub fn is_project_code(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_uppercase())
}

pub fn is_task_key(s: &str) -> bool {
    match s.rsplit_once('-') {
        Some((code, number)) => {
            is_project_code(code)
                && !number.is_empty()
                && !number.starts_with('0')
                && number.chars().all(|c| c.is_ascii_digit())
        }
        None => false,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    Plain,
    Dim,
    Accent,
    Good,
    Warn,
    Muted,
}

pub fn display(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => "—".to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(v @ (Value::Number(_) | Value::Bool(_))) => v.to_string(),
        Some(v) => serde_json::to_string(v).unwrap_or_default(),
    }
}

pub fn extra_fields(r: &Record, known: &[&str]) -> Vec<(String, String)> {
    r.iter()
        .filter(|(k, _)| !known.contains(&k.as_str()))
        .map(|(k, v)| (k.clone(), display(Some(v))))
        .collect()
}

fn line(r: &Record, field: &str) -> String {
    display(r.get(field))
        .lines()
        .next()
        .unwrap_or("")
        .to_string()
}

fn scope(r: &Record) -> String {
    match r.get("scope") {
        Some(Value::Object(scope)) => display(scope.get("key").or_else(|| scope.get("type"))),
        other => display(other),
    }
}

fn artifacts(value: Option<&Value>) -> String {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| match item {
                Value::Object(a) => {
                    let path = display(a.get("path"));
                    match a.get("commit").and_then(Value::as_str) {
                        Some(commit) => {
                            format!("{path} @ {}", commit.chars().take(12).collect::<String>())
                        }
                        None => path,
                    }
                }
                other => display(Some(other)),
            })
            .collect::<Vec<_>>()
            .join("\n"),
        other => display(other),
    }
}

pub fn summary(section: Section, r: &Record) -> Vec<(String, Tone)> {
    match section {
        Section::Projects => vec![
            (line(r, "code"), Tone::Accent),
            (line(r, "identity"), Tone::Plain),
        ],
        Section::Tasks => {
            let status = if r.get("isTerminal") == Some(&Value::Bool(true)) {
                Tone::Muted
            } else {
                Tone::Good
            };
            vec![
                (line(r, "key"), Tone::Accent),
                (line(r, "status"), status),
                (line(r, "title"), Tone::Plain),
            ]
        }
        Section::Events => {
            let kind = line(r, "kind");
            let tone = match kind.as_str() {
                "message" => Tone::Accent,
                "turn_end" | "milestone" => Tone::Good,
                "waiting" => Tone::Warn,
                _ => Tone::Muted,
            };
            let mut cells = vec![
                (kind, tone),
                (
                    format!("{} → {}", line(r, "from"), line(r, "to")),
                    Tone::Dim,
                ),
            ];
            if matches!(r.get("deliveredAt"), None | Some(Value::Null)) {
                cells.push(("●".to_string(), Tone::Warn));
            }
            cells.push((line(r, "text"), Tone::Plain));
            cells
        }
        Section::Journal => {
            let at: String = line(r, "at")
                .chars()
                .take(16)
                .map(|c| if c == 'T' { ' ' } else { c })
                .collect();
            let kind = line(r, "type");
            let tone = match kind.as_str() {
                "note" => Tone::Accent,
                "task_created" => Tone::Good,
                "status_changed" => Tone::Warn,
                _ => Tone::Muted,
            };
            vec![
                (at, Tone::Dim),
                (kind, tone),
                (scope(r), Tone::Dim),
                (line(r, "text"), Tone::Plain),
            ]
        }
    }
}

pub fn details(section: Section, r: &Record) -> Vec<(String, String)> {
    let known = section.known();
    let mut pairs: Vec<(String, String)> = known
        .iter()
        .map(|&field| {
            let value = match (section, field) {
                (Section::Journal, "scope") => scope(r),
                (_, "artifacts") => artifacts(r.get(field)),
                _ => display(r.get(field)),
            };
            (field.to_string(), value)
        })
        .collect();
    let extra = extra_fields(r, known);
    if !extra.is_empty() {
        pairs.push(("Other fields".to_string(), String::new()));
        pairs.extend(extra);
    }
    pairs
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn record(value: Value) -> Record {
        value.as_object().unwrap().clone()
    }

    fn pair(label: &str, value: &str) -> (String, String) {
        (label.to_string(), value.to_string())
    }

    #[test]
    fn display_and_extra_fields_show_any_value_in_record_order() {
        assert_eq!(display(None), "—");
        assert_eq!(display(Some(&json!(null))), "—");
        assert_eq!(display(Some(&json!({"a": [1]}))), r#"{"a":[1]}"#);
        assert_eq!(display(Some(&json!(false))), "false");
        assert_eq!(display(Some(&json!("x y"))), "x y");
        let r = record(json!({"key": "MP-1", "zeta": 1, "alpha": null}));
        assert_eq!(
            extra_fields(&r, &["key"]),
            vec![pair("zeta", "1"), pair("alpha", "—")]
        );
    }

    #[test]
    fn unknown_kinds_statuses_and_missing_fields_render_generically() {
        let event = record(json!({"kind": "future", "from": "MP"}));
        let cells = summary(Section::Events, &event);
        assert_eq!(cells[0], ("future".to_string(), Tone::Muted));
        assert_eq!(cells[1], ("MP → —".to_string(), Tone::Dim));
        assert_eq!(cells[2], ("●".to_string(), Tone::Warn));
        let task = record(json!({"key": "MP-1", "status": "someday"}));
        let cells = summary(Section::Tasks, &task);
        assert_eq!(cells[1], ("someday".to_string(), Tone::Good));
        assert_eq!(cells[2], ("—".to_string(), Tone::Plain));
        let task = record(json!({"key": "MP-1", "title": "a\nb", "priority": 3}));
        assert_eq!(summary(Section::Tasks, &task)[2].0, "a");
        let shown = details(Section::Tasks, &task);
        assert!(shown.contains(&pair("Other fields", "")));
        assert!(shown.contains(&pair("priority", "3")));
        assert_eq!(shown[0], pair("key", "MP-1"));
    }

    #[test]
    fn open_keys_only_for_valid_project_and_task_rows() {
        let open = |section: Section, value: Value| section.open_key(&record(value));
        assert_eq!(
            open(Section::Projects, json!({"code": "MP"})),
            Some("MP".into())
        );
        assert_eq!(open(Section::Projects, json!({"code": "mp"})), None);
        assert_eq!(
            open(Section::Tasks, json!({"key": "MP-12"})),
            Some("MP-12".into())
        );
        assert_eq!(open(Section::Tasks, json!({"key": "MP-0"})), None);
        assert_eq!(open(Section::Tasks, json!({"key": "MP-12; rm"})), None);
        assert_eq!(
            open(
                Section::Events,
                json!({"id": 1, "key": "MP-1", "code": "MP"})
            ),
            None
        );
    }

    #[test]
    fn journal_details_show_scope_and_artifacts() {
        let entry = record(json!({
            "id": 5,
            "scope": {"type": "task", "key": "MP-1"},
            "artifacts": [{"path": "a", "commit": "0123456789abcdef"}, {"path": "b", "commit": null}, "c"]
        }));
        let shown = details(Section::Journal, &entry);
        assert!(shown.contains(&pair("scope", "MP-1")));
        assert!(shown.contains(&pair("artifacts", "a @ 0123456789ab\nb\nc")));
        let global = record(json!({"scope": {"type": "global"}}));
        assert!(details(Section::Journal, &global).contains(&pair("scope", "global")));
    }
}
