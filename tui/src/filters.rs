use crate::model::{Record, Section};

pub type Filters = std::collections::BTreeMap<&'static str, String>;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FieldKind {
    Text,
    Date,
    Choice(&'static [(&'static str, &'static str)]),
}

#[derive(Debug, Clone, Copy)]
pub struct FilterField {
    pub key: &'static str,
    pub label: &'static str,
    pub kind: FieldKind,
}

const fn field(key: &'static str, kind: FieldKind) -> FilterField {
    FilterField {
        key,
        label: key,
        kind,
    }
}

const PROJECTS: [FilterField; 1] = [field("org", FieldKind::Text)];
const TASKS: [FilterField; 2] = [
    field("project", FieldKind::Text),
    field("status", FieldKind::Text),
];
const EVENTS: [FilterField; 4] = [
    field("to", FieldKind::Text),
    field("from", FieldKind::Text),
    field(
        "kind",
        FieldKind::Choice(&[
            ("any", ""),
            ("turn_end", "turn_end"),
            ("waiting", "waiting"),
            ("milestone", "milestone"),
            ("message", "message"),
        ]),
    ),
    field(
        "delivered",
        FieldKind::Choice(&[("all", ""), ("pending", "false"), ("delivered", "true")]),
    ),
];
const JOURNAL: [FilterField; 4] = [
    field("scope", FieldKind::Text),
    field(
        "type",
        FieldKind::Choice(&[
            ("any", ""),
            ("note", "note"),
            ("task_created", "task_created"),
            ("status_changed", "status_changed"),
            ("title_changed", "title_changed"),
            ("worktree_created", "worktree_created"),
            ("session_opened", "session_opened"),
            ("message_sent", "message_sent"),
            ("clone_prepared", "clone_prepared"),
        ]),
    ),
    field("from", FieldKind::Date),
    field("to", FieldKind::Date),
];

pub fn fields(section: Section) -> &'static [FilterField] {
    match section {
        Section::Projects => &PROJECTS,
        Section::Tasks => &TASKS,
        Section::Events => &EVENTS,
        Section::Journal => &JOURNAL,
    }
}

pub fn validate(kind: FieldKind, value: &str) -> Result<String, String> {
    let value = value.trim();
    if kind == FieldKind::Date && !value.is_empty() {
        let bytes = value.as_bytes();
        let shaped = bytes.len() == 10
            && bytes.iter().enumerate().all(|(i, b)| match i {
                4 | 7 => *b == b'-',
                _ => b.is_ascii_digit(),
            });
        if !shaped {
            return Err("Dates are YYYY-MM-DD".into());
        }
    }
    Ok(value.to_string())
}

pub fn cycle(choices: &[(&str, &str)], current: &str) -> String {
    let next = match choices.iter().position(|(_, v)| *v == current) {
        Some(i) => (i + 1) % choices.len(),
        None => 0,
    };
    choices
        .get(next)
        .map(|(_, v)| v.to_string())
        .unwrap_or_default()
}

pub fn filter_projects(items: Vec<Record>, q: Option<&str>) -> Vec<Record> {
    let needle = match q {
        Some(q) if !q.is_empty() => q.to_lowercase(),
        _ => return items,
    };
    items
        .into_iter()
        .filter(|item| {
            ["code", "identity"].iter().any(|field| {
                item.get(*field)
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|v| v.to_lowercase().contains(&needle))
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn choices(section: Section, key: &str) -> &'static [(&'static str, &'static str)] {
        match fields(section).iter().find(|f| f.key == key).unwrap().kind {
            FieldKind::Choice(list) => list,
            _ => panic!("{key} is not a choice"),
        }
    }

    #[test]
    fn validate_cycle_and_project_search() {
        assert!(validate(FieldKind::Date, "2026-13").is_err());
        assert_eq!(
            validate(FieldKind::Date, "2026-13"),
            Err("Dates are YYYY-MM-DD".into())
        );
        assert_eq!(
            validate(FieldKind::Date, " 2026-11-03 "),
            Ok("2026-11-03".into())
        );
        assert_eq!(validate(FieldKind::Date, " "), Ok(String::new()));
        assert_eq!(validate(FieldKind::Text, " MP "), Ok("MP".into()));
        let delivered = choices(Section::Events, "delivered");
        assert_eq!(cycle(delivered, ""), "false");
        assert_eq!(cycle(delivered, "true"), "");
        assert_eq!(cycle(delivered, "odd"), "");
        assert_eq!(choices(Section::Journal, "type")[1], ("note", "note"));
        assert_eq!(choices(Section::Journal, "type").len(), 9);
        assert_eq!(
            choices(Section::Journal, "type")[8],
            ("clone_prepared", "clone_prepared")
        );
        let projects = vec![
            json!({"code": "MP", "identity": "yokeloop/mypi"}),
            json!({"code": "OT", "identity": "a/other"}),
        ]
        .into_iter()
        .map(|v| v.as_object().unwrap().clone())
        .collect::<Vec<_>>();
        let kept = filter_projects(projects.clone(), Some("MYPI"));
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0]["code"], "MP");
        assert!(filter_projects(projects.clone(), Some("поиск")).is_empty());
        assert_eq!(filter_projects(projects, None).len(), 2);
    }
}
