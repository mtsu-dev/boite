use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;

use reqwest::{header, Client, Response, StatusCode};
use sha2::{Digest, Sha256};
use tauri_plugin_updater::Update;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

// The largest current package is about 150 MB. A bad server response cannot
// fill the data volume or be read into an unbounded allocation.
const MAX_PACKAGE: u64 = 512 * 1024 * 1024;

fn header(update: &Update) -> String {
    use std::fmt::Write as _;
    let mut header = format!("{}\n", update.version);
    for byte in Sha256::digest(update.signature.as_bytes()) {
        write!(&mut header, "{byte:02x}").unwrap();
    }
    header.push('\n');
    header
}

fn read_payload(path: &Path, expected: &str) -> Result<Option<Vec<u8>>, String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let mut file = BufReader::new(file);
    let mut found = vec![0; expected.len()];
    if file.read_exact(&mut found).is_err() || found != expected.as_bytes() { return Ok(None); }
    let length = file.get_ref().metadata().map_err(|error| error.to_string())?.len().saturating_sub(found.len() as u64);
    if length == 0 || length > MAX_PACKAGE { return Ok(None); }
    let mut bytes = Vec::with_capacity(length as usize);
    file.take(MAX_PACKAGE + 1).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
    Ok((bytes.len() as u64 == length).then_some(bytes))
}

/// The cache key only identifies a candidate. The signature, including its
/// trusted version, is verified over the exact bytes returned to the caller.
pub(super) async fn load(path: &Path, update: &Update) -> Result<Option<Vec<u8>>, String> {
    let path = path.to_path_buf();
    let update = update.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(bytes) = read_payload(&path, &header(&update))? else { return Ok(None); };
        if update.verify(&bytes).is_err() { return Ok(None); }
        Ok(Some(bytes))
    }).await.map_err(|error| error.to_string())?
}

pub(super) fn remove_installed(path: &Path, version: &str) {
    let installed = File::open(path).ok().is_some_and(|file| {
        let mut line = String::new();
        BufReader::new(file).take(256).read_line(&mut line).is_ok() && line == format!("{version}\n")
    });
    if installed { let _ = std::fs::remove_file(path); }
}

fn strong_etag(value: &str) -> Option<&str> {
    (value.len() <= 256 && value.strip_prefix('"')?.ends_with('"') && value.len() >= 2).then_some(value)
}

async fn resumable(path: &Path, identity: &str, tag_path: &Path) -> Option<(u64, String)> {
    let tag = tokio::fs::read_to_string(tag_path).await.ok()?;
    strong_etag(&tag)?;
    let mut file = tokio::fs::File::open(path).await.ok()?;
    let mut stored = vec![0; identity.len()];
    file.read_exact(&mut stored).await.ok()?;
    if stored != identity.as_bytes() { return None; }
    let length = file.metadata().await.ok()?.len().checked_sub(stored.len() as u64)?;
    (length > 0 && length < MAX_PACKAGE).then_some((length, tag))
}

async fn request(client: &Client, update: &Update, resume: Option<&(u64, String)>) -> Result<Response, String> {
    let mut request = client.get(update.download_url.clone())
        .header(header::ACCEPT, "application/octet-stream")
        .header(header::ACCEPT_ENCODING, "identity");
    if let Some((offset, tag)) = resume {
        request = request.header(header::RANGE, format!("bytes={offset}-")).header(header::IF_RANGE, tag);
    }
    request.send().await.map_err(|error| error.to_string())
}

fn resume_total(range: &str, offset: u64) -> Option<u64> {
    let (bounds, total) = range.strip_prefix("bytes ")?.split_once('/')?;
    let (start, end) = bounds.split_once('-')?;
    let (start, end, total) = (start.parse::<u64>().ok()?, end.parse::<u64>().ok()?, total.parse::<u64>().ok()?);
    (start == offset && end >= start && end.checked_add(1)? == total && total <= MAX_PACKAGE).then_some(total)
}

