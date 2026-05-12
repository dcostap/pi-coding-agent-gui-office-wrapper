use crate::constants::{HELPER_VERSION, SANDBOX_USERNAME, SANDBOX_USERS_GROUP, SETUP_VERSION};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SetupAction {
    Setup,
    Reset,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupPayload {
    pub version: u32,
    pub real_user_name: String,
    pub real_user_sid: String,
    pub managed_root: PathBuf,
    #[serde(default)]
    pub project_root: Option<PathBuf>,
    #[serde(default)]
    pub project_state_dir: Option<PathBuf>,
    #[serde(default)]
    pub session_dir: Option<PathBuf>,
    #[serde(default)]
    pub read_roots: Vec<PathBuf>,
    #[serde(default)]
    pub write_roots: Vec<PathBuf>,
    #[serde(default)]
    pub helper_version: Option<String>,
}

impl SetupPayload {
    pub fn expected_version(&self) -> bool {
        self.version == SETUP_VERSION
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupMarker {
    pub version: u32,
    pub username: String,
    pub group_name: String,
    pub intended_real_user_name: String,
    pub intended_real_user_sid: String,
    pub created_at: String,
    pub helper_version: String,
    pub read_roots: Vec<PathBuf>,
    pub write_roots: Vec<PathBuf>,
    pub network_restricted: bool,
}

impl SetupMarker {
    pub fn from_payload(payload: &SetupPayload) -> Self {
        Self {
            version: SETUP_VERSION,
            username: SANDBOX_USERNAME.to_string(),
            group_name: SANDBOX_USERS_GROUP.to_string(),
            intended_real_user_name: payload.real_user_name.clone(),
            intended_real_user_sid: payload.real_user_sid.clone(),
            created_at: chrono::Utc::now().to_rfc3339(),
            helper_version: payload
                .helper_version
                .clone()
                .unwrap_or_else(|| HELPER_VERSION.to_string()),
            read_roots: payload.read_roots.clone(),
            write_roots: payload.write_roots.clone(),
            network_restricted: false,
        }
    }

    pub fn version_matches(&self) -> bool {
        self.version == SETUP_VERSION
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxUserRecord {
    pub username: String,
    /// DPAPI machine-scope encrypted password blob, base64 encoded.
    pub password: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxUsersFile {
    pub version: u32,
    pub user: SandboxUserRecord,
}

impl SandboxUsersFile {
    pub fn version_matches(&self) -> bool {
        self.version == SETUP_VERSION
    }
}
