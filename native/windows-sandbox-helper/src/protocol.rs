use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

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
    pub read_only_paths: Vec<String>,
    #[serde(default)]
    pub optional_read_only_paths: Vec<String>,
    #[serde(default)]
    pub writable_paths: Vec<String>,
    pub stdout_path: Option<String>,
    pub stderr_path: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<LaunchResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<HelperError>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    pub pid: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperError {
    pub code: String,
    pub message: String,
}

impl HelperResponse {
    #[allow(dead_code)]
    pub fn ok(request_id: Option<String>, result: LaunchResult) -> Self {
        Self {
            ok: true,
            request_id,
            result: Some(result),
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

    pub fn err(request_id: Option<String>, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            ok: false,
            request_id,
            result: None,
            error: Some(HelperError {
                code: code.into(),
                message: message.into(),
            }),
        }
    }
}
