#![allow(dead_code)]

mod config;
mod filters;
mod model;

fn main() {
    println!("mypi-tui {}", env!("CARGO_PKG_VERSION"));
}
