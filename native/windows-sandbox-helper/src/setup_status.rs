use crate::constants;
use crate::protocol::CheckSandboxSetupResult;
use crate::setup::{SandboxUsersFile, SetupMarker};
use crate::v2_paths;
use std::fs;
use std::path::{Path, PathBuf};

pub fn check_setup(managed_root: PathBuf) -> CheckSandboxSetupResult {
    match check_setup_inner(managed_root) {
        Ok(mut result) => {
            result.ready = result.issues.is_empty();
            if result.ready {
                result.status = "ready".to_string();
            }
            result
        }
        Err(error) => CheckSandboxSetupResult {
            status: "error".to_string(),
            ready: false,
            username: constants::SANDBOX_USERNAME.to_string(),
            group_name: constants::SANDBOX_USERS_GROUP.to_string(),
            managed_root: None,
            marker_version: None,
            secrets_version: None,
            marker_present: false,
            secrets_present: false,
            password_decrypts: false,
            credential_logon_works: false,
            secondary_logon_service_running: false,
            capability_sids_present: false,
            sandbox_user_exists: false,
            network_restricted: false,
            issues: vec![error],
        },
    }
}

fn check_setup_inner(managed_root: PathBuf) -> Result<CheckSandboxSetupResult, String> {
    let managed_root = v2_paths::canonicalize_existing_or_parent(&managed_root)?;
    let mut result = CheckSandboxSetupResult {
        status: "setup-required".to_string(),
        ready: false,
        username: constants::SANDBOX_USERNAME.to_string(),
        group_name: constants::SANDBOX_USERS_GROUP.to_string(),
        managed_root: Some(managed_root.canonical().to_path_buf()),
        marker_version: None,
        secrets_version: None,
        marker_present: false,
        secrets_present: false,
        password_decrypts: false,
        credential_logon_works: false,
        secondary_logon_service_running: false,
        capability_sids_present: false,
        sandbox_user_exists: false,
        network_restricted: false,
        issues: Vec::new(),
    };

    validate_managed_root_is_agent_data(managed_root.canonical(), &mut result);
    check_marker(managed_root.canonical(), &mut result);
    check_secrets(managed_root.canonical(), &mut result);
    check_capability_sids(managed_root.canonical(), &mut result);
    check_secondary_logon_service(&mut result);
    check_account(&mut result);

    if !result.issues.is_empty() {
        result.status =
            if result.marker_present || result.secrets_present || result.sandbox_user_exists {
                "repair-required".to_string()
            } else {
                "setup-required".to_string()
            };
    }

    Ok(result)
}

fn validate_managed_root_is_agent_data(managed_root: &Path, result: &mut CheckSandboxSetupResult) {
    match v2_paths::expected_agent_data_root().and_then(v2_paths::canonicalize_existing_or_parent) {
        Ok(expected) => {
            if !same_path(managed_root, expected.canonical()) {
                result.issues.push(format!(
                    "managedRoot is not %LOCALAPPDATA%\\OfficeAgent\\AgentData: managedRoot={}, expected={}",
                    managed_root.display(),
                    expected.canonical().display()
                ));
            }
        }
        Err(error) => result.issues.push(error),
    }
}

fn check_marker(managed_root: &Path, result: &mut CheckSandboxSetupResult) {
    let path = constants::setup_marker_path(managed_root);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            result
                .issues
                .push(format!("setup marker is missing: {}", path.display()));
            return;
        }
        Err(error) => {
            result.issues.push(format!(
                "read setup marker {} failed: {error}",
                path.display()
            ));
            return;
        }
    };
    result.marker_present = true;
    match serde_json::from_slice::<SetupMarker>(&bytes) {
        Ok(marker) => {
            result.marker_version = Some(marker.version);
            result.network_restricted = marker.network_restricted;
            if !marker.version_matches() {
                result.issues.push(format!(
                    "setup marker version {} does not match expected {}",
                    marker.version,
                    constants::SETUP_VERSION
                ));
            }
            if marker.username != constants::SANDBOX_USERNAME {
                result.issues.push(format!(
                    "setup marker username {} does not match expected {}",
                    marker.username,
                    constants::SANDBOX_USERNAME
                ));
            }
            if marker.group_name != constants::SANDBOX_USERS_GROUP {
                result.issues.push(format!(
                    "setup marker groupName {} does not match expected {}",
                    marker.group_name,
                    constants::SANDBOX_USERS_GROUP
                ));
            }
            if marker.network_restricted {
                result
                    .issues
                    .push("setup marker unexpectedly claims networkRestricted=true".to_string());
            }
        }
        Err(error) => result.issues.push(format!(
            "parse setup marker {} failed: {error}",
            path.display()
        )),
    }
}

