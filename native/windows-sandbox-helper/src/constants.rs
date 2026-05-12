use std::path::{Path, PathBuf};

pub const SETUP_VERSION: u32 = 1;
pub const SANDBOX_USERNAME: &str = "OfficeAgentSandbox";
pub const SANDBOX_USERS_GROUP: &str = "OfficeAgentSandboxUsers";
pub const SANDBOX_USERS_GROUP_COMMENT: &str = "OfficeAgent sandbox internal group (managed)";
pub const HELPER_VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn officeagent_dir(managed_root: &Path) -> PathBuf {
    managed_root.join(".officeagent")
}

pub fn sandbox_dir(managed_root: &Path) -> PathBuf {
    officeagent_dir(managed_root).join("sandbox")
}

pub fn sandbox_logs_dir(managed_root: &Path) -> PathBuf {
    sandbox_dir(managed_root).join("logs")
}

pub fn sandbox_requests_dir(managed_root: &Path) -> PathBuf {
    sandbox_dir(managed_root).join("requests")
}

pub fn sandbox_secrets_dir(managed_root: &Path) -> PathBuf {
    officeagent_dir(managed_root).join("sandbox-secrets")
}

pub fn setup_marker_path(managed_root: &Path) -> PathBuf {
    sandbox_dir(managed_root).join("setup_marker.json")
}

pub fn setup_error_path(managed_root: &Path) -> PathBuf {
    sandbox_dir(managed_root).join("setup_error.json")
}

pub fn sandbox_users_path(managed_root: &Path) -> PathBuf {
    sandbox_secrets_dir(managed_root).join("sandbox_users.json")
}

pub fn project_state_root(managed_root: &Path) -> PathBuf {
    officeagent_dir(managed_root).join("project-state")
}

pub fn sessions_root(managed_root: &Path) -> PathBuf {
    officeagent_dir(managed_root).join("sessions")
}
