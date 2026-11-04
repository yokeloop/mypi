#![allow(dead_code)]

mod api;
mod app;
mod config;
mod filters;
mod hit;
mod layout;
mod model;
mod sse;
mod ui;

fn main() {
    println!("mypi-tui {}", env!("CARGO_PKG_VERSION"));
}
