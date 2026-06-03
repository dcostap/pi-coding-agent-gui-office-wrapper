use crate::constants;
use crate::setup::SetupPayload;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonicalPath {
    original: PathBuf,
    canonical: PathBuf,
    key: String,
}

impl CanonicalPath {
    pub fn original(&self) -> &Path {
        &self.original
    }

    pub fn canonical(&self) -> &Path {
        &self.canonical
    }

    pub fn key(&self) -> &str {
        &self.key
    }
}

pub fn canonical_path_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase()
}

pub fn canonicalize_existing_or_parent(path: impl AsRef<Path>) -> Result<CanonicalPath, String> {
    let original = absolutize(path.as_ref())?;
    reject_bad_components(&original)?;

    if original.exists() {
        let canonical = dunce::canonicalize(&original)
            .map_err(|error| format!("canonicalize {} failed: {error}", original.display()))?;
        return Ok(CanonicalPath {
            original,
            key: canonical_path_key(&canonical),
            canonical,
        });
    }

    let mut existing = original.clone();
    let mut suffix = Vec::new();
    while !existing.exists() {
        let Some(name) = existing.file_name().map(|value| value.to_os_string()) else {
            return Err(format!(
                "path has no existing parent that can be canonicalized: {}",
                original.display()
            ));
        };
        suffix.push(name);
        if !existing.pop() {
            return Err(format!(
                "path has no existing parent that can be canonicalized: {}",
                original.display()
            ));
        }
    }

    let mut canonical = dunce::canonicalize(&existing)
        .map_err(|error| format!("canonicalize {} failed: {error}", existing.display()))?;
    for component in suffix.iter().rev() {
        canonical.push(component);
    }

    Ok(CanonicalPath {
        original,
        key: canonical_path_key(&canonical),
        canonical,
    })
}

pub fn is_same_or_child(candidate: &Path, root: &Path) -> bool {
    let candidate_key = canonical_path_key(candidate);
    let root_key = canonical_path_key(root).trim_end_matches('/').to_string();
    candidate_key == root_key || candidate_key.starts_with(&(root_key + "/"))
}

pub fn expected_agent_data_root() -> Result<PathBuf, String> {
    let local_app_data = std::env::var_os("LOCALAPPDATA")
        .ok_or_else(|| "LOCALAPPDATA is required for Windows sandbox v2 setup".to_string())?;
    Ok(PathBuf::from(local_app_data)
        .join("OfficeAgent")
        .join("AgentData"))
}

fn user_profile_dir() -> Result<PathBuf, String> {
    if let Some(value) = std::env::var_os("USERPROFILE") {
        return Ok(PathBuf::from(value));
    }
    match (std::env::var_os("HOMEDRIVE"), std::env::var_os("HOMEPATH")) {
        (Some(mut drive), Some(path)) => {
            drive.push(path);
            Ok(PathBuf::from(drive))
        }
        _ => Err("USERPROFILE is required to validate standard read roots".to_string()),
    }
}

pub fn validate_setup_payload(payload: &SetupPayload) -> Result<(), String> {
    if !payload.expected_version() {
        return Err(format!(
            "unsupported setup payload version {}; expected {}",
            payload.version,
            crate::constants::SETUP_VERSION
        ));
    }
    if payload.real_user_name.trim().is_empty() {
        return Err("realUserName is required".to_string());
    }
    if !payload.real_user_sid.to_ascii_uppercase().starts_with("S-") {
        return Err("realUserSid must be a string SID".to_string());
    }

    let managed_root = canonicalize_existing_or_parent(&payload.managed_root)?;
    let expected = canonicalize_existing_or_parent(expected_agent_data_root()?)?;
    if !same_path(managed_root.canonical(), expected.canonical()) {
        return Err(format!(
            "managedRoot must be %LOCALAPPDATA%\\OfficeAgent\\AgentData: managedRoot={}, expected={}",
            managed_root.canonical().display(),
            expected.canonical().display()
        ));
    }

    validate_inside_managed(
        "sandbox dir",
        constants::sandbox_dir(managed_root.canonical()),
        managed_root.canonical(),
    )?;
    validate_inside_managed(
        "sandbox secrets dir",
        constants::sandbox_secrets_dir(managed_root.canonical()),
        managed_root.canonical(),
    )?;

    if let Some(project_root) = &payload.project_root {
        validate_inside_managed("projectRoot", project_root, managed_root.canonical())?;
    }
    if let Some(project_state_dir) = &payload.project_state_dir {
        let project_state_root = constants::project_state_root(managed_root.canonical());
        validate_inside_root("projectStateDir", project_state_dir, &project_state_root)?;
    }
    if let Some(session_dir) = &payload.session_dir {
        let sessions_root = constants::sessions_root(managed_root.canonical());
        validate_inside_root("sessionDir", session_dir, &sessions_root)?;
    }
    for path in &payload.read_roots {
        validate_read_root(path, managed_root.canonical())?;
    }
    for path in &payload.write_roots {
        validate_writable_root(path, managed_root.canonical())?;
    }
    Ok(())
}

