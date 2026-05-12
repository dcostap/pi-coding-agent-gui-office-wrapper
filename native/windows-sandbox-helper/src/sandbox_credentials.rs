use crate::constants;
use crate::setup::SandboxUsersFile;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct SandboxCredentials {
    pub username: String,
    pub domain: String,
    pub password: String,
}

pub fn load_sandbox_credentials(managed_root: &Path) -> Result<SandboxCredentials, String> {
    let path = constants::sandbox_users_path(managed_root);
    let bytes = fs::read(&path)
        .map_err(|error| format!("read sandbox users file {} failed: {error}", path.display()))?;
    let users = serde_json::from_slice::<SandboxUsersFile>(&bytes).map_err(|error| {
        format!(
            "parse sandbox users file {} failed: {error}",
            path.display()
        )
    })?;
    if !users.version_matches() {
        return Err(format!(
            "sandbox users version {} does not match expected {}",
            users.version,
            constants::SETUP_VERSION
        ));
    }
    if users.user.username != constants::SANDBOX_USERNAME {
        return Err(format!(
            "sandbox users username {} does not match expected {}",
            users.user.username,
            constants::SANDBOX_USERNAME
        ));
    }
    let blob = BASE64
        .decode(users.user.password)
        .map_err(|error| format!("base64 decode sandbox password failed: {error}"))?;
    let plaintext = unprotect_password_blob(&blob)?;
    let password = String::from_utf8(plaintext)
        .map_err(|error| format!("sandbox password plaintext is not valid UTF-8: {error}"))?;
    if password.is_empty() {
        return Err("sandbox password is empty after DPAPI decrypt".to_string());
    }
    Ok(SandboxCredentials {
        username: users.user.username,
        domain: ".".to_string(),
        password,
    })
}

#[cfg(windows)]
fn unprotect_password_blob(blob: &[u8]) -> Result<Vec<u8>, String> {
    crate::dpapi::unprotect_machine(blob)
}

#[cfg(not(windows))]
fn unprotect_password_blob(_blob: &[u8]) -> Result<Vec<u8>, String> {
    Err("DPAPI credential loading is only supported on Windows".to_string())
}

#[cfg(windows)]
pub fn verify_sandbox_logon(credentials: &SandboxCredentials) -> Result<(), String> {
    crate::windows_logon::verify_credentials(credentials)
}

#[cfg(not(windows))]
pub fn verify_sandbox_logon(_credentials: &SandboxCredentials) -> Result<(), String> {
    Err("sandbox credential logon verification is only supported on Windows".to_string())
}
