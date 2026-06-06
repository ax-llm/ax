use axllm::{parse_json, run_conformance_fixture, AxResult};
use std::env;
use std::fs;
use std::path::Path;

fn main() -> AxResult<()> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.is_empty() {
        println!("rust-conformance-ok");
        return Ok(());
    }
    for arg in args {
        visit(Path::new(&arg))?;
    }
    Ok(())
}

fn visit(path: &Path) -> AxResult<()> {
    if path.is_dir() {
        let mut entries = fs::read_dir(path)?.collect::<Result<Vec<_>, _>>()?;
        entries.sort_by_key(|entry| entry.path());
        for entry in entries {
            visit(&entry.path())?;
        }
        return Ok(());
    }
    if path.extension().and_then(|value| value.to_str()) != Some("json") {
        return Ok(());
    }
    let text = fs::read_to_string(path)?;
    let fixture = parse_json(&text)?;
    run_conformance_fixture(fixture)?;
    println!(
        "ok {}",
        path.file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("fixture")
    );
    Ok(())
}
