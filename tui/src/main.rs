mod api;
mod app;
mod config;
mod filters;
mod hit;
mod layout;
mod model;
mod open;
mod sse;
mod ui;

use std::io::{BufRead, IsTerminal, stdout};
use std::process::ExitCode;
use std::sync::mpsc::{self, Sender};
use std::thread;
use std::time::Duration;

use ratatui::crossterm::event::{self, DisableMouseCapture, EnableMouseCapture, Event};
use ratatui::crossterm::execute;

use api::{Client, as_info, as_page};
use app::{App, Effect, Msg};
use config::{Command, Env, USAGE, parse_args, resolve_token, resolve_url};
use hit::HitMap;
use sse::SseParser;

fn main() -> ExitCode {
    let env: Env = std::env::vars().collect();
    match parse_args(&std::env::args().skip(1).collect::<Vec<_>>()) {
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(2)
        }
        Ok(Command::Help) => {
            println!("{USAGE}");
            ExitCode::SUCCESS
        }
        Ok(Command::Version) => {
            println!("mypi-tui {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Ok(Command::HerdrOpen) => open::herdr_open(&env),
        Ok(Command::Browse { url }) => run(url, &env),
    }
}

fn spawn_changes(client: Client, tx: Sender<Msg>) {
    thread::spawn(move || {
        loop {
            let reason = match client.changes() {
                Ok(reader) => {
                    if tx.send(Msg::StreamUp).is_err() {
                        return;
                    }
                    let mut parser = SseParser::default();
                    let mut reason = "The change feed closed".to_string();
                    for line in reader.lines() {
                        match line {
                            Ok(line) => {
                                if let Some(event) = parser.push(&line)
                                    && event.event == "change"
                                    && tx.send(Msg::Change(event.data)).is_err()
                                {
                                    return;
                                }
                            }
                            Err(error) => {
                                reason = error.to_string();
                                break;
                            }
                        }
                    }
                    reason
                }
                Err(failure) => failure.message,
            };
            if tx.send(Msg::StreamDown(reason)).is_err() {
                return;
            }
            thread::sleep(sse::RETRY);
        }
    });
}

fn run(url: Option<String>, env: &Env) -> ExitCode {
    let resolved = resolve_url(url.as_deref(), env).and_then(|url| Ok((url, resolve_token(env)?)));
    let (url, token) = match resolved {
        Ok(pair) => pair,
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::from(2);
        }
    };
    if !stdout().is_terminal() {
        eprintln!("mypi-tui needs a terminal");
        return ExitCode::from(2);
    }
    let root = std::env::current_exe()
        .map_err(|e| e.to_string())
        .and_then(|exe| open::engine_root(env, &exe));

    let client = Client::new(url.clone(), token);
    let (tx, rx) = mpsc::channel();
    spawn_changes(client.clone(), tx.clone());
    let mut app = App::new(open::in_herdr(env));
    app.url = url;

    let mut terminal = ratatui::init();
    let _ = execute!(stdout(), EnableMouseCapture);
    let hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let _ = execute!(std::io::stdout(), DisableMouseCapture);
        hook(info);
    }));

    let mut hits = HitMap::default();
    let mut result = Ok(());
    while !app.quit {
        if let Err(error) = terminal.draw(|frame| ui::draw(frame, &mut app, &mut hits)) {
            result = Err(error);
            break;
        }
        match event::poll(Duration::from_millis(100))
            .and_then(|ready| ready.then(event::read).transpose())
        {
            Ok(Some(Event::Key(key))) => app.key(key),
            Ok(Some(Event::Mouse(mouse))) => hit::on_mouse(&mut app, &hits, mouse),
            Ok(_) => {}
            Err(error) => {
                result = Err(error);
                break;
            }
        }
        while let Ok(msg) = rx.try_recv() {
            app.apply(msg);
        }
        for effect in app.take_effects() {
            match effect {
                Effect::Info => {
                    let (client, tx) = (client.clone(), tx.clone());
                    thread::spawn(move || {
                        let _ = tx.send(Msg::Info(client.get("/v1/info", &[]).and_then(as_info)));
                    });
                }
                Effect::Load {
                    section,
                    generation,
                    kind,
                    path,
                    query,
                } => {
                    let (client, tx) = (client.clone(), tx.clone());
                    thread::spawn(move || {
                        let result = client.get(path, &query).and_then(as_page);
                        let _ = tx.send(Msg::Loaded {
                            section,
                            generation,
                            kind,
                            result,
                        });
                    });
                }
                Effect::Open(key) => match &root {
                    Ok(root) => open::spawn_open(root.clone(), key, tx.clone()),
                    Err(error) => app.apply(Msg::Opened(error.clone())),
                },
            }
        }
    }

    let _ = execute!(stdout(), DisableMouseCapture);
    ratatui::restore();
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("mypi-tui: {error}");
            ExitCode::from(1)
        }
    }
}
