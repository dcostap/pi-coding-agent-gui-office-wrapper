use crate::diagnostics::ErrorDiagnostics;
use crate::setup::SetupAction;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
#[serde(tag = "kind")]
pub enum HelperRequest {
    #[serde(rename = "selfTest")]
    SelfTest {
        #[serde(rename = "requestId")]
        request_id: Option<String>,
    },
    #[serde(rename = "launch")]
    Launch(LaunchRequest),
    #[serde(rename = "fileWrite")]
    FileWrite(FileWriteRequest),
    #[serde(rename = "mkdir")]
    Mkdir(MkdirRequest),
    #[serde(rename = "prepareSandboxSetup")]
    PrepareSandboxSetup(PrepareSandboxSetupRequest),
    #[serde(rename = "checkSandboxSetup")]
    CheckSandboxSetup(CheckSandboxSetupRequest),
    #[serde(rename = "sandboxRunnerSelfTest")]
    SandboxRunnerSelfTest(SandboxRunnerSelfTestRequest),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    pub request_id: Option<String>,
    pub executable: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: String,
    pub managed_root: String,
    pub session_dir: String,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub writable_paths: Vec<String>,
    pub stdout_path: Option<String>,
    pub stderr_path: Option<String>,
    #[serde(default)]
    pub stdin_content: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWriteRequest {
    pub request_id: Option<String>,
    pub managed_root: String,
    pub path: String,
    pub content: String,
    #[serde(default)]
    pub create_parent_dirs: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MkdirRequest {
    pub request_id: Option<String>,
    pub managed_root: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareSandboxSetupRequest {
    pub request_id: Option<String>,
    #[serde(default = "default_setup_action")]
    pub action: SetupAction,
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
}

fn default_setup_action() -> SetupAction {
    SetupAction::Setup
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckSandboxSetupRequest {
    pub request_id: Option<String>,
    pub managed_root: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxRunnerSelfTestRequest {
    pub request_id: Option<String>,
    pub managed_root: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<HelperResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<HelperError>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum HelperResult {
    Launch(LaunchResult),
    PrepareSandboxSetup(PrepareSandboxSetupResult),
    CheckSandboxSetup(CheckSandboxSetupResult),
    SandboxRunnerSelfTest(SandboxRunnerSelfTestResult),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    pub pid: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareSandboxSetupResult {
    pub status: String,
    pub action: SetupAction,
    pub requires_elevation: bool,
    pub setup_exe_path: PathBuf,
    pub payload_path: PathBuf,
    pub setup_args: Vec<String>,
    pub setup_command: String,
    pub username: String,
    pub group_name: String,
    pub intended_real_user_name: String,
    pub intended_real_user_sid: String,
    pub network_restricted: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckSandboxSetupResult {
    pub status: String,
    pub ready: bool,
    pub username: String,
    pub group_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub managed_root: Option<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub marker_version: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secrets_version: Option<u32>,
    pub marker_present: bool,
    pub secrets_present: bool,
    pub password_decrypts: bool,
    pub credential_logon_works: bool,
    pub secondary_logon_service_running: bool,
    pub capability_sids_present: bool,
    pub sandbox_user_exists: bool,
    pub network_restricted: bool,
    pub issues: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxRunnerSelfTestResult {
    pub status: String,
    pub launched: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runner_exe_path: Option<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issue: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issue_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary_logon_likely_blocked: Option<bool>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub windows_error_codes: BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary_logon_likely_blocked: Option<bool>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub windows_error_codes: BTreeMap<String, String>,
}

impl HelperResponse {
    #[allow(dead_code)]
    pub fn ok(request_id: Option<String>, result: LaunchResult) -> Self {
        Self {
            ok: true,
            request_id,
            result: Some(HelperResult::Launch(result)),
            error: None,
        }
    }

    pub fn self_test(request_id: Option<String>) -> Self {
        Self {
            ok: true,
            request_id,
            result: None,
            error: None,
        }
    }

    pub fn setup_handoff(request_id: Option<String>, result: PrepareSandboxSetupResult) -> Self {
        Self {
            ok: true,
            request_id,
            result: Some(HelperResult::PrepareSandboxSetup(result)),
            error: None,
        }
    }

    pub fn setup_status(request_id: Option<String>, result: CheckSandboxSetupResult) -> Self {
        Self {
            ok: true,
            request_id,
            result: Some(HelperResult::CheckSandboxSetup(result)),
            error: None,
        }
    }

    pub fn runner_self_test(
        request_id: Option<String>,
        result: SandboxRunnerSelfTestResult,
    ) -> Self {
        Self {
            ok: true,
            request_id,
            result: Some(HelperResult::SandboxRunnerSelfTest(result)),
            error: None,
        }
    }

    pub fn err(
        request_id: Option<String>,
        code: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            ok: false,
            request_id,
            result: None,
            error: Some(HelperError {
                code: code.into(),
                message: message.into(),
                diagnostic_code: None,
                secondary_logon_likely_blocked: None,
                windows_error_codes: BTreeMap::new(),
            }),
        }
    }

    pub fn err_with_diagnostics(
        request_id: Option<String>,
        fallback_code: impl Into<String>,
        message: impl Into<String>,
        diagnostics: ErrorDiagnostics,
    ) -> Self {
        let fallback_code = fallback_code.into();
        let diagnostic_code = diagnostics.diagnostic_code;
        let code = if diagnostic_code.trim().is_empty() {
            fallback_code
        } else {
            diagnostic_code.clone()
        };
        Self {
            ok: false,
            request_id,
            result: None,
            error: Some(HelperError {
                code,
                message: message.into(),
                diagnostic_code: Some(diagnostic_code),
                secondary_logon_likely_blocked: Some(diagnostics.secondary_logon_likely_blocked),
                windows_error_codes: diagnostics.windows_error_codes,
            }),
        }
    }
}
