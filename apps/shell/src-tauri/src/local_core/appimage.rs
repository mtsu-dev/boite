//! A resident process cannot load files from a mount owned by its shell.
use std::fs;
use std::io;
use std::os::unix::fs::{DirBuilderExt, MetadataExt};
use std::path::{Path, PathBuf};

const WORKERS: [&str; 2] = ["artifact-retention-worker.js", "linux-tcp-worker.js"];

/// Deploy and reuse the release's core and lazy resources outside the AppImage.
/// Build the whole directory before publishing it, so an interrupted copy
/// cannot leave an executable discoverable without its UI, CLI or workers.
pub(super) fn prepare(data: &Path, program: &Path, resources: Option<&Path>) -> Result<Option<PathBuf>, String> {
    let (Some(mount), Some(image)) = (std::env::var_os("APPDIR"), std::env::var_os("APPIMAGE")) else { return Ok(None); };
    let mount = Path::new(&mount);
    if !program.starts_with(mount) { return Ok(None); }
    let resources = resources.filter(|path| path.starts_with(mount)).ok_or("AppImage has no mounted resource directory")?;
    let package = Path::new(&image);
    let (image, core) = fs::metadata(package).and_then(|image| fs::metadata(program).map(|core| (image, core)))
        .map_err(|error| format!("cannot identify AppImage {}: {error}", package.display()))?;
    let key = format!("{}-{:x}-{:x}-{}-{}-{}-{}", env!("CARGO_PKG_VERSION"), image.dev(), image.ino(),
        image.mtime(), image.mtime_nsec(), core.len(), core.mtime());
    let root = data.join("appimage-runtime");
    deploy(&root, &key, program, resources).map(Some)
        .map_err(|error| format!("cannot deploy resident core into {}: {error}", root.display()))
}

/// Finds only an executable deployed by the AppImage, never bundled or
/// developer files. Capture the path before the identified core exits.
pub(super) fn running_deployment(data: &Path, pid: u32) -> Option<PathBuf> {
    let root = fs::canonicalize(data.join("appimage-runtime")).ok()?;
    let executable = fs::read_link(format!("/proc/{pid}/exe")).ok()?;
    let generation = executable.parent()?;
    (generation.parent() == Some(root.as_path()) && executable.file_name()? == "boite-core")
        .then(|| generation.to_path_buf())
}

fn deploy(root: &Path, key: &str, program: &Path, resources: &Path) -> io::Result<PathBuf> {
    let destination = root.join(key);
    if destination.join("boite-core").is_file() { return Ok(destination); }
    fs::create_dir_all(root)?;
    let staging = root.join(format!(".{key}-{}", std::process::id()));
    fs::DirBuilder::new().mode(0o700).create(&staging)?;
    let result = (|| {
        fs::copy(program, staging.join("boite-core"))?;
        fs::copy(program.with_file_name("boite-launch"), staging.join("boite-launch"))?;
        fs::copy(resources.join("boite"), staging.join("boite"))?;
        for name in WORKERS { fs::copy(resources.join(name), staging.join(name))?; }
        fs::metadata(resources.join("ui/index.html"))?;
        copy_tree(&resources.join("ui"), &staging.join("ui"))?;
        match fs::rename(&staging, &destination) {
            Err(_) if destination.join("boite-core").is_file() => Ok(()),
            result => result,
        }
    })();
    let _ = fs::remove_dir_all(staging);
    result?;
    Ok(destination)
}

fn copy_tree(source: &Path, destination: &Path) -> io::Result<()> {
    fs::create_dir(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let target = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() { copy_tree(&entry.path(), &target)?; }
        else { fs::copy(entry.path(), target)?; }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn a_failed_copy_publishes_nothing_and_a_completed_core_survives_loss_of_the_mount() {
        let scratch = std::env::temp_dir().join(format!("boite-appimage-deploy-{}", std::process::id()));
        let mount = scratch.join("mount");
        let data = scratch.join("data");
        let program = mount.join("boite-core");
        fs::create_dir_all(mount.join("ui/assets")).unwrap();
        fs::write(&program, b"core").unwrap();
        fs::write(mount.join("boite"), b"CLI").unwrap();
        fs::write(mount.join("ui/index.html"), b"index").unwrap();
        fs::write(mount.join("ui/assets/front.js"), b"UI").unwrap();
        let launcher = mount.join("boite-launch");
        fs::write(&launcher, b"launcher").unwrap();
        fs::set_permissions(&launcher, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(deploy(&data, "package", &program, &mount).is_err());
        assert!(fs::read_dir(&data).unwrap().next().is_none());
        for name in WORKERS { fs::write(mount.join(name), b"worker").unwrap(); }
        let pending_launcher = mount.join("launcher-pending");
        fs::rename(&launcher, &pending_launcher).unwrap();
        assert!(deploy(&data, "package", &program, &mount).is_err());
        assert!(fs::read_dir(&data).unwrap().next().is_none());
        fs::rename(pending_launcher, launcher).unwrap();
        let deployed = deploy(&data, "package", &program, &mount).unwrap();
        fs::remove_dir_all(&mount).unwrap();
        assert_eq!(fs::read(deployed.join("boite-core")).unwrap(), b"core");
        let deployed_launcher = deployed.join("boite-launch");
        assert_eq!(fs::read(&deployed_launcher).unwrap(), b"launcher");
        assert_eq!(fs::metadata(deployed_launcher).unwrap().mode() & 0o777, 0o755);
        assert_eq!(fs::read(deployed.join("boite")).unwrap(), b"CLI");
        assert_eq!(fs::read(deployed.join(WORKERS[0])).unwrap(), b"worker");
        assert_eq!(fs::read(deployed.join("ui/assets/front.js")).unwrap(), b"UI");
        fs::remove_dir_all(scratch).unwrap();
    }
}
