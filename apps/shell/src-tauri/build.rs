fn main() {
    tauri_build::build();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        // Let the cfg(test) link in lib.rs find the resource Tauri generated.
        println!("cargo:rustc-link-search=native={}", std::env::var("OUT_DIR").unwrap());
    }
    journal_schema();
}

/// The journal schema of the core this shell ships, which the updater compares
/// with a release's before offering it. scripts/ci/updater-manifest.ts reads the
/// same line into each release's latest.json.
fn journal_schema() {
    let path = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("../../../packages/core/src/journal/schema.ts");
    println!("cargo:rerun-if-changed={}", path.display());
    let source = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let version = source.lines()
        .find_map(|line| line.strip_prefix("export const SCHEMA_VERSION = ")?.strip_suffix(';')?.parse::<u64>().ok())
        .unwrap_or_else(|| panic!("{}: expected `export const SCHEMA_VERSION = <number>;`", path.display()));
    println!("cargo:rustc-env=BOITE_JOURNAL_SCHEMA={version}");
}
