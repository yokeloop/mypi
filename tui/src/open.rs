use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};
use std::sync::mpsc::Sender;

use crate::app::Msg;
use crate::config::Env;

pub fn in_herdr(env: &Env) -> bool {
    env.get("HERDR_ENV").map(String::as_str) == Some("1")
}

pub fn engine_root(env: &Env, exe: &Path) -> Result<PathBuf, String> {
    let root = match env.get("MYPI_ENGINE_ROOT") {
        Some(root) if !root.is_empty() && root.starts_with('/') => PathBuf::from(root),
        _ => exe
            .parent()
            .and_then(Path::parent)
            .and_then(Path::parent)
            .map(Path::to_path_buf)
            .unwrap_or_default(),
    };
    let cli = root.join("dist/src/cli/main.js");
    if cli.is_file() {
        Ok(root)
    } else {
        Err(format!(
            "The engine CLI is not built at {}: run mise exec -- pnpm build there, or set MYPI_ENGINE_ROOT",
            cli.display()
        ))
    }
}

pub fn open_command(key: &str) -> (&'static str, Vec<String>) {
    let args = ["exec", "--", "node", "dist/src/cli/main.js", "open", key];
    ("mise", args.iter().map(|s| s.to_string()).collect())
}

fn opened(stdout: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(stdout).ok()?;
    let items = value.get("opened")?.as_array()?;
    let text = |item: &serde_json::Value, field: &str| {
        item.get(field)
            .and_then(serde_json::Value::as_str)
            .unwrap_or("?")
            .to_string()
    };
    let parts: Vec<String> = items
        .iter()
        .map(|item| {
            let mut part = format!(
                "{}: {} ({})",
                text(item, "key"),
                text(item, "action"),
                text(item, "agent")
            );
            for note in item
                .get("notes")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(serde_json::Value::as_str)
                .filter(|note| !note.is_empty())
            {
                part.push_str("; ");
                part.push_str(note);
            }
            part
        })
        .collect();
    Some(parts.join(" · "))
}

pub fn outcome(success: bool, stdout: &str, stderr: &str) -> String {
    if success {
        return match opened(stdout) {
            Some(text) => text,
            None if stdout.trim().is_empty() => "Opened".to_string(),
            None => stdout.trim().to_string(),
        };
    }
    let Some(last) = stderr.lines().map(str::trim).rfind(|line| !line.is_empty()) else {
        return "Open failed: mypi open exited with an error".to_string();
    };
    let message = serde_json::from_str::<serde_json::Value>(last)
        .ok()
        .and_then(|v| {
            v.get("message")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        });
    match message {
        Some(message) => format!("Open failed: {message}"),
        None => format!(
            "Open failed: {}",
            last.strip_prefix("mypi: ").unwrap_or(last)
        ),
    }
}

pub fn spawn_open(root: PathBuf, key: String, tx: Sender<Msg>) {
    std::thread::spawn(move || {
        let (program, args) = open_command(&key);
        let child = Command::new(program)
            .args(&args)
            .current_dir(&root)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();
        let mut child = match child {
            Ok(child) => child,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let _ = tx.send(Msg::Opened(format!(
                    "mise is not on PATH: the TUI opens tabs with mise exec -- node dist/src/cli/main.js open {key} in {}",
                    root.display()
                )));
                return;
            }
            Err(e) => {
                let _ = tx.send(Msg::Opened(format!("Open failed: {e}")));
                return;
            }
        };
        let stdout = child.stdout.take().map(|mut pipe| {
            std::thread::spawn(move || {
                let mut text = String::new();
                let _ = pipe.read_to_string(&mut text);
                text
            })
        });
        let mut stderr = String::new();
        if let Some(pipe) = child.stderr.take() {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                if let Some(progress) = line.strip_prefix("mypi: ") {
                    let _ = tx.send(Msg::OpenProgress(progress.to_string()));
                }
                stderr.push_str(&line);
                stderr.push('\n');
            }
        }
        let success = child.wait().map(|status| status.success()).unwrap_or(false);
        let stdout = stdout
            .and_then(|reader| reader.join().ok())
            .unwrap_or_default();
        let _ = tx.send(Msg::Opened(outcome(success, &stdout, &stderr)));
    });
}

