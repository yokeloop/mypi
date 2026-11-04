#![allow(dead_code)]

mod api;
mod app;
mod config;
mod filters;
mod model;
mod sse;

fn main() {
    println!("mypi-tui {}", env!("CARGO_PKG_VERSION"));
}
