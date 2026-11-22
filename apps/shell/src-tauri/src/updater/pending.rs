use std::path::Path;

use tauri::AppHandle;
use tauri_plugin_updater::Update;

#[cfg(windows)]
use crate::platform::windows_installer::PreparedNsis;

pub(super) struct Pending {
    pub(super) update: Update,
    verified: Option<Verified>,
}

enum Verified {
    Bytes(Vec<u8>),
    #[cfg(windows)]
    Nsis {
        installer: PreparedNsis,
        bytes: u64,
    },
}

impl Pending {
    /// Both caches supply bytes already verified against the selected manifest.
    /// Prepare the Windows installer while the core is still serving requests.
    pub(super) async fn prepare(
        update: Update,
        bytes: Option<Vec<u8>>,
        _cache: &Path,
    ) -> Result<Self, String> {
        let Some(bytes) = bytes else {
            return Ok(Self {
                update,
                verified: None,
            });
        };
        #[cfg(windows)]
        if update.download_url.path().ends_with("-setup.exe") {
            if !bytes.starts_with(b"MZ") {
                return Err("the signed Windows installer is not an executable".into());
            }
            let size = bytes.len() as u64;
            let path = _cache.with_extension("exe");
            let started = std::time::Instant::now();
            let installer = tauri::async_runtime::spawn_blocking(move || {
                PreparedNsis::prepare(path.clone(), &bytes).map_err(|error| {
                    format!(
                        "cannot prepare the Windows installer at {}: {error}",
                        path.display()
                    )
                })
            })
            .await
            .map_err(|error| error.to_string())??;
            crate::shell_log::info(
                "updater",
                "shell.update.prepared",
                "prepared the verified Windows installer",
                serde_json::json!({ "version": update.version, "elapsedMs": started.elapsed().as_millis() }),
            );
            return Ok(Self {
                update,
                verified: Some(Verified::Nsis {
                    installer,
                    bytes: size,
                }),
            });
        }
        Ok(Self {
            update,
            verified: Some(Verified::Bytes(bytes)),
        })
    }

    pub(super) fn length(&self) -> Option<u64> {
        self.verified.as_ref().map(|payload| match payload {
            Verified::Bytes(bytes) => bytes.len() as u64,
            #[cfg(windows)]
            Verified::Nsis { bytes, .. } => *bytes,
        })
    }

    pub(super) fn install(&self, _app: &AppHandle) -> Result<(), String> {
        match self
            .verified
            .as_ref()
            .ok_or("Missing verified update payload")?
        {
            Verified::Bytes(bytes) => self
                .update
                .install(bytes)
                .map_err(|error| error.to_string()),
            #[cfg(windows)]
            Verified::Nsis { installer, .. } => {
                installer.launch(std::env::args_os().skip(1))?;
                _app.cleanup_before_exit();
                // NSIS starts the new version and takes the core lock once
                // this process exits. It refuses to write if another core won.
                std::process::exit(0);
            }
        }
    }
}