fn check_secrets(managed_root: &Path, result: &mut CheckSandboxSetupResult) {
    let path = constants::sandbox_users_path(managed_root);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            result.issues.push(format!(
                "sandbox users secrets file is missing: {}",
                path.display()
            ));
            return;
        }
        Err(error) => {
            result.issues.push(format!(
                "read sandbox users secrets file {} failed: {error}",
                path.display()
            ));
            return;
        }
    };
    result.secrets_present = true;
    match serde_json::from_slice::<SandboxUsersFile>(&bytes) {
        Ok(users) => {
            result.secrets_version = Some(users.version);
            if !users.version_matches() {
                result.issues.push(format!(
                    "sandbox users secrets version {} does not match expected {}",
                    users.version,
                    constants::SETUP_VERSION
                ));
            }
            if users.user.username != constants::SANDBOX_USERNAME {
                result.issues.push(format!(
                    "sandbox users username {} does not match expected {}",
                    users.user.username,
                    constants::SANDBOX_USERNAME
                ));
            }
            match crate::sandbox_credentials::load_sandbox_credentials(managed_root) {
                Ok(credentials) => {
                    result.password_decrypts = true;
                    match crate::sandbox_credentials::verify_sandbox_logon(&credentials) {
                        Ok(()) => result.credential_logon_works = true,
                        Err(error) => result.issues.push(format!(
                            "sandbox credential logon verification failed: {error}"
                        )),
                    }
                }
                Err(error) => {
                    result.password_decrypts = false;
                    result.issues.push(error);
                    result
                        .issues
                        .push("sandbox password did not decrypt to a non-empty string".to_string());
                }
            }
        }
        Err(error) => result.issues.push(format!(
            "parse sandbox users secrets file {} failed: {error}",
            path.display()
        )),
    }
}

fn check_capability_sids(managed_root: &Path, result: &mut CheckSandboxSetupResult) {
    match crate::cap::load_or_create_cap_sids(managed_root) {
        Ok(caps) => {
            result.capability_sids_present = true;
            if caps.workspace.trim().is_empty() || caps.readonly.trim().is_empty() {
                result
                    .issues
                    .push("capability SID file contains empty SID values".to_string());
            }
        }
        Err(error) => result
            .issues
            .push(format!("capability SID load/create failed: {error}")),
    }
}

#[cfg(windows)]
fn check_secondary_logon_service(result: &mut CheckSandboxSetupResult) {
    // Treat Secondary Logon as runtime state, not setup readiness. Windows commonly keeps
    // seclogon as Manual/Stopped, and CreateProcessWithLogonW can start/use it on demand.
    // Failing readiness here incorrectly forces users through sandbox setup again before we
    // even try the Codex-style launch path.
    if let Ok(running) = crate::windows_services::secondary_logon_running() {
        result.secondary_logon_service_running = running;
    }
}

#[cfg(not(windows))]
fn check_secondary_logon_service(_result: &mut CheckSandboxSetupResult) {}

#[cfg(windows)]
fn check_account(result: &mut CheckSandboxSetupResult) {
    match crate::windows_accounts::sandbox_user_exists() {
        Ok(exists) => {
            result.sandbox_user_exists = exists;
            if !exists {
                result
                    .issues
                    .push("sandbox Windows user does not exist".to_string());
            }
        }
        Err(error) => result
            .issues
            .push(format!("sandbox Windows user lookup failed: {error}")),
    }
}

#[cfg(not(windows))]
fn check_account(result: &mut CheckSandboxSetupResult) {
    result
        .issues
        .push("sandbox Windows user lookup is only supported on Windows".to_string());
}

fn same_path(left: &Path, right: &Path) -> bool {
    v2_paths::canonical_path_key(left) == v2_paths::canonical_path_key(right)
}
