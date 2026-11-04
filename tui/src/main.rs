#![allow(dead_code)]

mod api;
mod config;
mod filters;
mod model;

fn main() {
    println!("mypi-tui {}", env!("CARGO_PKG_VERSION"));
}
