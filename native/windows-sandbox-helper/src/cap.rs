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
            return Ok(caps);
        }
        let legacy = text.trim();
        if !legacy.is_empty() {
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
    fs::write(path, json)
        .map_err(|error| format!("write cap SID file {} failed: {error}", path.display()))
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
}
