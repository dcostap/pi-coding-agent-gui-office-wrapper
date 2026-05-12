use crate::protocol::{FileWriteRequest, MkdirRequest};
use crate::v2_paths;
use std::path::{Path, PathBuf};

pub fn write_file(request: FileWriteRequest) -> Result<(), String> {
    let managed_root = v2_paths::canonicalize_existing_or_parent(&request.managed_root)?;
    let path = PathBuf::from(&request.path);
    v2_paths::validate_inside_managed("fileWrite.path", &path, managed_root.canonical())?;
    let cap_sids = capability_sids_for_path(managed_root.canonical(), &path)?;
    if request.create_parent_dirs {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "create parent directories for {} failed: {error}",
                    path.display()
                )
            })?;
            grant_sandbox_group_modify(parent)?;
            grant_capability_modify(parent, &cap_sids)?;
        }
    }
    std::fs::write(&path, request.content.as_bytes())
        .map_err(|error| format!("write file {} failed: {error}", path.display()))?;
    grant_sandbox_group_modify(&path)?;
    grant_capability_modify(&path, &cap_sids)?;
    Ok(())
}

pub fn mkdir(request: MkdirRequest) -> Result<(), String> {
    let managed_root = v2_paths::canonicalize_existing_or_parent(&request.managed_root)?;
    let path = PathBuf::from(&request.path);
    v2_paths::validate_inside_managed("mkdir.path", &path, managed_root.canonical())?;
    let cap_sids = capability_sids_for_path(managed_root.canonical(), &path)?;
    std::fs::create_dir_all(&path)
        .map_err(|error| format!("create directory {} failed: {error}", path.display()))?;
    grant_sandbox_group_modify(&path)?;
    grant_capability_modify(&path, &cap_sids)?;
    Ok(())
}

fn capability_sids_for_path(managed_root: &Path, path: &Path) -> Result<Vec<String>, String> {
    let caps = crate::cap::load_or_create_cap_sids(managed_root)?;
    let workspace_sid = crate::cap::workspace_cap_sid_for_cwd(managed_root, path)?;
    Ok(vec![caps.workspace, workspace_sid])
}

#[cfg(windows)]
fn grant_sandbox_group_modify(path: &Path) -> Result<(), String> {
    crate::windows_acl::grant_sandbox_group_modify(path)
}

#[cfg(windows)]
fn grant_capability_modify(path: &Path, cap_sids: &[String]) -> Result<(), String> {
    for sid in cap_sids {
        crate::windows_acl::grant_modify_to_sid_string(path, sid)?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn grant_sandbox_group_modify(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
fn grant_capability_modify(_path: &Path, _cap_sids: &[String]) -> Result<(), String> {
    Ok(())
}