pub fn validate_writable_root(path: &Path, managed_root: &Path) -> Result<(), String> {
    reject_remote_or_mapped_root(path)?;
    validate_inside_managed("writeRoot", path, managed_root)
}

pub fn validate_read_root(path: &Path, managed_root: &Path) -> Result<(), String> {
    if validate_inside_managed("readRoot", path, managed_root).is_ok() {
        return Ok(());
    }

    let candidate = canonicalize_existing_or_parent(path)?;
    let standard_roots = standard_user_read_roots()?;
    for root in standard_roots {
        if let Ok(root) = canonicalize_existing_or_parent(&root) {
            if is_same_or_child(candidate.canonical(), root.canonical()) {
                return Ok(());
            }
        }
    }

    Err(format!(
        "readRoot must be inside managedRoot or a standard user folder (Desktop, Documents, Downloads, Pictures, Videos, Music, Temp): {}",
        candidate.canonical().display()
    ))
}

pub fn standard_user_read_roots() -> Result<Vec<PathBuf>, String> {
    let user_profile = user_profile_dir()?;
    let mut roots: Vec<PathBuf> = [
        "Desktop",
        "Documents",
        "Downloads",
        "Pictures",
        "Videos",
        "Music",
    ]
    .iter()
    .map(|name| user_profile.join(name))
    .collect();
    roots.push(real_user_temp_dir(&user_profile));
    Ok(roots)
}

fn real_user_temp_dir(user_profile: &Path) -> PathBuf {
    std::env::var_os("TEMP")
        .or_else(|| std::env::var_os("TMP"))
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("LOCALAPPDATA").map(|value| PathBuf::from(value).join("Temp")))
        .unwrap_or_else(|| user_profile.join("AppData").join("Local").join("Temp"))
}

pub fn validate_inside_managed(
    label: &str,
    path: impl AsRef<Path>,
    managed_root: &Path,
) -> Result<(), String> {
    validate_inside_root(label, path, managed_root)
}

pub fn validate_inside_root(
    label: &str,
    path: impl AsRef<Path>,
    root: &Path,
) -> Result<(), String> {
    let root = canonicalize_existing_or_parent(root)?;
    let candidate = canonicalize_existing_or_parent(path.as_ref())?;
    if !is_same_or_child(candidate.canonical(), root.canonical()) {
        return Err(format!(
            "{label} must be inside {}: {}",
            root.canonical().display(),
            candidate.canonical().display()
        ));
    }
    Ok(())
}

fn same_path(left: &Path, right: &Path) -> bool {
    canonical_path_key(left) == canonical_path_key(right)
}

fn absolutize(path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() {
        return Err("path must not be empty".to_string());
    }
    let value = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| format!("current_dir failed: {error}"))?
            .join(path)
    };
    Ok(value.components().collect())
}

fn reject_bad_components(path: &Path) -> Result<(), String> {
    for component in path.components() {
        match component {
            Component::ParentDir => {
                return Err(format!("path must not contain '..': {}", path.display()))
            }
            Component::CurDir => {
                return Err(format!("path must not contain '.': {}", path.display()))
            }
            _ => {}
        }
    }
    Ok(())
}

fn reject_remote_or_mapped_root(path: &Path) -> Result<(), String> {
    let text = path.to_string_lossy().replace('/', "\\");
    if text.starts_with("\\\\") {
        return Err(format!("remote UNC writable roots are not allowed: {text}"));
    }
    let upper = text.to_ascii_uppercase();
    for drive in ["R:\\", "U:\\", "X:\\", "L:\\", "P:\\"] {
        if upper == drive || upper.starts_with(drive) {
            return Err(format!(
                "mapped/remote drive writable roots are not allowed: {text}"
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn key_normalizes_case_and_separators() {
        assert_eq!(
            canonical_path_key(Path::new(r"C:\Users\Dev\Repo")),
            canonical_path_key(Path::new("c:/users/dev/repo"))
        );
    }

    #[test]
    fn child_check_respects_boundaries() {
        assert!(is_same_or_child(
            Path::new(r"C:\root\child"),
            Path::new(r"C:\root")
        ));
        assert!(!is_same_or_child(
            Path::new(r"C:\rootish"),
            Path::new(r"C:\root")
        ));
    }
}
