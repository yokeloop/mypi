use ratatui::crossterm::event::{MouseButton, MouseEvent, MouseEventKind};
use ratatui::layout::{Position, Rect};

use crate::app::{Action, App, Focus, View};
use crate::model::Section;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Target {
    Tab(Section),
    Row(usize),
    LoadMore,
    Button(Action),
    FilterField(usize),
    List,
    Detail,
}

#[derive(Default)]
pub struct HitMap {
    zones: Vec<(Rect, Target)>,
}

impl HitMap {
    pub fn clear(&mut self) {
        self.zones.clear();
    }

    pub fn push(&mut self, rect: Rect, target: Target) {
        self.zones.push((rect, target));
    }

    pub fn at(&self, x: u16, y: u16) -> Option<Target> {
        self.zones
            .iter()
            .rev()
            .find(|(rect, _)| rect.contains(Position { x, y }))
            .map(|(_, target)| *target)
    }
}

pub fn on_mouse(app: &mut App, hits: &HitMap, event: MouseEvent) {
    let target = hits.at(event.column, event.row);
    let overlay = app.focus != Focus::Normal && !matches!(app.focus, Focus::Search(_));
    match event.kind {
        MouseEventKind::Down(MouseButton::Left) => {
            let action = match target {
                Some(Target::FilterField(i)) => Action::FilterField(i),
                _ if overlay => Action::Back,
                Some(Target::Tab(section)) => Action::Section(section),
                Some(Target::Row(i)) if app.list().selected == i => Action::Activate,
                Some(Target::Row(i)) => Action::Select(i),
                Some(Target::LoadMore) => Action::LoadMore,
                Some(Target::Button(action)) => action,
                _ => return,
            };
            app.action(action);
        }
        MouseEventKind::ScrollDown | MouseEventKind::ScrollUp if !overlay => {
            let down = event.kind == MouseEventKind::ScrollDown;
            match target {
                Some(Target::List | Target::Row(_) | Target::LoadMore)
                    if app.view == View::List =>
                {
                    for _ in 0..3 {
                        app.action(if down { Action::Down } else { Action::Up });
                    }
                }
                Some(Target::Detail) => app.action(Action::ScrollDetail(if down { 3 } else { -3 })),
                _ => {}
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::Page;
    use crate::app::{LoadKind, Msg};
    use ratatui::crossterm::event::KeyModifiers;
    use serde_json::json;

    fn mouse(kind: MouseEventKind, column: u16, row: u16) -> MouseEvent {
        MouseEvent {
            kind,
            column,
            row,
            modifiers: KeyModifiers::NONE,
        }
    }

    #[test]
    fn the_last_zone_wins_and_borders_are_exclusive() {
        let mut hits = HitMap::default();
        hits.push(Rect::new(0, 0, 10, 10), Target::List);
        hits.push(Rect::new(0, 3, 10, 1), Target::Row(3));
        hits.push(Rect::new(4, 4, 0, 1), Target::LoadMore);
        assert_eq!(hits.at(5, 3), Some(Target::Row(3)));
        assert_eq!(hits.at(5, 4), Some(Target::List));
        assert_eq!(hits.at(4, 4), Some(Target::List));
        assert_eq!(hits.at(10, 3), None);
        assert_eq!(hits.at(5, 10), None);
        hits.clear();
        assert_eq!(hits.at(5, 3), None);
    }

    #[test]
    fn clicks_select_then_activate_and_wheel_scrolls() {
        let mut app = App::new(false);
        app.take_effects();
        let items = (1..6)
            .map(|i| {
                json!({"key": format!("MP-{i}")})
                    .as_object()
                    .unwrap()
                    .clone()
            })
            .collect();
        app.apply(Msg::Loaded {
            section: Section::Tasks,
            generation: 1,
            kind: LoadKind::Replace,
            result: Ok(Page { items, next: None }),
        });
        let mut hits = HitMap::default();
        hits.push(Rect::new(0, 0, 20, 10), Target::List);
        hits.push(Rect::new(0, 2, 20, 1), Target::Row(2));
        hits.push(Rect::new(20, 0, 20, 10), Target::Detail);
        hits.push(Rect::new(0, 11, 10, 1), Target::Tab(Section::Events));
        let left = MouseEventKind::Down(MouseButton::Left);

        app.action(Action::Down);
        on_mouse(&mut app, &hits, mouse(MouseEventKind::ScrollDown, 1, 1));
        assert_eq!(app.list().selected, 4);
        on_mouse(&mut app, &hits, mouse(MouseEventKind::ScrollUp, 1, 1));
        assert_eq!(app.list().selected, 1);

        on_mouse(&mut app, &hits, mouse(left, 3, 2));
        assert_eq!(app.list().selected, 2);
        assert_eq!(app.view, View::List);
        on_mouse(&mut app, &hits, mouse(left, 3, 2));
        assert_eq!(app.view, View::Detail);

        on_mouse(&mut app, &hits, mouse(MouseEventKind::ScrollDown, 25, 5));
        assert_eq!(app.list().detail_scroll, 3);
        on_mouse(&mut app, &hits, mouse(MouseEventKind::ScrollUp, 25, 5));
        on_mouse(&mut app, &hits, mouse(MouseEventKind::ScrollUp, 25, 5));
        assert_eq!(app.list().detail_scroll, 0);

        on_mouse(&mut app, &hits, mouse(left, 2, 11));
        assert_eq!(app.section, Section::Events);

        app.action(Action::Help);
        on_mouse(&mut app, &hits, mouse(left, 2, 11));
        assert_eq!(app.focus, Focus::Normal);
        assert_eq!(app.section, Section::Events);
    }
}
