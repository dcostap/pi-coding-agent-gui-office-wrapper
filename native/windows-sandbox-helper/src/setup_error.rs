use crate::constants;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::ErrorKind;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SetupErrorCode {
    HelperRequestArgsFailed,
    HelperPayloadValidationFailed,
    HelperSandboxDirCreateFailed,
    HelperLogFailed,
    HelperUsersGroupCreateFailed,
    HelperUserCreateOrUpdateFailed,
    HelperUserRemoveFailed,
    HelperGroupRemoveFailed,
    HelperDpapiProtectFailed,
    HelperDpapiUnprotectFailed,
    HelperUsersFileWriteFailed,
    HelperSetupMarkerWriteFailed,
    HelperHideUserFailed,
    HelperSandboxLockFailed,
    HelperCapabilitySidFailed,
    HelperSecondaryLogonServiceFailed,
    HelperResetFailed,
    HelperUnknownError,
}

impl SetupErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::HelperRequestArgsFailed => "helper_request_args_failed",
            Self::HelperPayloadValidationFailed => "helper_payload_validation_failed",
            Self::HelperSandboxDirCreateFailed => "helper_sandbox_dir_create_failed",
            Self::HelperLogFailed => "helper_log_failed",
            Self::HelperUsersGroupCreateFailed => "helper_users_group_create_failed",
            Self::HelperUserCreateOrUpdateFailed => "helper_user_create_or_update_failed",
            Self::HelperUserRemoveFailed => "helper_user_remove_failed",
            Self::HelperGroupRemoveFailed => "helper_group_remove_failed",
            Self::HelperDpapiProtectFailed => "helper_dpapi_protect_failed",
            Self::HelperDpapiUnprotectFailed => "helper_dpapi_unprotect_failed",
            Self::HelperUsersFileWriteFailed => "helper_users_file_write_failed",
            Self::HelperSetupMarkerWriteFailed => "helper_setup_marker_write_failed",
            Self::HelperHideUserFailed => "helper_hide_user_failed",
            Self::HelperSandboxLockFailed => "helper_sandbox_lock_failed",
            Self::HelperCapabilitySidFailed => "helper_capability_sid_failed",
            Self::HelperSecondaryLogonServiceFailed => "helper_secondary_logon_service_failed",
            Self::HelperResetFailed => "helper_reset_failed",
            Self::HelperUnknownError => "helper_unknown_error",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupErrorReport {
    pub code: SetupErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, thiserror::Error)]
#[error("{}: {}", code.as_str(), message)]
pub struct SetupFailure {
    pub code: SetupErrorCode,
    pub message: String,
}

impl SetupFailure {
    pub fn new(code: SetupErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn report(&self) -> SetupErrorReport {
        SetupErrorReport {
            code: self.code,
            message: self.message.clone(),
        }
    }
}

pub type SetupResult<T> = Result<T, SetupFailure>;

pub fn failure<T>(code: SetupErrorCode, message: impl Into<String>) -> SetupResult<T> {
    Err(SetupFailure::new(code, message))
}

pub fn clear_setup_error_report(managed_root: &Path) -> SetupResult<()> {
    let path = constants::setup_error_path(managed_root);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => failure(
            SetupErrorCode::HelperResetFailed,
            format!("remove {} failed: {error}", path.display()),
        ),
    }
}

pub fn write_setup_error_report(managed_root: &Path, report: &SetupErrorReport) -> SetupResult<()> {
    let sandbox_dir = constants::sandbox_dir(managed_root);
    fs::create_dir_all(&sandbox_dir).map_err(|error| {
        SetupFailure::new(
            SetupErrorCode::HelperSandboxDirCreateFailed,
            format!("create {} failed: {error}", sandbox_dir.display()),
        )
    })?;
    let path = constants::setup_error_path(managed_root);
    let json = serde_json::to_vec_pretty(report).map_err(|error| {
        SetupFailure::new(
            SetupErrorCode::HelperUnknownError,
            format!("serialize setup error report failed: {error}"),
        )
    })?;
    fs::write(&path, json).map_err(|error| {
        SetupFailure::new(
            SetupErrorCode::HelperLogFailed,
            format!("write {} failed: {error}", path.display()),
        )
    })
}

pub fn read_setup_error_report(managed_root: &Path) -> SetupResult<Option<SetupErrorReport>> {
    let path = constants::setup_error_path(managed_root);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return failure(
                SetupErrorCode::HelperLogFailed,
                format!("read {} failed: {error}", path.display()),
            )
        }
    };
    serde_json::from_slice::<SetupErrorReport>(&bytes)
        .map(Some)
        .map_err(|error| {
            SetupFailure::new(
                SetupErrorCode::HelperLogFailed,
                format!("parse {} failed: {error}", path.display()),
            )
        })
}
