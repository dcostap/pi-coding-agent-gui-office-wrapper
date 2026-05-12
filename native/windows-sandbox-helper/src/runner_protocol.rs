use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerRequest {
    pub executable: PathBuf,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: PathBuf,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub stdout_path: Option<PathBuf>,
    #[serde(default)]
    pub stderr_path: Option<PathBuf>,
    #[serde(default)]
    pub stdout_pipe: Option<String>,
    #[serde(default)]
    pub stderr_pipe: Option<String>,
    #[serde(default)]
    pub stdin_pipe: Option<String>,
    #[serde(default)]
    pub capability_sids: Vec<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}
