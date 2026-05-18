use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use officeagent_windows_sandbox_helper::constants;
use officeagent_windows_sandbox_helper::setup::{
    SandboxUserRecord, SandboxUsersFile, SetupAction, SetupMarker, SetupPayload,
};
use officeagent_windows_sandbox_helper::setup_error::{
    self, failure, SetupErrorCode, SetupFailure, SetupResult,
};
use officeagent_windows_sandbox_helper::v2_paths;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

fn log_step(message: impl AsRef<str>) {
    println!("{}", message.as_ref());
    let _ = io::stdout().flush();
}

fn main() {
    let exit_code = match run() {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("{error}");
            1
        }
    };
    std::process::exit(exit_code);
}

fn run() -> SetupResult<()> {
    log_step("OfficeAgent Windows sandbox setup helper starting...");
    let invocation = parse_args(std::env::args().skip(1).collect())?;
    log_step(format!("Action: {:?}", invocation.action));
    log_step(format!("Managed root: {}", invocation.payload.managed_root.display()));
    v2_paths::validate_setup_payload(&invocation.payload).map_err(|message| {
        SetupFailure::new(SetupErrorCode::HelperPayloadValidationFailed, message)
    })?;

    let result = match invocation.action {
        SetupAction::Setup => run_setup(&invocation.payload),
        SetupAction::Reset => run_reset(&invocation.payload),
    };

    match result {
        Ok(()) => {
            let _ = setup_error::clear_setup_error_report(&invocation.payload.managed_root);
            log_step("OfficeAgent Windows sandbox setup helper finished successfully.");
            Ok(())
        }
        Err(error) => {
            let _ = setup_error::write_setup_error_report(
                &invocation.payload.managed_root,
                &error.report(),
            );
            Err(error)
        }
    }
}

struct Invocation {
    action: SetupAction,
    payload: SetupPayload,
}

fn parse_args(args: Vec<String>) -> SetupResult<Invocation> {
    if args.is_empty() {
        return failure(
            SetupErrorCode::HelperRequestArgsFailed,
            "expected: setup|reset --payload <payload.json>",
        );
    }
    let action = match args[0].as_str() {
        "setup" => SetupAction::Setup,
        "reset" => SetupAction::Reset,
        other => {
            return failure(
                SetupErrorCode::HelperRequestArgsFailed,
                format!("unsupported action {other}; expected setup or reset"),
            )
        }
    };

    let mut payload_path = None::<PathBuf>;
    let mut index = 1usize;
    while index < args.len() {
        match args[index].as_str() {
            "--payload" => {
                let Some(value) = args.get(index + 1) else {
                    return failure(
                        SetupErrorCode::HelperRequestArgsFailed,
                        "--payload requires a path",
                    );
                };
                payload_path = Some(PathBuf::from(value));
                index += 2;
            }
            other => {
                return failure(
                    SetupErrorCode::HelperRequestArgsFailed,
                    format!("unsupported argument {other}"),
                )
            }
        }
    }
    let payload_path = payload_path.ok_or_else(|| {
        SetupFailure::new(
            SetupErrorCode::HelperRequestArgsFailed,
            "--payload <payload.json> is required",
        )
    })?;
    let bytes = fs::read(&payload_path).map_err(|error| {
        SetupFailure::new(
            SetupErrorCode::HelperRequestArgsFailed,
            format!("read payload {} failed: {error}", payload_path.display()),
        )
    })?;
    let payload = serde_json::from_slice::<SetupPayload>(&bytes).map_err(|error| {
        SetupFailure::new(
            SetupErrorCode::HelperRequestArgsFailed,
            format!("parse payload {} failed: {error}", payload_path.display()),
        )
    })?;
    Ok(Invocation { action, payload })
}

