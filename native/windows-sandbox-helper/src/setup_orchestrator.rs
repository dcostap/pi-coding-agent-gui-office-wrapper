use crate::constants;
use crate::protocol::{PrepareSandboxSetupRequest, PrepareSandboxSetupResult};
use crate::setup::{SetupAction, SetupPayload};
use crate::v2_paths;
use std::fs;
use std::path::{Path, PathBuf};

pub fn prepare_setup_handoff(
    request: PrepareSandboxSetupRequest,
) -> Result<PrepareSandboxSetupResult, String> {
    let managed_root = v2_paths::canonicalize_existing_or_parent(&request.managed_root)?;
    let identity = current_user_identity()?;
    let read_roots = if request.action == SetupAction::Setup && request.read_roots.is_empty() {
        v2_paths::standard_user_read_roots()?
    } else {
        request.read_roots
    };
    let payload = SetupPayload {
        version: constants::SETUP_VERSION,
        real_user_name: identity.name,
        real_user_sid: identity.sid,
        managed_root: managed_root.canonical().to_path_buf(),
        project_root: request.project_root,
        project_state_dir: request.project_state_dir,
        session_dir: request.session_dir,
        read_roots,
        write_roots: request.write_roots,
        helper_version: Some(constants::HELPER_VERSION.to_string()),
    };
    v2_paths::validate_setup_payload(&payload)?;

    let payload_path = write_handoff_payload(request.action, &payload)?;
    let setup_exe = setup_exe_path()?;
    if !setup_exe.exists() {
        return Err(format!(
            "setup helper executable is missing: {}",
            setup_exe.display()
        ));
    }
    let action = match request.action {
        SetupAction::Setup => "setup",
        SetupAction::Reset => "reset",
    };
    let setup_args = vec![
        action.to_string(),
        "--payload".to_string(),
        payload_path.to_string_lossy().to_string(),
    ];
    let setup_command = format_command(&setup_exe, &setup_args);

    Ok(PrepareSandboxSetupResult {
        status: "uac-handoff-ready".to_string(),
        action: request.action,
        requires_elevation: true,
        setup_exe_path: setup_exe,
        payload_path,
        setup_args,
        setup_command,
        username: constants::SANDBOX_USERNAME.to_string(),
        group_name: constants::SANDBOX_USERS_GROUP.to_string(),
        intended_real_user_name: payload.real_user_name,
        intended_real_user_sid: payload.real_user_sid,
        network_restricted: false,
    })
}

fn write_handoff_payload(action: SetupAction, payload: &SetupPayload) -> Result<PathBuf, String> {
    let requests_dir = constants::sandbox_requests_dir(&payload.managed_root);
    fs::create_dir_all(&requests_dir).map_err(|error| {
        format!(
            "failed to create setup handoff requests dir {}: {error}",
            requests_dir.display()
        )
    })?;
    let filename = format!(
        "{}_setup_payload_{}_{}.json",
        match action {
            SetupAction::Setup => "setup",
            SetupAction::Reset => "reset",
        },
        std::process::id(),
        chrono::Utc::now().timestamp_millis()
    );
    let payload_path = requests_dir.join(filename);
    let json = serde_json::to_vec_pretty(payload)
        .map_err(|error| format!("failed to serialize setup payload: {error}"))?;
    fs::write(&payload_path, json).map_err(|error| {
        format!(
            "failed to write setup payload {}: {error}",
            payload_path.display()
        )
    })?;
    Ok(payload_path)
}

fn setup_exe_path() -> Result<PathBuf, String> {
    let current =
        std::env::current_exe().map_err(|error| format!("current_exe failed: {error}"))?;
    let dir = current
        .parent()
        .ok_or_else(|| format!("helper executable has no parent: {}", current.display()))?;
    let filename = if cfg!(windows) {
        "office-agent-windows-sandbox-setup.exe"
    } else {
        "office-agent-windows-sandbox-setup"
    };
    Ok(dir.join(filename))
}

fn format_command(exe: &Path, args: &[String]) -> String {
    std::iter::once(exe.to_string_lossy().to_string())
        .chain(args.iter().cloned())
        .map(|part| quote_arg(&part))
        .collect::<Vec<_>>()
        .join(" ")
}

fn quote_arg(arg: &str) -> String {
    if arg.is_empty() {
        return "\"\"".to_string();
    }
    if !arg.chars().any(|ch| ch.is_whitespace() || ch == '"') {
        return arg.to_string();
    }
    let mut out = String::from("\"");
    let mut backslashes = 0;
    for ch in arg.chars() {
        match ch {
            '\\' => backslashes += 1,
            '"' => {
                out.push_str(&"\\".repeat(backslashes * 2 + 1));
                out.push('"');
                backslashes = 0;
            }
            _ => {
                out.push_str(&"\\".repeat(backslashes));
                backslashes = 0;
                out.push(ch);
            }
        }
    }
    out.push_str(&"\\".repeat(backslashes * 2));
    out.push('"');
    out
}

struct UserIdentity {
    name: String,
    sid: String,
}

#[cfg(windows)]
fn current_user_identity() -> Result<UserIdentity, String> {
    let identity = crate::windows_identity::current_user_identity()?;
    Ok(UserIdentity {
        name: identity.name,
        sid: identity.sid,
    })
}

#[cfg(not(windows))]
fn current_user_identity() -> Result<UserIdentity, String> {
    Err("Windows sandbox setup handoff can only be prepared on Windows".to_string())
}