pub(super) async fn download(path: &Path, update: &Update, mut progress: impl FnMut(u64, Option<u64>)) -> Result<Vec<u8>, String> {
    let temporary = path.with_extension("partial");
    let tag_path = path.with_extension("etag");
    let identity = header(update);
    let resume = resumable(&temporary, &identity, &tag_path).await;
    let client = super::release_client(super::READ_TIMEOUT)?;
    let mut response = request(&client, update, resume.as_ref()).await?;
    if resume.is_some() && response.status() == StatusCode::RANGE_NOT_SATISFIABLE {
        response = request(&client, update, None).await?;
    }
    let mut response = response.error_for_status().map_err(|error| error.to_string())?;
    let tag = response.headers().get(header::ETAG).and_then(|value| value.to_str().ok()).and_then(strong_etag);
    let (mut received, length) = match response.status() {
        StatusCode::OK => (0, response.content_length()),
        StatusCode::PARTIAL_CONTENT => {
            let continuation = resume.as_ref().and_then(|(offset, previous)| {
                if tag != Some(previous.as_str()) { return None; }
                let range = response.headers().get(header::CONTENT_RANGE)?.to_str().ok()?;
                let total = resume_total(range, *offset)?;
                Some((*offset, Some(total)))
            });
            if continuation.is_none() { let _ = tokio::fs::remove_file(&tag_path).await; }
            continuation.ok_or("Invalid update continuation; retry to download the full package")?
        }
        status => return Err(format!("Unexpected update download status: {status}")),
    };
    if length.is_some_and(|length| length > MAX_PACKAGE) { return Err("Update payload exceeds 512 MiB".into()); }
    let mut file = if received == 0 {
        let _ = tokio::fs::remove_file(&tag_path).await;
        let mut file = tokio::fs::File::create(&temporary).await.map_err(|error| error.to_string())?;
        file.write_all(identity.as_bytes()).await.map_err(|error| error.to_string())?;
        file.flush().await.map_err(|error| error.to_string())?;
        if let Some(tag) = tag { let _ = tokio::fs::write(&tag_path, tag).await; }
        file
    } else {
        tokio::fs::OpenOptions::new().append(true).open(&temporary).await.map_err(|error| error.to_string())?
    };
    progress(received, length);
    while let Some(bytes) = response.chunk().await.map_err(|error| error.to_string())? {
        received += bytes.len() as u64;
        if received > length.unwrap_or(MAX_PACKAGE) {
            let _ = tokio::fs::remove_file(&tag_path).await;
            return Err("Update payload exceeds its declared size".into());
        }
        file.write_all(&bytes).await.map_err(|error| error.to_string())?;
        progress(received, length);
    }
    if length.is_some_and(|length| received != length) { return Err("Update download ended before the complete package arrived".into()); }
    file.sync_all().await.map_err(|error| error.to_string())?;
    drop(file);
    let Some(verified) = load(&temporary, update).await? else {
        let _ = tokio::fs::remove_file(&tag_path).await;
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err("Downloaded update did not match its signed package".into());
    };
    tokio::fs::rename(&temporary, path).await.map_err(|error| format!("Cannot cache verified update: {error}"))?;
    let _ = tokio::fs::remove_file(&tag_path).await;
    Ok(verified)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_persistent_cache_only_reads_the_package_for_the_manifest_identity() {
        let path = std::env::temp_dir().join(format!("boite-update-cache-{}", std::process::id()));
        std::fs::write(&path, "first\nidentity\npayload").unwrap();
        assert_eq!(read_payload(&path, "first\nidentity\n").unwrap().as_deref(), Some(b"payload".as_slice()));
        assert!(read_payload(&path, "first\nother\n").unwrap().is_none());
        remove_installed(&path, "second");
        assert!(path.is_file());
        remove_installed(&path, "first");
        assert!(!path.is_file());
    }

    #[test]
    fn a_ranged_response_must_continue_the_exact_package_with_a_strong_etag() {
        assert_eq!(strong_etag("\"e1\""), Some("\"e1\""));
        assert_eq!(strong_etag("W/\"e1\""), None);
        assert_eq!(resume_total("bytes 16-63/64", 16), Some(64));
        assert_eq!(resume_total("bytes 16-63/64", 17), None);
        assert_eq!(resume_total("bytes 16-62/64", 16), None);
        assert_eq!(resume_total("bytes 16-536870912/536870913", 16), None);
    }
}