#[cfg(windows)]
fn run_setup(payload: &SetupPayload) -> SetupResult<()> {
    use officeagent_windows_sandbox_helper::dpapi;
    use officeagent_windows_sandbox_helper::windows_accounts;
    use officeagent_windows_sandbox_helper::windows_acl;
    use officeagent_windows_sandbox_helper::windows_hide_users;

    log_step("Preparing sandbox directories...");
    create_setup_dirs(&payload.managed_root)?;
    log_step("Loading capability SIDs...");
    officeagent_windows_sandbox_helper::cap::load_or_create_cap_sids(&payload.managed_root)
        .map_err(|error| SetupFailure::new(SetupErrorCode::HelperCapabilitySidFailed, error))?;
    log_step("Locking down sandbox directories...");
    windows_acl::lock_down_setup_dirs(&payload.managed_root, &payload.real_user_sid)
        .map_err(|error| SetupFailure::new(SetupErrorCode::HelperSandboxLockFailed, error))?;
    log_step("Ensuring sandbox user group exists...");
    windows_accounts::ensure_sandbox_group()
        .map_err(|error| SetupFailure::new(SetupErrorCode::HelperUsersGroupCreateFailed, error))?;
    log_step("Granting sandbox read roots...");
    grant_read_roots(payload)?;
    log_step("Checking Secondary Logon service...");
    officeagent_windows_sandbox_helper::windows_services::ensure_secondary_logon_running()
        .map_err(|error| {
            SetupFailure::new(SetupErrorCode::HelperSecondaryLogonServiceFailed, error)
        })?;
    log_step("Granting runner directory read/execute permission...");
    grant_runner_directory_read_execute()?;

    log_step("Creating or updating sandbox account...");
    let password = load_existing_password(&payload.managed_root)
        .unwrap_or_else(|| windows_accounts::random_password());
    windows_accounts::ensure_sandbox_user(&password).map_err(|error| {
        SetupFailure::new(SetupErrorCode::HelperUserCreateOrUpdateFailed, error)
    })?;
    log_step("Re-applying sandbox directory ACLs...");
    windows_acl::lock_down_setup_dirs(&payload.managed_root, &payload.real_user_sid)
        .map_err(|error| SetupFailure::new(SetupErrorCode::HelperSandboxLockFailed, error))?;

    log_step("Protecting sandbox credentials with DPAPI...");
    let protected = dpapi::protect_machine(password.as_bytes())
        .map_err(|error| SetupFailure::new(SetupErrorCode::HelperDpapiProtectFailed, error))?;
    log_step("Writing sandbox secrets and setup marker...");
    write_secrets(&payload.managed_root, BASE64.encode(protected))?;
    write_marker(&payload.managed_root, payload)?;

    log_step("Hiding sandbox account from Windows sign-in UI...");
    windows_hide_users::hide_user_in_winlogon(constants::SANDBOX_USERNAME)
        .map_err(|error| SetupFailure::new(SetupErrorCode::HelperHideUserFailed, error))?;

    Ok(())
}

#[cfg(not(windows))]
fn run_setup(_payload: &SetupPayload) -> SetupResult<()> {
    failure(
        SetupErrorCode::HelperUnknownError,
        "Windows sandbox setup can only run on Windows",
    )
}

#[cfg(windows)]
fn run_reset(payload: &SetupPayload) -> SetupResult<()> {
    use officeagent_windows_sandbox_helper::windows_accounts;
    use officeagent_windows_sandbox_helper::windows_hide_users;

    log_step("Removing sandbox account from Windows sign-in UI hide list...");
    let hidden_result = windows_hide_users::remove_hidden_user_value(constants::SANDBOX_USERNAME);
    log_step("Resetting sandbox Windows accounts...");
    let account_result = windows_accounts::reset_sandbox_accounts();
    log_step("Removing sandbox setup files...");
    remove_setup_files(&payload.managed_root)?;

    hidden_result
        .map_err(|error| SetupFailure::new(SetupErrorCode::HelperHideUserFailed, error))?;
    account_result.map_err(|error| SetupFailure::new(SetupErrorCode::HelperResetFailed, error))?;
    Ok(())
}

#[cfg(not(windows))]
fn run_reset(_payload: &SetupPayload) -> SetupResult<()> {
    failure(
        SetupErrorCode::HelperUnknownError,
        "Windows sandbox reset can only run on Windows",
    )
}

