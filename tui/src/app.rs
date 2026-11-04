use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};

use crate::api::{ApiFailure, Info, PAGE_LIMIT, Page, RELOAD_MAX, list_request};
use crate::filters::{FieldKind, Filters, cycle, fields, filter_projects, validate};
use crate::model::{Record, SECTIONS, Section};
use crate::sse::ChangeState;

pub enum Msg {
    Info(Result<Info, ApiFailure>),
    Loaded {
        section: Section,
        generation: u64,
        kind: LoadKind,
        result: Result<Page, ApiFailure>,
    },
    StreamUp,
    StreamDown(String),
    Change(String),
    OpenProgress(String),
    Opened(String),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LoadKind {
    Replace,
    Append,
    Reload,
}

#[derive(Debug, PartialEq)]
pub enum Effect {
    Info,
    Load {
        section: Section,
        generation: u64,
        kind: LoadKind,
        path: &'static str,
        query: Vec<(&'static str, String)>,
    },
    Open(String),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum View {
    List,
    Detail,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Focus {
    Normal,
    Search(String),
    Filters {
        selected: usize,
        editing: Option<String>,
        before: Filters,
    },
    Help,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Action {
    Section(Section),
    NextSection,
    PrevSection,
    Up,
    Down,
    PageUp,
    PageDown,
    Home,
    End,
    Select(usize),
    Activate,
    Back,
    Open,
    Refresh,
    LoadMore,
    Search,
    Filters,
    FilterField(usize),
    Help,
    Quit,
    ScrollDetail(i16),
}

#[derive(Default)]
pub struct ListState {
    pub items: Vec<Record>,
    pub next: Option<String>,
    pub selected: usize,
    pub offset: usize,
    pub loading: bool,
    pub error: Option<String>,
    pub generation: u64,
    pub loaded: bool,
    pub dirty: bool,
    pub filters: Filters,
    pub detail_scroll: u16,
}

pub struct App {
    pub section: Section,
    pub lists: [ListState; 4],
    pub view: View,
    pub focus: Focus,
    pub live: bool,
    pub info: Option<Info>,
    pub fatal: Option<String>,
    pub status: Option<String>,
    pub in_herdr: bool,
    pub opening: Option<String>,
    pub changes: ChangeState,
    pub quit: bool,
    pub url: String,
    effects: Vec<Effect>,
}

pub const OUTSIDE_HERDR: &str = "Opening a session tab needs Herdr: run the TUI in a Herdr pane (the mypi plugin tab or any pane). Outside Herdr run mypi open <KEY> yourself.";

pub fn reload_limit(loaded: usize) -> usize {
    loaded.clamp(PAGE_LIMIT, RELOAD_MAX)
}

impl App {
    pub fn new(in_herdr: bool) -> App {
        let mut app = App {
            section: Section::Tasks,
            lists: Default::default(),
            view: View::List,
            focus: Focus::Normal,
            live: false,
            info: None,
            fatal: None,
            status: None,
            in_herdr,
            opening: None,
            changes: ChangeState::default(),
            quit: false,
            url: String::new(),
            effects: vec![Effect::Info],
        };
        app.load(Section::Tasks, LoadKind::Replace);
        app
    }

    pub fn list(&self) -> &ListState {
        &self.lists[self.section.index()]
    }

    fn list_mut(&mut self) -> &mut ListState {
        &mut self.lists[self.section.index()]
    }

    pub fn selected(&self) -> Option<&Record> {
        let list = self.list();
        list.items.get(list.selected)
    }

    fn load(&mut self, section: Section, kind: LoadKind) {
        let list = &mut self.lists[section.index()];
        let (cursor, limit) = match kind {
            LoadKind::Replace => {
                list.generation += 1;
                (None, PAGE_LIMIT)
            }
            LoadKind::Append => {
                if list.next.is_none() || list.loading {
                    return;
                }
                (list.next.clone(), PAGE_LIMIT)
            }
            LoadKind::Reload => (None, reload_limit(list.items.len())),
        };
        list.loading = true;
        let (path, query) = list_request(section, &list.filters, cursor.as_deref(), limit);
        self.effects.push(Effect::Load {
            section,
            generation: list.generation,
            kind,
            path,
            query,
        });
    }

    fn refresh(&mut self, section: Section) {
        let kind = if self.lists[section.index()].loaded {
            LoadKind::Reload
        } else {
            LoadKind::Replace
        };
        self.load(section, kind);
    }

    pub fn apply(&mut self, msg: Msg) {
        match msg {
            Msg::Loaded {
                section,
                generation,
                kind,
                result,
            } => self.loaded(section, generation, kind, result),
            Msg::Info(Ok(info)) => {
                self.info = Some(info);
                self.fatal = None;
            }
            Msg::Info(Err(failure)) => self.fatal = Some(failure.message),
            Msg::StreamUp => self.live = true,
            Msg::StreamDown(_) => {
                self.live = false;
                self.changes.on_disconnect();
            }
            Msg::Change(data) => {
                if self.changes.on_change(&data) {
                    self.refresh(self.section);
                    for section in SECTIONS {
                        let list = &mut self.lists[section.index()];
                        if section != self.section && list.loaded {
                            list.dirty = true;
                        }
                    }
                    self.effects.push(Effect::Info);
                }
            }
            Msg::OpenProgress(line) => self.status = Some(line),
            Msg::Opened(text) => {
                self.opening = None;
                self.status = Some(text);
            }
        }
    }

    fn loaded(
        &mut self,
        section: Section,
        generation: u64,
        kind: LoadKind,
        result: Result<Page, ApiFailure>,
    ) {
        let list = &mut self.lists[section.index()];
        if generation != list.generation {
            return;
        }
        list.loading = false;
        let page = match result {
            Ok(page) => page,
            Err(failure) => {
                list.error = Some(format!("{}: {}", failure.code, failure.message));
                return;
            }
        };
        list.error = None;
        list.loaded = true;
        list.dirty = false;
        let items = if section == Section::Projects {
            filter_projects(page.items, list.filters.get("q").map(String::as_str))
        } else {
            page.items
        };
        match kind {
            LoadKind::Replace => {
                list.items = items;
                list.next = page.next;
                list.selected = 0;
                list.offset = 0;
                list.detail_scroll = 0;
            }
            LoadKind::Append => {
                list.items.extend(items);
                list.next = page.next;
            }
            LoadKind::Reload => {
                let before = list
                    .items
                    .get(list.selected)
                    .and_then(|r| section.identity(r));
                list.items = items;
                list.next = page.next;
                list.selected = before
                    .and_then(|id| {
                        list.items
                            .iter()
                            .position(|r| section.identity(r).as_ref() == Some(&id))
                    })
                    .unwrap_or_else(|| list.selected.min(list.items.len().saturating_sub(1)));
            }
        }
    }

    fn switch(&mut self, section: Section) {
        self.section = section;
        self.view = View::List;
        let list = self.list();
        if !list.loaded {
            self.load(section, LoadKind::Replace);
        } else if list.dirty {
            self.load(section, LoadKind::Reload);
        }
    }

    fn scroll_detail(&mut self, by: i32) {
        let list = self.list_mut();
        list.detail_scroll =
            (i32::from(list.detail_scroll) + by).clamp(0, i32::from(u16::MAX)) as u16;
    }

    fn select(&mut self, index: usize) {
        let list = self.list_mut();
        if index < list.items.len() {
            list.selected = index;
            list.detail_scroll = 0;
        }
    }

    fn step(&mut self, action: Action) {
        if self.view == View::Detail {
            match action {
                Action::Up => self.scroll_detail(-1),
                Action::Down => self.scroll_detail(1),
                Action::PageUp => self.scroll_detail(-10),
                Action::PageDown => self.scroll_detail(10),
                Action::Home => self.list_mut().detail_scroll = 0,
                _ => self.list_mut().detail_scroll = u16::MAX,
            }
            return;
        }
        let list = self.list();
        let last = list.items.len().saturating_sub(1);
        let target = match action {
            Action::Up => list.selected.saturating_sub(1),
            Action::Down if list.selected >= last && list.next.is_some() => {
                self.load(self.section, LoadKind::Append);
                return;
            }
            Action::Down => (list.selected + 1).min(last),
            Action::PageUp => list.selected.saturating_sub(10),
            Action::PageDown => (list.selected + 10).min(last),
            Action::Home => 0,
            _ => last,
        };
        self.select(target);
    }

    pub fn action(&mut self, action: Action) {
        match action {
            Action::Section(section) => self.switch(section),
            Action::NextSection => self.switch(SECTIONS[(self.section.index() + 1) % 4]),
            Action::PrevSection => self.switch(SECTIONS[(self.section.index() + 3) % 4]),
            Action::Up
            | Action::Down
            | Action::PageUp
            | Action::PageDown
            | Action::Home
            | Action::End => self.step(action),
            Action::Select(index) => self.select(index),
            Action::Activate => {
                if self.view == View::List {
                    self.view = View::Detail;
                }
            }
            Action::Back => match self.focus {
                Focus::Search(_) | Focus::Help => self.focus = Focus::Normal,
                Focus::Filters { .. } => self.close_filters(),
                Focus::Normal if self.view == View::Detail => self.view = View::List,
                Focus::Normal => self.status = None,
            },
            Action::Open => self.open(),
            Action::Refresh => {
                self.refresh(self.section);
                self.effects.push(Effect::Info);
            }
            Action::LoadMore => self.load(self.section, LoadKind::Append),
            Action::Search => {
                let q = self.list().filters.get("q").cloned().unwrap_or_default();
                self.focus = Focus::Search(q);
            }
            Action::Filters => self.open_filters(),
            Action::FilterField(index) => {
                if !matches!(self.focus, Focus::Filters { .. }) {
                    self.open_filters();
                }
                if let Focus::Filters {
                    selected, editing, ..
                } = &mut self.focus
                {
                    *selected = index;
                    *editing = None;
                }
                self.activate_field(index);
            }
            Action::Help => {
                self.focus = if self.focus == Focus::Help {
                    Focus::Normal
                } else {
                    Focus::Help
                };
            }
            Action::Quit => self.quit = true,
            Action::ScrollDetail(by) => self.scroll_detail(i32::from(by)),
        }
    }

    fn open(&mut self) {
        let Some(key) = self.selected().and_then(|r| self.section.open_key(r)) else {
            self.status = Some("Open works on project and task rows".into());
            return;
        };
        if !self.in_herdr {
            self.status = Some(OUTSIDE_HERDR.into());
        } else if let Some(busy) = &self.opening {
            self.status = Some(format!("Already opening {busy}"));
        } else {
            self.status = Some(format!("Opening {key}…"));
            self.opening = Some(key.clone());
            self.effects.push(Effect::Open(key));
        }
    }

    fn open_filters(&mut self) {
        self.focus = Focus::Filters {
            selected: 0,
            editing: None,
            before: self.list().filters.clone(),
        };
    }

    fn close_filters(&mut self) {
        if let Focus::Filters { before, .. } = std::mem::replace(&mut self.focus, Focus::Normal)
            && self.list().filters != before
        {
            self.load(self.section, LoadKind::Replace);
        }
    }

    fn set_filter(&mut self, key: &'static str, value: String) {
        let filters = &mut self.list_mut().filters;
        if value.is_empty() {
            filters.remove(key);
        } else {
            filters.insert(key, value);
        }
    }

    fn activate_field(&mut self, index: usize) {
        let Some(field) = fields(self.section).get(index) else {
            return;
        };
        let current = self
            .list()
            .filters
            .get(field.key)
            .cloned()
            .unwrap_or_default();
        match field.kind {
            FieldKind::Choice(choices) => self.set_filter(field.key, cycle(choices, &current)),
            FieldKind::Text | FieldKind::Date => {
                if let Focus::Filters { editing, .. } = &mut self.focus {
                    *editing = Some(current);
                }
            }
        }
    }

    pub fn key(&mut self, key: KeyEvent) {
        if key.kind != KeyEventKind::Press {
            return;
        }
        let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
        if ctrl && key.code == KeyCode::Char('c') {
            self.quit = true;
            return;
        }
        match &mut self.focus {
            Focus::Search(text) => match key.code {
                KeyCode::Char('u') if ctrl => text.clear(),
                KeyCode::Char(c) if !ctrl => text.push(c),
                KeyCode::Backspace => {
                    text.pop();
                }
                KeyCode::Enter => {
                    let q = text.trim().to_string();
                    self.focus = Focus::Normal;
                    self.set_filter("q", q);
                    self.load(self.section, LoadKind::Replace);
                }
                KeyCode::Esc => self.focus = Focus::Normal,
                _ => {}
            },
            Focus::Filters {
                selected,
                editing: Some(text),
                ..
            } => match key.code {
                KeyCode::Char(c) if !ctrl => text.push(c),
                KeyCode::Backspace => {
                    text.pop();
                }
                KeyCode::Enter => {
                    let field = fields(self.section)[*selected];
                    match validate(field.kind, text) {
                        Ok(value) => {
                            if let Focus::Filters { editing, .. } = &mut self.focus {
                                *editing = None;
                            }
                            self.status = None;
                            self.set_filter(field.key, value);
                        }
                        Err(error) => self.status = Some(error),
                    }
                }
                KeyCode::Esc => {
                    if let Focus::Filters { editing, .. } = &mut self.focus {
                        *editing = None;
                    }
                }
                _ => {}
            },
            Focus::Filters { selected, .. } => {
                let count = fields(self.section).len();
                match key.code {
                    KeyCode::Up | KeyCode::Char('k') => *selected = selected.saturating_sub(1),
                    KeyCode::Down | KeyCode::Char('j') => {
                        *selected = (*selected + 1).min(count.saturating_sub(1))
                    }
                    KeyCode::Enter | KeyCode::Char(' ') => {
                        let index = *selected;
                        self.activate_field(index);
                    }
                    KeyCode::Char('x') | KeyCode::Delete => {
                        if let Some(field) = fields(self.section).get(*selected) {
                            self.set_filter(field.key, String::new());
                        }
                    }
                    KeyCode::Char('f') | KeyCode::Esc => self.close_filters(),
                    _ => {}
                }
            }
            Focus::Help => self.focus = Focus::Normal,
            Focus::Normal => {
                let action = match key.code {
                    KeyCode::Char('q') => Action::Quit,
                    KeyCode::Tab => Action::NextSection,
                    KeyCode::BackTab => Action::PrevSection,
                    KeyCode::Char(c @ '1'..='4') => {
                        Action::Section(SECTIONS[c as usize - '1' as usize])
                    }
                    KeyCode::Char('j') | KeyCode::Down => Action::Down,
                    KeyCode::Char('k') | KeyCode::Up => Action::Up,
                    KeyCode::PageDown => Action::PageDown,
                    KeyCode::PageUp => Action::PageUp,
                    KeyCode::Char('g') | KeyCode::Home => Action::Home,
                    KeyCode::Char('G') | KeyCode::End => Action::End,
                    KeyCode::Enter => Action::Activate,
                    KeyCode::Esc | KeyCode::Backspace => Action::Back,
                    KeyCode::Char('o') => Action::Open,
                    KeyCode::Char('r') => Action::Refresh,
                    KeyCode::Char('m') => Action::LoadMore,
                    KeyCode::Char('/') => Action::Search,
                    KeyCode::Char('f') => Action::Filters,
                    KeyCode::Char('?') => Action::Help,
                    KeyCode::Char('J') => Action::ScrollDetail(1),
                    KeyCode::Char('K') => Action::ScrollDetail(-1),
                    _ => return,
                };
                self.action(action);
            }
        }
    }

    pub fn take_effects(&mut self) -> Vec<Effect> {
        std::mem::take(&mut self.effects)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tasks(range: std::ops::Range<usize>) -> Vec<Record> {
        range
            .map(|i| {
                json!({"key": format!("MP-{i}"), "title": format!("Task {i}"), "status": "new"})
                    .as_object()
                    .unwrap()
                    .clone()
            })
            .collect()
    }

    fn loaded(
        section: Section,
        generation: u64,
        kind: LoadKind,
        items: Vec<Record>,
        next: Option<&str>,
    ) -> Msg {
        Msg::Loaded {
            section,
            generation,
            kind,
            result: Ok(Page {
                items,
                next: next.map(str::to_string),
            }),
        }
    }

    fn press(app: &mut App, code: KeyCode) {
        app.key(KeyEvent::new(code, KeyModifiers::NONE));
    }

    fn typed(app: &mut App, text: &str) {
        for c in text.chars() {
            press(app, KeyCode::Char(c));
        }
    }

    fn load(
        section: Section,
        generation: u64,
        kind: LoadKind,
        query: &[(&'static str, &str)],
    ) -> Effect {
        let path = match section {
            Section::Projects => "/v1/projects",
            Section::Tasks => "/v1/tasks",
            Section::Events => "/v1/events",
            Section::Journal => "/v1/journal",
        };
        Effect::Load {
            section,
            generation,
            kind,
            path,
            query: query.iter().map(|(k, v)| (*k, v.to_string())).collect(),
        }
    }

    fn started(in_herdr: bool) -> App {
        let mut app = App::new(in_herdr);
        app.take_effects();
        app.apply(loaded(
            Section::Tasks,
            1,
            LoadKind::Replace,
            tasks(1..51),
            None,
        ));
        app
    }

    fn selected_key(app: &App) -> String {
        let list = &app.lists[app.section.index()];
        list.items[list.selected]["key"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn startup_requests_info_and_the_first_tasks_page() {
        let mut app = App::new(false);
        assert_eq!(app.section, Section::Tasks);
        assert_eq!(
            app.take_effects(),
            vec![
                Effect::Info,
                load(Section::Tasks, 1, LoadKind::Replace, &[("limit", "50")])
            ]
        );
        assert!(app.take_effects().is_empty());
    }

    #[test]
    fn paging_appends_with_the_cursor_and_stops_without_next() {
        let mut app = App::new(false);
        app.take_effects();
        app.apply(loaded(
            Section::Tasks,
            1,
            LoadKind::Replace,
            tasks(0..50),
            Some("c1"),
        ));
        for _ in 0..49 {
            app.action(Action::Down);
        }
        assert!(app.take_effects().is_empty());
        app.action(Action::Down);
        assert_eq!(
            app.take_effects(),
            vec![load(
                Section::Tasks,
                1,
                LoadKind::Append,
                &[("cursor", "c1"), ("limit", "50")]
            )]
        );
        app.action(Action::Down);
        assert!(app.take_effects().is_empty());
        app.apply(loaded(
            Section::Tasks,
            1,
            LoadKind::Append,
            tasks(50..60),
            None,
        ));
        assert_eq!(app.lists[1].items.len(), 60);
        assert_eq!(app.lists[1].next, None);
        app.action(Action::End);
        app.action(Action::Down);
        assert!(app.take_effects().is_empty());
        assert_eq!(app.lists[1].selected, 59);
    }

    #[test]
    fn filter_and_search_changes_restart_paging_and_drop_stale_pages() {
        let mut app = App::new(false);
        app.take_effects();
        app.action(Action::Search);
        typed(&mut app, "поиск");
        press(&mut app, KeyCode::Enter);
        assert_eq!(app.focus, Focus::Normal);
        assert_eq!(
            app.take_effects(),
            vec![load(
                Section::Tasks,
                2,
                LoadKind::Replace,
                &[("q", "поиск"), ("limit", "50")]
            )]
        );
        app.apply(loaded(
            Section::Tasks,
            1,
            LoadKind::Replace,
            tasks(0..50),
            None,
        ));
        assert!(app.lists[1].items.is_empty());
        app.apply(loaded(
            Section::Tasks,
            2,
            LoadKind::Replace,
            tasks(0..2),
            None,
        ));
        assert_eq!(app.lists[1].items.len(), 2);
        app.action(Action::Search);
        press(&mut app, KeyCode::Esc);
        assert_eq!(app.focus, Focus::Normal);
        assert!(app.take_effects().is_empty());
        assert_eq!(
            app.lists[1].filters.get("q").map(String::as_str),
            Some("поиск")
        );
    }

    #[test]
    fn change_events_reload_the_current_section_keep_the_selection_and_mark_others_dirty() {
        let mut app = App::new(false);
        app.take_effects();
        app.apply(loaded(
            Section::Tasks,
            1,
            LoadKind::Replace,
            tasks(0..50),
            Some("c1"),
        ));
        app.action(Action::LoadMore);
        app.apply(loaded(
            Section::Tasks,
            1,
            LoadKind::Append,
            tasks(50..60),
            None,
        ));
        app.action(Action::Section(Section::Events));
        assert_eq!(
            app.take_effects(),
            vec![
                load(
                    Section::Tasks,
                    1,
                    LoadKind::Append,
                    &[("cursor", "c1"), ("limit", "50")]
                ),
                load(Section::Events, 1, LoadKind::Replace, &[("limit", "50")])
            ]
        );
        app.apply(loaded(
            Section::Events,
            1,
            LoadKind::Replace,
            Vec::new(),
            None,
        ));
        app.action(Action::Section(Section::Tasks));
        assert!(app.take_effects().is_empty());
        app.action(Action::Select(7));
        assert_eq!(selected_key(&app), "MP-7");

        app.apply(Msg::Change(r#"{"changeId":1}"#.into()));
        assert!(app.take_effects().is_empty());
        app.apply(Msg::Change(r#"{"changeId":2}"#.into()));
        assert_eq!(
            app.take_effects(),
            vec![
                load(Section::Tasks, 1, LoadKind::Reload, &[("limit", "60")]),
                Effect::Info
            ]
        );
        assert!(app.lists[2].dirty);
        let mut reordered = tasks(0..61);
        reordered.reverse();
        app.apply(loaded(
            Section::Tasks,
            1,
            LoadKind::Reload,
            reordered,
            Some("c2"),
        ));
        assert_eq!(selected_key(&app), "MP-7");
        assert_eq!(app.lists[1].next, Some("c2".into()));
        app.action(Action::Section(Section::Events));
        assert_eq!(
            app.take_effects(),
            vec![load(
                Section::Events,
                1,
                LoadKind::Reload,
                &[("limit", "50")]
            )]
        );
        assert_eq!(reload_limit(10), 50);
        assert_eq!(reload_limit(500), 200);
    }

    #[test]
    fn open_needs_a_project_or_task_row_and_herdr() {
        let mut app = started(false);
        app.action(Action::Select(6));
        app.action(Action::Open);
        assert_eq!(app.status.as_deref(), Some(OUTSIDE_HERDR));
        assert!(app.take_effects().is_empty());

        let mut app = started(true);
        app.action(Action::Select(6));
        press(&mut app, KeyCode::Char('o'));
        assert_eq!(app.take_effects(), vec![Effect::Open("MP-7".into())]);
        assert_eq!(app.status.as_deref(), Some("Opening MP-7…"));
        app.action(Action::Open);
        assert_eq!(app.status.as_deref(), Some("Already opening MP-7"));
        assert!(app.take_effects().is_empty());
        app.apply(Msg::OpenProgress("cloning".into()));
        assert_eq!(app.status.as_deref(), Some("cloning"));
        app.apply(Msg::Opened("MP-7: started (claude)".into()));
        assert_eq!(app.opening, None);
        assert_eq!(app.status.as_deref(), Some("MP-7: started (claude)"));

        app.action(Action::Section(Section::Events));
        app.take_effects();
        app.apply(loaded(
            Section::Events,
            1,
            LoadKind::Replace,
            vec![
                json!({"id": 1, "kind": "message"})
                    .as_object()
                    .unwrap()
                    .clone(),
            ],
            None,
        ));
        app.action(Action::Open);
        assert_eq!(
            app.status.as_deref(),
            Some("Open works on project and task rows")
        );
        assert!(app.take_effects().is_empty());
    }

    #[test]
    fn filters_form_cycles_choices_validates_dates_and_applies_on_close() {
        let mut app = App::new(false);
        press(&mut app, KeyCode::Char('4'));
        app.take_effects();
        app.apply(loaded(
            Section::Journal,
            1,
            LoadKind::Replace,
            Vec::new(),
            None,
        ));
        press(&mut app, KeyCode::Char('f'));
        press(&mut app, KeyCode::Down);
        press(&mut app, KeyCode::Enter);
        assert_eq!(
            app.lists[3].filters.get("type").map(String::as_str),
            Some("note")
        );
        press(&mut app, KeyCode::Down);
        press(&mut app, KeyCode::Enter);
        typed(&mut app, "2026-13");
        press(&mut app, KeyCode::Enter);
        assert_eq!(app.status.as_deref(), Some("Dates are YYYY-MM-DD"));
        assert!(matches!(&app.focus, Focus::Filters { editing: Some(v), .. } if v == "2026-13"));
        press(&mut app, KeyCode::Esc);
        assert!(matches!(&app.focus, Focus::Filters { editing: None, .. }));
        assert_eq!(app.lists[3].filters.get("from"), None);
        assert!(app.take_effects().is_empty());
        press(&mut app, KeyCode::Char('f'));
        assert_eq!(app.focus, Focus::Normal);
        assert_eq!(
            app.take_effects(),
            vec![load(
                Section::Journal,
                2,
                LoadKind::Replace,
                &[("type", "note"), ("limit", "50")]
            )]
        );
        press(&mut app, KeyCode::Char('f'));
        press(&mut app, KeyCode::Esc);
        assert_eq!(app.focus, Focus::Normal);
        assert!(app.take_effects().is_empty());
    }

    #[test]
    fn stream_state_and_errors_reach_the_view() {
        let mut app = started(false);
        app.apply(Msg::StreamUp);
        assert!(app.live);
        app.apply(Msg::Change(r#"{"changeId":5}"#.into()));
        assert!(app.take_effects().is_empty());
        app.apply(Msg::StreamDown("closed".into()));
        assert!(!app.live);
        app.apply(Msg::Change(r#"{"changeId":5}"#.into()));
        assert_eq!(
            app.take_effects(),
            vec![
                load(Section::Tasks, 1, LoadKind::Reload, &[("limit", "50")]),
                Effect::Info
            ]
        );
        app.apply(Msg::Loaded {
            section: Section::Tasks,
            generation: 1,
            kind: LoadKind::Reload,
            result: Err(ApiFailure {
                status: 401,
                code: "unauthorized".into(),
                message: "Missing or invalid token".into(),
            }),
        });
        assert_eq!(
            app.lists[1].error.as_deref(),
            Some("unauthorized: Missing or invalid token")
        );
        assert!(!app.lists[1].loading);
        app.apply(Msg::Info(Err(ApiFailure {
            status: 200,
            code: "unsupported_api".into(),
            message: "The API speaks apiVersion 2; this TUI understands 1".into(),
        })));
        assert_eq!(
            app.fatal.as_deref(),
            Some("The API speaks apiVersion 2; this TUI understands 1")
        );
        app.key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL));
        assert!(app.quit);
    }
}