pub fn pane_open_args(plugin_id: &str) -> Vec<String> {
    let args = [
        "plugin",
        "pane",
        "open",
        "--plugin",
        plugin_id,
        "--entrypoint",
        "browser",
        "--placement",
        "tab",
        "--focus",
    ];
    args.iter().map(|s| s.to_string()).collect()
}

pub fn herdr_open(env: &Env) -> ExitCode {
    let set = |key: &str| env.get(key).filter(|v| !v.is_empty());
    let (Some(bin), Some(id)) = (set("HERDR_BIN_PATH"), set("HERDR_PLUGIN_ID")) else {
        eprintln!(
            "herdr-open is the action of the mypi Herdr plugin: HERDR_BIN_PATH and HERDR_PLUGIN_ID are not set"
        );
        return ExitCode::from(2);
    };
    match Command::new(bin).args(pane_open_args(id)).status() {
        Ok(status) => ExitCode::from(u8::try_from(status.code().unwrap_or(1)).unwrap_or(1)),
        Err(e) => {
            eprintln!("Cannot run {bin}: {e}");
            ExitCode::from(1)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> Env {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn strings(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn engine_root_comes_from_the_override_or_the_binary_location() {
        let dir = std::env::temp_dir().join(format!("mypi-tui-{}-root", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("dist/src/cli")).unwrap();
        std::fs::create_dir_all(dir.join("tui/bin")).unwrap();
        std::fs::write(dir.join("dist/src/cli/main.js"), "").unwrap();
        let exe = dir.join("tui/bin/mypi-tui");
        let elsewhere = Path::new("/nowhere/tui/bin/mypi-tui");
        let root = dir.to_str().unwrap();

        assert_eq!(engine_root(&env(&[]), &exe), Ok(dir.clone()));
        assert_eq!(
            engine_root(&env(&[("MYPI_ENGINE_ROOT", root)]), elsewhere),
            Ok(dir.clone())
        );
        assert_eq!(
            engine_root(&env(&[("MYPI_ENGINE_ROOT", "relative")]), &exe),
            Ok(dir.clone())
        );
        let missing = engine_root(&env(&[]), elsewhere).unwrap_err();
        assert!(
            missing.starts_with("The engine CLI is not built at /nowhere/dist/src/cli/main.js")
        );
        assert!(missing.contains("run mise exec -- pnpm build"));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn open_outcome_reports_opened_sessions_notes_and_cli_errors() {
        assert_eq!(
            outcome(
                true,
                r#"{"opened":[{"key":"MP-7","agent":"claude","action":"started","notes":["start message not delivered: x"]}]}"#,
                ""
            ),
            "MP-7: started (claude); start message not delivered: x"
        );
        assert_eq!(
            outcome(
                true,
                r#"{"opened":[{"key":"MP","agent":"pi","action":"focused","notes":[]},{"key":"MP-1","agent":"claude","action":"resumed"}]}"#,
                ""
            ),
            "MP: focused (pi) · MP-1: resumed (claude)"
        );
        assert_eq!(outcome(true, " done \n", ""), "done");
        assert_eq!(outcome(true, "", ""), "Opened");
        assert_eq!(
            outcome(
                false,
                "",
                "mypi: cloning\n{\"status\":\"error\",\"message\":\"Herdr is not available (…)\"}\n"
            ),
            "Open failed: Herdr is not available (…)"
        );
        assert_eq!(outcome(false, "", "boom\n"), "Open failed: boom");
        assert_eq!(
            outcome(false, "", "mypi: cloning\n\n"),
            "Open failed: cloning"
        );
        assert_eq!(
            outcome(false, "", ""),
            "Open failed: mypi open exited with an error"
        );
    }

    #[test]
    fn herdr_detection_command_and_pane_arguments() {
        assert!(in_herdr(&env(&[("HERDR_ENV", "1")])));
        assert!(!in_herdr(&env(&[])));
        assert!(!in_herdr(&env(&[("HERDR_ENV", "0")])));
        assert_eq!(
            open_command("MP"),
            (
                "mise",
                strings(&["exec", "--", "node", "dist/src/cli/main.js", "open", "MP"])
            )
        );
        assert_eq!(
            pane_open_args("yokeloop.mypi"),
            strings(&[
                "plugin",
                "pane",
                "open",
                "--plugin",
                "yokeloop.mypi",
                "--entrypoint",
                "browser",
                "--placement",
                "tab",
                "--focus"
            ])
        );
    }
}