#[cfg(windows)]
fn load_existing_password(managed_root: &Path) -> Option<String> {
    use officeagent_windows_sandbox_helper::dpapi;

    let bytes = fs::read(constants::sandbox_users_path(managed_root)).ok()?;
    let users = serde_json::from_slice::<SandboxUsersFile>(&bytes).ok()?;
    if !users.version_matches() || users.user.username != constants::SANDBOX_USERNAME {
        return None;
    }
    let blob = BASE64.decode(users.user.password).ok()?;
    let plaintext = dpapi::unprotect_machine(&blob).ok()?;
    String::from_utf8(plaintext).ok()
}

#[cfg(windows)]
fn grant_read_roots(payload: &SetupPayload) -> SetupResult<()> {
    for root in &payload.read_roots {
        if !root.exists() {
            continue;
        }
        officeagent_windows_sandbox_helper::windows_acl::grant_sandbox_group_read_execute(root)
            .map_err(|error| SetupFailure::new(SetupErrorCode::HelperSandboxLockFailed, error))?;
    }
    Ok(())
}

fn create_setup_dirs(managed_root: &Path) -> SetupResult<()> {
    for dir in [
        constants::sandbox_dir(managed_root),
        constants::sandbox_logs_dir(managed_root),
        constants::sandbox_requests_dir(managed_root),
        constants::sandbox_secrets_dir(managed_root),
    ] {
        fs::create_dir_all(&dir).map_err(|error| {
            SetupFailure::new(
                SetupErrorCode::HelperSandboxDirCreateFailed,
                format!("create {} failed: {error}", dir.display()),
            )
        })?;
    }
    Ok(())
}

#[cfg(windows)]
fn grant_runner_directory_read_execute() -> SetupResult<()> {
    let exe = std::env::current_exe().map_err(|error| {
        SetupFailure::new(
            SetupErrorCode::HelperSandboxLockFailed,
            format!("current_exe failed while granting runner dir access: {error}"),
        )
    })?;
    let dir = exe.parent().ok_or_else(|| {
        SetupFailure::new(
            SetupErrorCode::HelperSandboxLockFailed,
            format!("setup executable has no parent: {}", exe.display()),
        )
    })?;
    officeagent_windows_sandbox_helper::windows_acl::grant_sandbox_group_read_execute(dir)
        .map_err(|error| SetupFailure::new(SetupErrorCode::HelperSandboxLockFailed, error))
}

fn write_secrets(managed_root: &Path, protected_password: String) -> SetupResult<()> {
    let users = SandboxUsersFile {
        version: constants::SETUP_VERSION,
        user: SandboxUserRecord {
            username: constants::SANDBOX_USERNAME.to_string(),
            password: protected_password,
        },
    };
    let path = constants::sandbox_users_path(managed_root);
    let json = serde_json::to_vec_pretty(&users).map_err(|error| {
        SetupFailure::new(
            SetupErrorCode::HelperUsersFileWriteFailed,
            format!("serialize sandbox users failed: {error}"),
        )
    })?;
    fs::write(&path, json).map_err(|error| {
        SetupFailure::new(
            SetupErrorCode::HelperUsersFileWriteFailed,
            format!("write {} failed: {error}", path.display()),
        )
    })
}

fn write_marker(managed_root: &Path, payload: &SetupPayload) -> SetupResult<()> {
    let marker = SetupMarker::from_payload(payload);
    let path = constants::setup_marker_path(managed_root);
    let json = serde_json::to_vec_pretty(&marker).map_err(|error| {
        SetupFailure::new(
            SetupErrorCode::HelperSetupMarkerWriteFailed,
            format!("serialize setup marker failed: {error}"),
        )
    })?;
    fs::write(&path, json).map_err(|error| {
        SetupFailure::new(
            SetupErrorCode::HelperSetupMarkerWriteFailed,
            format!("write {} failed: {error}", path.display()),
        )
    })
}

fn remove_setup_files(managed_root: &Path) -> SetupResult<()> {
    remove_dir_all_if_exists(&constants::sandbox_secrets_dir(managed_root))?;
    remove_dir_all_if_exists(&constants::sandbox_dir(managed_root))?;
    Ok(())
}

fn remove_dir_all_if_exists(path: &Path) -> SetupResult<()> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => failure(
            SetupErrorCode::HelperResetFailed,
            format!("remove {} failed: {error}", path.display()),
        ),
    }
}
