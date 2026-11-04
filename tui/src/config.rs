use std::collections::HashMap;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

pub type Env = HashMap<String, String>;

pub const DEFAULT_URL: &str = "http://127.0.0.1:8737";
pub const USAGE: &str = concat!(
    "mypi-tui: browse the mypi database through its HTTP API (docs/TUI.md)\n",
    "Usage: mypi-tui [--url http://HOST:PORT]   browse; the URL defaults to MYPI_API_URL, else http://127.0.0.1:8737\n",
    "       mypi-tui herdr-open                  the mypi Herdr plugin action: open the browser in a new tab\n",
    "       mypi-tui --help | --version\n",
    "Token: MYPI_API_TOKEN, else $XDG_CONFIG_HOME/mypi/tui-token (mode 0600, a read token from mypi token create)",
);

#[derive(Debug, PartialEq)]
pub enum Command {
    Browse { url: Option<String> },
    HerdrOpen,
    Help,
    Version,
}

pub fn parse_args(args: &[String]) -> Result<Command, String> {
    let words: Vec<&str> = args.iter().map(String::as_str).collect();
    match words.as_slice() {
        [] => Ok(Command::Browse { url: None }),
        ["--url", url] => Ok(Command::Browse {
            url: Some(url.to_string()),
        }),
        ["herdr-open"] => Ok(Command::HerdrOpen),
        ["--help"] | ["-h"] => Ok(Command::Help),
        ["--version"] | ["-V"] => Ok(Command::Version),
        _ => Err(format!("Unknown arguments: {}\n{USAGE}", words.join(" "))),
    }
}

pub fn resolve_url(flag: Option<&str>, env: &Env) -> Result<String, String> {
    let value = match flag {
        Some(url) => url,
        None => match env.get("MYPI_API_URL") {
            Some(url) if !url.is_empty() => url.as_str(),
            _ => DEFAULT_URL,
        },
    };
    if value.starts_with("https://") {
        return Err("Only http:// URLs are supported: run the TUI on the machine of mypi serve or reach it over Tailscale".into());
    }
    let url = value.trim_end_matches('/');
    match url.strip_prefix("http://") {
        Some(rest) if !rest.is_empty() && !rest.starts_with('/') => Ok(url.to_string()),
        _ => Err(format!("Invalid API URL: {value}")),
    }
}

pub fn token_path(env: &Env) -> Result<PathBuf, String> {
    let absolute = |key: &str| {
        env.get(key)
            .filter(|v| !v.is_empty() && v.starts_with('/'))
            .map(PathBuf::from)
    };
    let root = match absolute("XDG_CONFIG_HOME") {
        Some(root) => root,
        None => absolute("HOME").map(|home| home.join(".config")).ok_or(
            "XDG_CONFIG_HOME or HOME must be absolute; the TUI token lives in $XDG_CONFIG_HOME/mypi/tui-token",
        )?,
    };
    Ok(root.join("mypi").join("tui-token"))
}

pub fn resolve_token(env: &Env) -> Result<String, String> {
    if let Some(token) = env
        .get("MYPI_API_TOKEN")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
    {
        return checked(token, "MYPI_API_TOKEN");
    }
    let path = token_path(env)?;
    let shown = path.display();
    let meta = match std::fs::symlink_metadata(&path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(format!(
                "No API token: set MYPI_API_TOKEN or write a read token to {shown} (mode 0600); create one with mypi token create tui --permission read"
            ));
        }
        Err(e) => return Err(format!("Cannot read {shown}: {e}")),
    };
    if !meta.file_type().is_file() || meta.permissions().mode() & 0o077 != 0 {
        return Err(format!(
            "The token file must be a private regular file (0600): {shown}"
        ));
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("Cannot read {shown}: {e}"))?;
    checked(text.trim(), &shown.to_string())
}

