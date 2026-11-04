use ratatui::Frame;
use ratatui::layout::{Alignment, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Clear, Paragraph, Wrap};

use crate::app::{Action, App, Focus, View};
use crate::filters::{FieldKind, fields};
use crate::hit::{HitMap, Target};
use crate::layout::{MIN_HEIGHT, MIN_WIDTH, Mode, areas, spans};
use crate::model::{SECTIONS, Tone, details, summary};

const HELP: [&str; 10] = [
    "Tab / Shift-Tab, 1-4    switch section",
    "j k, ↑ ↓, PgUp PgDn     move",
    "g G, Home End           first / last row",
    "Enter                   details   Esc, Backspace  back",
    "o                       open the session tab (in Herdr)",
    "r refresh   m load more   / search   f filters",
    "J K                     scroll details",
    "? help   q, Ctrl-C quit",
    "Mouse: tabs, rows (second click: details), buttons,",
    "the filter row, form fields; the wheel scrolls",
];

fn tone(tone: Tone) -> Style {
    let style = Style::default();
    match tone {
        Tone::Plain => style,
        Tone::Dim => style.fg(Color::DarkGray),
        Tone::Accent => style.fg(Color::Cyan),
        Tone::Good => style.fg(Color::Green),
        Tone::Warn => style.fg(Color::Yellow),
        Tone::Muted => style.fg(Color::Gray),
    }
}

fn row(area: Rect, offset: u16) -> Rect {
    Rect::new(area.x, area.y + offset, area.width, 1)
}

fn centered(area: Rect, width: u16, height: u16) -> Rect {
    let width = width.min(area.width);
    let height = height.min(area.height);
    Rect::new(
        area.x + (area.width - width) / 2,
        area.y + (area.height - height) / 2,
        width,
        height,
    )
}

pub fn draw(frame: &mut Frame, app: &mut App, hits: &mut HitMap) {
    hits.clear();
    let area = frame.area();
    let (mode, areas) = areas(area);
    if mode == Mode::TooSmall {
        let text = format!(
            "Terminal too small: need {MIN_WIDTH}×{MIN_HEIGHT}, have {}×{}",
            area.width, area.height
        );
        let top = area.height / 2;
        frame.render_widget(
            Paragraph::new(text)
                .alignment(Alignment::Center)
                .wrap(Wrap { trim: true }),
            Rect::new(area.x, area.y + top, area.width, area.height - top),
        );
        return;
    }
    header(frame, app, areas.header, mode);
    tabs(frame, app, hits, areas.tabs);
    filter_row(frame, app, hits, areas.filters);
    match areas.detail {
        Some(detail_area) => {
            list(frame, app, hits, areas.list);
            detail(frame, app, hits, detail_area);
        }
        None if app.view == View::Detail => detail(frame, app, hits, areas.list),
        None => list(frame, app, hits, areas.list),
    }
    let status = match &app.status {
        Some(text) => Line::from(text.as_str()),
        None => Line::styled("? help · q quit", tone(Tone::Dim)),
    };
    frame.render_widget(Paragraph::new(status), areas.status);
    buttons(frame, app, hits, areas.buttons, mode);
    match app.focus {
        Focus::Filters { .. } => filters_overlay(frame, app, hits, area, mode),
        Focus::Help => help_overlay(frame, area),
        _ => {}
    }
}

fn header(frame: &mut Frame, app: &App, area: Rect, mode: Mode) {
    let line = match &app.fatal {
        Some(fatal) => Line::styled(fatal.as_str(), Style::default().fg(Color::Red)),
        None => {
            let version = app
                .info
                .as_ref()
                .map(|info| format!("mypi {}", info.version))
                .unwrap_or_else(|| "mypi".to_string());
            let mut spans = vec![
                Span::styled(version, Style::default().add_modifier(Modifier::BOLD)),
                Span::raw("  "),
            ];
            spans.push(if app.live {
                Span::styled("● Live", Style::default().fg(Color::Green))
            } else {
                Span::styled("○ Offline", tone(Tone::Muted))
            });
            if let (false, Some(reason)) = (app.live, &app.offline) {
                spans.push(Span::styled(format!(" · {reason}"), tone(Tone::Dim)));
            }
            if mode == Mode::Split {
                spans.push(Span::styled(format!("  {}", app.url), tone(Tone::Dim)));
            }
            Line::from(spans)
        }
    };
    frame.render_widget(Paragraph::new(line), area);
}

