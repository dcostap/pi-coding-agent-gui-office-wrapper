use crate::constants;
use crate::v2_paths;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapSids {
    pub workspace: String,
    pub readonly: String,
    #[serde(default)]
    pub workspace_by_cwd: HashMap<String, String>,
}

pub fn cap_sid_path(managed_root: &Path) -> PathBuf {
    constants::sandbox_dir(managed_root).join("cap_sid.json")
}

pub fn load_or_create_cap_sids(managed_root: &Path) -> Result<CapSids, String> {
    let path = cap_sid_path(managed_root);
    if path.exists() {
        let text = fs::read_to_string(&path)
            .map_err(|error| format!("read cap SID file {} failed: {error}", path.display()))?;
        if let Ok(caps) = serde_json::from_str::<CapSids>(text.trim()) {
            if caps.has_valid_sids() {
                return Ok(caps);
            }
        }
        let legacy = text.trim();
        if is_valid_cap_sid_string(legacy) {
            let caps = CapSids {
                workspace: legacy.to_string(),
                readonly: random_cap_sid_string(),
                workspace_by_cwd: HashMap::new(),
            };
            persist_cap_sids(&path, &caps)?;
            return Ok(caps);
        }
    }
    let caps = CapSids {
        workspace: random_cap_sid_string(),
        readonly: random_cap_sid_string(),
        workspace_by_cwd: HashMap::new(),
    };
    persist_cap_sids(&path, &caps)?;
    Ok(caps)
}

pub fn workspace_cap_sid_for_cwd(managed_root: &Path, cwd: &Path) -> Result<String, String> {
    let path = cap_sid_path(managed_root);
    let mut caps = load_or_create_cap_sids(managed_root)?;
    let canonical = v2_paths::canonicalize_existing_or_parent(cwd)?;
    let key = v2_paths::canonical_path_key(canonical.canonical());
    if let Some(sid) = caps.workspace_by_cwd.get(&key) {
        return Ok(sid.clone());
    }
    let sid = random_cap_sid_string();
    caps.workspace_by_cwd.insert(key, sid.clone());
    persist_cap_sids(&path, &caps)?;
    Ok(sid)
}

fn persist_cap_sids(path: &Path, caps: &CapSids) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create cap SID dir {} failed: {error}", parent.display()))?;
    }
    let json = serde_json::to_vec_pretty(caps)
        .map_err(|error| format!("serialize cap SID file failed: {error}"))?;
    let temp_path = path.with_file_name(format!(
        ".{}.{}.tmp",
        path.file_name()
            .map(|name| name.to_string_lossy())
            .unwrap_or_else(|| "cap_sid".into()),
        std::process::id(),
    ));
    fs::write(&temp_path, json).map_err(|error| {
        format!(
            "write temp cap SID file {} failed: {error}",
            temp_path.display()
        )
    })?;
    replace_file(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        format!(
            "replace cap SID file {} with {} failed: {error}",
            path.display(),
            temp_path.display(),
        )
    })
}

impl CapSids {
    fn has_valid_sids(&self) -> bool {
        is_valid_cap_sid_string(&self.workspace)
            && is_valid_cap_sid_string(&self.readonly)
            && self
                .workspace_by_cwd
                .values()
                .all(|sid| is_valid_cap_sid_string(sid))
    }
}

fn is_valid_cap_sid_string(value: &str) -> bool {
    let Some(rest) = value.strip_prefix("S-1-5-21-") else {
        return false;
    };
    let parts = rest.split('-').collect::<Vec<_>>();
    parts.len() == 4
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.parse::<u32>().is_ok())
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source_w = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination_w = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let ok = unsafe {
        MoveFileExW(
            source_w.as_ptr(),
            destination_w.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

fn random_cap_sid_string() -> String {
    let mut rng = rand::thread_rng();
    format!(
        "S-1-5-21-{}-{}-{}-{}",
        rng.next_u32() | 1,
        rng.next_u32() | 1,
        rng.next_u32() | 1,
        rng.next_u32() | 1,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cap_sid_persistence_round_trips() {
        let root =
            std::env::temp_dir().join(format!("officeagent-cap-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let first = load_or_create_cap_sids(&root).unwrap();
        let second = load_or_create_cap_sids(&root).unwrap();
        assert_eq!(first, second);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn legacy_plain_cap_sid_file_migrates() {
        let root = std::env::temp_dir().join(format!(
            "officeagent-cap-legacy-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(constants::sandbox_dir(&root)).unwrap();
        let legacy_sid = "S-1-5-21-1-3-5-7";
        std::fs::write(cap_sid_path(&root), legacy_sid).unwrap();
        let caps = load_or_create_cap_sids(&root).unwrap();
        assert_eq!(caps.workspace, legacy_sid);
        assert!(is_valid_cap_sid_string(&caps.readonly));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn invalid_cap_sid_file_is_repaired_instead_of_wrapped() {
        let root = std::env::temp_dir().join(format!(
            "officeagent-cap-invalid-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(constants::sandbox_dir(&root)).unwrap();
        std::fs::write(
            cap_sid_path(&root),
            r#"{"workspace":"not-a-sid","readonly":"also-not-a-sid","workspaceByCwd":{}}"#,
        )
        .unwrap();
        let caps = load_or_create_cap_sids(&root).unwrap();
        assert!(caps.has_valid_sids());
        assert_ne!(caps.workspace, "not-a-sid");
        let _ = std::fs::remove_dir_all(&root);
    }
}
