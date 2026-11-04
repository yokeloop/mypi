use ratatui::layout::Rect;

pub const MIN_WIDTH: u16 = 40;
pub const MIN_HEIGHT: u16 = 10;
pub const SPLIT_MIN_WIDTH: u16 = 60;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Mode {
    TooSmall,
    Single,
    Split,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Areas {
    pub header: Rect,
    pub tabs: Rect,
    pub filters: Rect,
    pub list: Rect,
    pub detail: Option<Rect>,
    pub status: Rect,
    pub buttons: Rect,
}

pub fn mode(width: u16, height: u16) -> Mode {
    if width < MIN_WIDTH || height < MIN_HEIGHT {
        Mode::TooSmall
    } else if width < SPLIT_MIN_WIDTH {
        Mode::Single
    } else {
        Mode::Split
    }
}

pub fn areas(area: Rect) -> (Mode, Areas) {
    let mode = mode(area.width, area.height);
    let row = |offset: u16| {
        Rect::new(
            area.x,
            area.y + offset.min(area.height),
            area.width,
            1.min(area.height.saturating_sub(offset)),
        )
    };
    let body_height = area.height.saturating_sub(5);
    let body = Rect::new(area.x, area.y + 3.min(area.height), area.width, body_height);
    let (list, detail) = if mode == Mode::Split {
        let left = area.width * 55 / 100;
        (
            Rect::new(body.x, body.y, left, body.height),
            Some(Rect::new(
                body.x + left,
                body.y,
                area.width - left,
                body.height,
            )),
        )
    } else {
        (body, None)
    };
    let areas = Areas {
        header: row(0),
        tabs: row(1),
        filters: row(2),
        list,
        detail,
        status: row(area.height.saturating_sub(2)),
        buttons: row(area.height.saturating_sub(1)),
    };
    (mode, areas)
}

pub fn spans(labels: &[String], x: u16, width: u16) -> Vec<(u16, u16)> {
    let mut used: u16 = 0;
    let mut out = Vec::new();
    for label in labels {
        let len = label.chars().count() as u16;
        if used + len + 1 > width {
            break;
        }
        out.push((x + used, len));
        used += len + 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn breakpoints_follow_the_terminal_size() {
        assert_eq!(mode(39, 30), Mode::TooSmall);
        assert_eq!(mode(80, 9), Mode::TooSmall);
        assert_eq!(mode(40, 10), Mode::Single);
        assert_eq!(mode(59, 40), Mode::Single);
        assert_eq!(mode(60, 10), Mode::Split);
        let (wide, split) = areas(Rect::new(0, 0, 100, 20));
        assert_eq!(wide, Mode::Split);
        let detail = split.detail.unwrap();
        assert_eq!(split.list.width + detail.width, 100);
        assert_eq!(split.list.width, 55);
        assert_eq!(split.list.height, 15);
        assert_eq!(split.buttons, Rect::new(0, 19, 100, 1));
        let (_, single) = areas(Rect::new(0, 0, 45, 20));
        assert_eq!(single.detail, None);
        assert_eq!(single.list.width, 45);
    }

    #[test]
    fn spans_drop_labels_that_do_not_fit() {
        let labels: Vec<String> = ["ab", "cde", "f"].iter().map(|s| s.to_string()).collect();
        assert_eq!(spans(&labels, 2, 20), vec![(2, 2), (5, 3), (9, 1)]);
        assert_eq!(spans(&labels, 2, 6), vec![(2, 2)]);
    }
}