fn tabs(frame: &mut Frame, app: &App, hits: &mut HitMap, area: Rect) {
    let labels: Vec<String> = SECTIONS
        .iter()
        .map(|s| format!("{} {}", s.index() + 1, s.title()))
        .collect();
    for (i, (x, len)) in spans(&labels, area.x, area.width).into_iter().enumerate() {
        let rect = Rect::new(x, area.y, len, 1);
        let style = if SECTIONS[i] == app.section {
            Style::default().add_modifier(Modifier::REVERSED | Modifier::BOLD)
        } else {
            Style::default()
        };
        frame.render_widget(Paragraph::new(labels[i].as_str()).style(style), rect);
        hits.push(rect, Target::Tab(SECTIONS[i]));
    }
}

fn filter_row(frame: &mut Frame, app: &App, hits: &mut HitMap, area: Rect) {
    let line = match &app.focus {
        Focus::Search(input) => Line::from(vec![
            Span::styled("Search: ", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(format!("{input}▏")),
        ]),
        _ => {
            let parts: Vec<String> = app
                .list()
                .filters
                .iter()
                .filter(|(_, v)| !v.is_empty())
                .map(|(k, v)| {
                    if *k == "q" {
                        format!("q=\"{v}\"")
                    } else {
                        format!("{k}={v}")
                    }
                })
                .collect();
            let shown = if parts.is_empty() {
                "—".to_string()
            } else {
                parts.join(" ")
            };
            Line::from(vec![
                Span::styled("Filter: ", tone(Tone::Dim)),
                Span::raw(shown),
            ])
        }
    };
    frame.render_widget(Paragraph::new(line), area);
    hits.push(area, Target::Button(Action::Filters));
}

fn list(frame: &mut Frame, app: &mut App, hits: &mut HitMap, area: Rect) {
    let section = app.section;
    let list = &mut app.lists[section.index()];
    let more = if list.next.is_some() { "+" } else { "" };
    let block =
        Block::bordered().title(format!(" {} {}{more} ", section.title(), list.items.len()));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    hits.push(area, Target::List);
    if inner.height == 0 || inner.width == 0 {
        return;
    }
    let footer = if let Some(error) = &list.error {
        Some((error.clone(), Style::default().fg(Color::Red), None))
    } else if list.loading {
        Some(("Loading…".to_string(), tone(Tone::Dim), None))
    } else if list.next.is_some() {
        Some((
            "▼ Load more".to_string(),
            tone(Tone::Accent),
            Some(Target::LoadMore),
        ))
    } else if list.items.is_empty() {
        Some(("Nothing found".to_string(), tone(Tone::Dim), None))
    } else {
        None
    };
    let rows = usize::from(inner.height) - usize::from(footer.is_some());
    let len = list.items.len();
    if list.selected < list.offset {
        list.offset = list.selected;
    } else if rows > 0 && list.selected >= list.offset + rows {
        list.offset = list.selected + 1 - rows;
    }
    list.offset = list.offset.min(len.saturating_sub(1));
    let mut y = inner.y;
    for index in (list.offset..len).take(rows) {
        let mut spans = Vec::new();
        for (i, (text, cell)) in summary(section, &list.items[index]).into_iter().enumerate() {
            if i > 0 {
                spans.push(Span::raw(" "));
            }
            spans.push(Span::styled(text, tone(cell)));
        }
        let mut line = Line::from(spans);
        if index == list.selected {
            line = line.style(Style::default().add_modifier(Modifier::REVERSED));
        }
        let rect = row(inner, y - inner.y);
        frame.render_widget(Paragraph::new(line), rect);
        hits.push(rect, Target::Row(index));
        y += 1;
    }
    if let Some((text, style, target)) = footer {
        let rect = row(inner, y - inner.y);
        frame.render_widget(Paragraph::new(Line::styled(text, style)), rect);
        if let Some(target) = target {
            hits.push(rect, target);
        }
    }
}

fn detail(frame: &mut Frame, app: &mut App, hits: &mut HitMap, area: Rect) {
    let block = Block::bordered().title(" Details ");
    let inner = block.inner(area);
    frame.render_widget(block, area);
    hits.push(area, Target::Detail);
    let section = app.section;
    let list = &mut app.lists[section.index()];
    let Some(record) = list.items.get(list.selected) else {
        frame.render_widget(
            Paragraph::new(Line::styled("Nothing selected", tone(Tone::Dim))),
            inner,
        );
        return;
    };
    let bold = Style::default().add_modifier(Modifier::BOLD);
    let mut lines = Vec::new();
    for (label, value) in details(section, record) {
        if label == "Other fields" && value.is_empty() {
            lines.push(Line::styled(label, bold.fg(Color::DarkGray)));
            continue;
        }
        let mut parts = value.split('\n');
        let first = parts.next().unwrap_or("").to_string();
        lines.push(Line::from(vec![
            Span::styled(label, bold),
            Span::raw(": "),
            Span::raw(first),
        ]));
        for rest in parts {
            lines.push(Line::from(format!("  {rest}")));
        }
    }
    let paragraph = Paragraph::new(lines).wrap(Wrap { trim: false });
    let total = paragraph.line_count(inner.width);
    let most = u16::try_from(total.saturating_sub(usize::from(inner.height))).unwrap_or(u16::MAX);
    list.detail_scroll = list.detail_scroll.min(most);
    frame.render_widget(paragraph.scroll((list.detail_scroll, 0)), inner);
}

fn buttons(frame: &mut Frame, app: &App, hits: &mut HitMap, area: Rect, mode: Mode) {
    let mut buttons = Vec::new();
    if mode == Mode::Single && app.view == View::Detail {
        buttons.push(("Esc Back", Action::Back));
    }
    if app
        .selected()
        .and_then(|r| app.section.open_key(r))
        .is_some()
    {
        buttons.push(("o Open", Action::Open));
    }
    buttons.extend([
        ("r Refresh", Action::Refresh),
        ("/ Search", Action::Search),
        ("f Filter", Action::Filters),
        ("? Help", Action::Help),
        ("q Quit", Action::Quit),
    ]);
    let labels: Vec<String> = buttons.iter().map(|(label, _)| label.to_string()).collect();
    for (i, (x, len)) in spans(&labels, area.x, area.width).into_iter().enumerate() {
        let rect = Rect::new(x, area.y, len, 1);
        frame.render_widget(
            Paragraph::new(labels[i].as_str())
                .style(Style::default().add_modifier(Modifier::REVERSED)),
            rect,
        );
        hits.push(rect, Target::Button(buttons[i].1));
    }
}

fn filters_overlay(frame: &mut Frame, app: &App, hits: &mut HitMap, area: Rect, mode: Mode) {
    let Focus::Filters {
        selected, editing, ..
    } = &app.focus
    else {
        return;
    };
    let list = fields(app.section);
    let width = if mode == Mode::Single { area.width } else { 50 };
    let rect = centered(area, width, list.len() as u16 + 3);
    frame.render_widget(Clear, rect);
    let block = Block::bordered().title(format!(" Filters · {} ", app.section.title()));
    let inner = block.inner(rect);
    frame.render_widget(block, rect);
    let filters = &app.list().filters;
    for (i, field) in list.iter().enumerate() {
        if i as u16 >= inner.height {
            break;
        }
        let current = filters.get(field.key).cloned().unwrap_or_default();
        let value = match (editing, field.kind) {
            (Some(text), _) if i == *selected => format!("{text}▏"),
            (_, FieldKind::Choice(choices)) => choices
                .iter()
                .find(|(_, v)| *v == current)
                .map(|(name, _)| name.to_string())
                .unwrap_or(current),
            _ if current.is_empty() => "any".to_string(),
            _ => current,
        };
        let style = if i == *selected {
            Style::default().add_modifier(Modifier::REVERSED)
        } else {
            Style::default()
        };
        let line = row(inner, i as u16);
        frame.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled(
                    format!("{}: ", field.label),
                    Style::default().add_modifier(Modifier::BOLD),
                ),
                Span::raw(value),
            ]))
            .style(style),
            line,
        );
        hits.push(line, Target::FilterField(i));
    }
    if inner.height > 0 {
        frame.render_widget(
            Paragraph::new(Line::styled(
                "Enter edit/cycle · x clear · f/Esc apply",
                tone(Tone::Dim),
            )),
            row(inner, inner.height - 1),
        );
    }
}