fn checked(token: &str, source: &str) -> Result<String, String> {
    let valid = !token.is_empty()
        && token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if valid {
        Ok(token.to_string())
    } else {
        Err(format!("Invalid API token in {source}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn env(pairs: &[(&str, &str)]) -> Env {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn parse_args_accepts_browse_url_herdr_open_help_and_version_and_refuses_the_rest() {
        assert_eq!(parse_args(&args(&[])), Ok(Command::Browse { url: None }));
        assert_eq!(
            parse_args(&args(&["--url", "http://h:1"])),
            Ok(Command::Browse {
                url: Some("http://h:1".into())
            })
        );
        assert_eq!(parse_args(&args(&["herdr-open"])), Ok(Command::HerdrOpen));
        assert_eq!(parse_args(&args(&["--help"])), Ok(Command::Help));
        assert_eq!(parse_args(&args(&["-h"])), Ok(Command::Help));
        assert_eq!(parse_args(&args(&["--version"])), Ok(Command::Version));
        assert_eq!(parse_args(&args(&["-V"])), Ok(Command::Version));
        for bad in [&["--url"][..], &["x"], &["--url", "a", "b"]] {
            let err = parse_args(&args(bad)).unwrap_err();
            assert!(err.starts_with(&format!("Unknown arguments: {}\n", bad.join(" "))));
            assert!(err.contains("Usage:"));
        }
    }

    #[test]
    fn url_prefers_the_flag_then_env_then_default_and_refuses_https_and_garbage() {
        let with_env = env(&[("MYPI_API_URL", "http://env:2")]);
        assert_eq!(
            resolve_url(Some("http://h:1/"), &with_env),
            Ok("http://h:1".into())
        );
        assert_eq!(resolve_url(None, &with_env), Ok("http://env:2".into()));
        assert_eq!(resolve_url(None, &env(&[])), Ok(DEFAULT_URL.into()));
        assert_eq!(
            resolve_url(None, &env(&[("MYPI_API_URL", "")])),
            Ok(DEFAULT_URL.into())
        );
        assert_eq!(
            resolve_url(Some("https://x"), &env(&[])),
            Err("Only http:// URLs are supported: run the TUI on the machine of mypi serve or reach it over Tailscale".into())
        );
        for bad in ["ftp://x", "http://"] {
            assert_eq!(
                resolve_url(Some(bad), &env(&[])),
                Err(format!("Invalid API URL: {bad}"))
            );
        }
    }

    #[test]
    fn token_comes_from_env_or_a_private_file_and_bad_files_are_refused() {
        let dir = std::env::temp_dir().join(format!("mypi-tui-{}-token", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mypi = dir.join("mypi");
        std::fs::create_dir_all(&mypi).unwrap();
        let file = mypi.join("tui-token");
        let base = env(&[("XDG_CONFIG_HOME", dir.to_str().unwrap())]);
        let chmod = |mode: u32| {
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(mode)).unwrap()
        };

        assert!(
            resolve_token(&base)
                .unwrap_err()
                .starts_with("No API token: set MYPI_API_TOKEN or write a read token to ")
        );

        std::fs::write(&file, "mypi_x-Y_1\n").unwrap();
        chmod(0o644);
        let mut with_env = base.clone();
        with_env.insert("MYPI_API_TOKEN".into(), " abc ".into());
        assert_eq!(resolve_token(&with_env), Ok("abc".into()));
        assert!(
            resolve_token(&base)
                .unwrap_err()
                .contains("private regular file")
        );

        chmod(0o600);
        assert_eq!(resolve_token(&base), Ok("mypi_x-Y_1".into()));

        let real = dir.join("real-token");
        std::fs::rename(&file, &real).unwrap();
        std::os::unix::fs::symlink(&real, &file).unwrap();
        assert!(
            resolve_token(&base)
                .unwrap_err()
                .contains("private regular file")
        );
        std::fs::remove_file(&file).unwrap();

        std::fs::write(&file, "a b").unwrap();
        chmod(0o600);
        assert_eq!(
            resolve_token(&base),
            Err(format!("Invalid API token in {}", file.display()))
        );

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn token_path_uses_xdg_config_home_then_home() {
        assert_eq!(
            token_path(&env(&[("HOME", "/h")])),
            Ok(PathBuf::from("/h/.config/mypi/tui-token"))
        );
        assert_eq!(
            token_path(&env(&[("XDG_CONFIG_HOME", "/c"), ("HOME", "/h")])),
            Ok(PathBuf::from("/c/mypi/tui-token"))
        );
        assert!(token_path(&env(&[("XDG_CONFIG_HOME", "rel")])).is_err());
    }
}