fn help_overlay(frame: &mut Frame, area: Rect) {
    let rect = centered(area, 64, HELP.len() as u16 + 2);
    frame.render_widget(Clear, rect);
    let lines: Vec<Line> = HELP.iter().map(|line| Line::from(*line)).collect();
    frame.render_widget(
        Paragraph::new(lines)
            .block(Block::bordered().title(" Help · any key closes "))
            .wrap(Wrap { trim: false }),
        rect,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::Page;
    use crate::app::{LoadKind, Msg};
    use crate::model::Section;
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;
    use serde_json::json;

    fn app_with_tasks() -> App {
        let mut app = App::new(false);
        app.take_effects();
        let items = (1..4)
            .map(|i| {
                json!({"key": format!("MP-{i}"), "title": format!("Task number {i}"), "status": "new"})
                    .as_object()
                    .unwrap()
                    .clone()
            })
            .collect();
        app.apply(Msg::Loaded {
            section: Section::Tasks,
            generation: 1,
            kind: LoadKind::Replace,
            result: Ok(Page {
                items,
                next: Some("c1".into()),
            }),
        });
        app
    }

    fn render(
        app: &mut App,
        width: u16,
        height: u16,
    ) -> (Vec<String>, Vec<Option<Target>>, HitMap) {
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
        let mut hits = HitMap::default();
        terminal.draw(|frame| draw(frame, app, &mut hits)).unwrap();
        let buffer = terminal.backend().buffer();
        let rows = (0..height)
            .map(|y| {
                (0..width)
                    .map(|x| buffer[(x, y)].symbol())
                    .collect::<String>()
            })
            .collect();
        let targets = (0..height)
            .flat_map(|y| (0..width).map(move |x| (x, y)))
            .map(|(x, y)| hits.at(x, y))
            .collect();
        (rows, targets, hits)
    }

    #[test]
    fn end_scrolls_word_wrapped_details_to_the_last_line() {
        let mut app = App::new(false);
        app.take_effects();
        let title = format!("{}ENDMARK", "abcdefghijklmnopqrstuvwxyzabc ".repeat(30));
        app.apply(Msg::Loaded {
            section: Section::Tasks,
            generation: 1,
            kind: LoadKind::Replace,
            result: Ok(Page {
                items: vec![
                    json!({"key": "MP-1", "title": title})
                        .as_object()
                        .unwrap()
                        .clone(),
                ],
                next: None,
            }),
        });
        app.action(Action::Activate);
        let (rows, _, _) = render(&mut app, 100, 20);
        assert!(!rows.join("\n").contains("ENDMARK"));
        app.action(Action::End);
        let (rows, _, _) = render(&mut app, 100, 20);
        assert!(rows.join("\n").contains("ENDMARK"));
        let scrolled = app.list().detail_scroll;
        app.action(Action::Down);
        render(&mut app, 100, 20);
        assert_eq!(app.list().detail_scroll, scrolled);
    }

    #[test]
    fn narrow_and_wide_frames_render_and_register_click_zones() {
        let mut app = app_with_tasks();
        let (rows, targets, _) = render(&mut app, 45, 20);
        let text = rows.join("\n");
        assert!(text.contains("2 Tasks"));
        assert!(text.contains("MP-1"));
        assert!(text.contains("▼ Load more"));
        assert!(!text.contains("Details"));
        assert!(targets.contains(&Some(Target::Row(0))));
        assert!(targets.contains(&Some(Target::LoadMore)));
        assert!(targets.contains(&Some(Target::Button(Action::Refresh))));

        app.action(Action::Activate);
        let (rows, targets, _) = render(&mut app, 45, 20);
        let text = rows.join("\n");
        assert!(text.contains("Details"));
        assert!(text.contains("Esc Back"));
        assert!(!targets.contains(&Some(Target::Row(0))));
        app.action(Action::Back);

        let (rows, _, hits) = render(&mut app, 100, 20);
        let text = rows.join("\n");
        assert!(text.contains("Details"));
        assert!(text.contains("title: Task number 1"));
        let (y, row) = rows
            .iter()
            .enumerate()
            .find(|(_, row)| row.contains("3 Events"))
            .unwrap();
        let x = row.find("3 Events").unwrap() as u16;
        assert_eq!(hits.at(x, y as u16), Some(Target::Tab(Section::Events)));

        let (rows, targets, _) = render(&mut app, 30, 20);
        assert!(rows.join("\n").contains("Terminal too small"));
        assert!(targets.iter().all(Option::is_none));
    }
}
