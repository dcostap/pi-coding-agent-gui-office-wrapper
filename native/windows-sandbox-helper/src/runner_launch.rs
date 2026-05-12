use crate::constants;
use crate::protocol::{HelperResponse, LaunchRequest, LaunchResult, SandboxRunnerSelfTestResult};
use crate::runner_protocol::RunnerRequest;
use crate::v2_paths;
use std::path::{Path, PathBuf};
use std::thread;

pub fn launch_v2(request: LaunchRequest) -> Result<HelperResponse, String> {
    let request_id = request.request_id.clone();
    let managed_root = v2_paths::canonicalize_existing_or_parent(&request.managed_root)?;
    let cwd = v2_paths::canonicalize_existing_or_parent(&request.cwd)?;
    v2_paths::validate_inside_managed("cwd", cwd.canonical(), managed_root.canonical())?;
    let session_dir = v2_paths::canonicalize_existing_or_parent(&request.session_dir)?;
    v2_paths::validate_inside_managed(
        "sessionDir",
        session_dir.canonical(),
        managed_root.canonical(),
    )?;

    let status = crate::setup_status::check_setup(managed_root.canonical().to_path_buf());
    if !status.ready {
        return Err(format!(
            "Windows sandbox v2 setup is not ready: {:?}",
            status.issues
        ));
    }
    let caps = crate::cap::load_or_create_cap_sids(managed_root.canonical())?;
    let workspace_cap_sid =
        crate::cap::workspace_cap_sid_for_cwd(managed_root.canonical(), cwd.canonical())?;
    let cap_sids = vec![caps.workspace, workspace_cap_sid];
    refresh_launch_acls(&request, managed_root.canonical(), &cap_sids)?;

    let runner_exe = runner_exe_path()?;
    if !runner_exe.exists() {
        return Err(format!(
            "command runner executable is missing: {}",
            runner_exe.display()
        ));
    }
    let stdout_pipe = create_output_pipe("stdout")?;
    let stderr_pipe = create_output_pipe("stderr")?;
    let stdin_pipe = match &request.stdin_content {
        Some(content) => Some(create_input_pipe("stdin", content.as_bytes().to_vec())?),
        None => None,
    };
    let stdout_pipe_name = stdout_pipe.name().to_string();
    let stderr_pipe_name = stderr_pipe.name().to_string();
    let stdin_pipe_name = stdin_pipe.as_ref().map(|pipe| pipe.name().to_string());
    let credentials =
        crate::sandbox_credentials::load_sandbox_credentials(managed_root.canonical())?;
    let request_file = write_runner_request(
        &request,
        managed_root.canonical(),
        Some(stdout_pipe_name),
        Some(stderr_pipe_name),
        stdin_pipe_name,
        cap_sids.clone(),
    )?;
    let args = vec![format!("--request-file={}", request_file.display())];
    let timeout_ms = request
        .timeout_ms
        .unwrap_or(300_000)
        .saturating_add(10_000)
        .min(u64::from(u32::MAX)) as u32;
    let process =
        spawn_runner_as_sandbox_user(&credentials, &runner_exe, &args, &system_temp_dir())?;
    let stdout_reader = stdout_pipe.into_reader_thread();
    let stderr_reader = stderr_pipe.into_reader_thread();
    let stdin_writer = stdin_pipe.map(|pipe| pipe.into_writer_thread());
    let process = wait_for_spawned_runner(process, timeout_ms)?;
    if let Some(stdin_writer) = stdin_writer {
        join_pipe_writer(stdin_writer)?;
    }
    let stdout = join_pipe_reader(stdout_reader)?;
    let stderr = join_pipe_reader(stderr_reader)?;
    Ok(HelperResponse::ok(
        request_id,
        LaunchResult {
            pid: process.pid,
            exit_code: Some(process.exit_code),
            stdout: Some(String::from_utf8_lossy(&stdout).to_string()),
            stderr: Some(String::from_utf8_lossy(&stderr).to_string()),
        },
    ))
}

pub fn runner_self_test(managed_root: PathBuf) -> SandboxRunnerSelfTestResult {
    match runner_self_test_inner(managed_root) {
        Ok(result) => result,
        Err(error) => SandboxRunnerSelfTestResult {
            status: "error".to_string(),
            launched: false,
            exit_code: None,
            runner_exe_path: None,
            issue: Some(error),
        },
    }
}

fn runner_self_test_inner(managed_root: PathBuf) -> Result<SandboxRunnerSelfTestResult, String> {
    let managed_root = v2_paths::canonicalize_existing_or_parent(managed_root)?;
    let credentials =
        crate::sandbox_credentials::load_sandbox_credentials(managed_root.canonical())?;
    let runner_exe = runner_exe_path()?;
    if !runner_exe.exists() {
        return Err(format!(
            "command runner executable is missing: {}",
            runner_exe.display()
        ));
    }
    let cwd = system_temp_dir();
    let exit_code = match run_runner_as_sandbox_user(
        &credentials,
        &runner_exe,
        &["--self-test".to_string()],
        &cwd,
        10_000,
    ) {
        Ok(exit_code) => exit_code,
        Err(runner_error) => {
            let cmd_exe = system_cmd_exe();
            let cmd_probe = run_runner_as_sandbox_user(
                &credentials,
                &cmd_exe,
                &["/d".to_string(), "/c".to_string(), "exit 0".to_string()],
                &cwd,
                10_000,
            );
            return Err(match cmd_probe {
                Ok(code) => format!(
                    "runner launch failed: {runner_error}; cmd.exe probe launched with exit {code}"
                ),
                Err(cmd_error) => format!(
                    "runner launch failed: {runner_error}; cmd.exe probe also failed: {cmd_error}"
                ),
            });
        }
    };
    Ok(SandboxRunnerSelfTestResult {
        status: if exit_code == 0 { "passed" } else { "failed" }.to_string(),
        launched: true,
        exit_code: Some(exit_code),
        runner_exe_path: Some(runner_exe),
        issue: if exit_code == 0 {
            None
        } else {
            Some(format!("command runner self-test exited with {exit_code}"))
        },
    })
}

fn system_root() -> PathBuf {
    std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
}

fn system_temp_dir() -> PathBuf {
    system_root().join("Temp")
}

fn system_cmd_exe() -> PathBuf {
    system_root().join("System32").join("cmd.exe")
}

fn write_runner_request(
    request: &LaunchRequest,
    managed_root: &Path,
    stdout_pipe: Option<String>,
    stderr_pipe: Option<String>,
    stdin_pipe: Option<String>,
    capability_sids: Vec<String>,
) -> Result<PathBuf, String> {
    let requests_dir = constants::sandbox_requests_dir(managed_root);
    std::fs::create_dir_all(&requests_dir).map_err(|error| {
        format!(
            "create runner requests dir {} failed: {error}",
            requests_dir.display()
        )
    })?;
    grant_sandbox_group_read(&requests_dir)?;
    let request_path = requests_dir.join(format!(
        "runner_request_{}_{}.json",
        std::process::id(),
        chrono::Utc::now().timestamp_millis()
    ));
    let runner_request = RunnerRequest {
        executable: PathBuf::from(&request.executable),
        args: request.args.clone(),
        cwd: PathBuf::from(&request.cwd),
        env: request.env.clone(),
        stdout_path: None,
        stderr_path: None,
        stdout_pipe,
        stderr_pipe,
        stdin_pipe,
        capability_sids,
        timeout_ms: request.timeout_ms,
    };
    let json = serde_json::to_vec_pretty(&runner_request)
        .map_err(|error| format!("serialize runner request failed: {error}"))?;
    std::fs::write(&request_path, json).map_err(|error| {
        format!(
            "write runner request {} failed: {error}",
            request_path.display()
        )
    })?;
    Ok(request_path)
}

fn refresh_launch_acls(
    request: &LaunchRequest,
    managed_root: &Path,
    cap_sids: &[String],
) -> Result<(), String> {
    let session_dir = PathBuf::from(&request.session_dir);
    std::fs::create_dir_all(&session_dir).map_err(|error| {
        format!(
            "create sessionDir {} failed: {error}",
            session_dir.display()
        )
    })?;
    v2_paths::validate_inside_managed("sessionDir", &session_dir, managed_root)?;
    grant_sandbox_group_modify(&session_dir)?;
    grant_capability_modify(&session_dir, cap_sids)?;

    for path in &request.writable_paths {
        let path = PathBuf::from(path);
        v2_paths::validate_writable_root(&path, managed_root)?;
        if path.exists() {
            grant_sandbox_group_modify(&path)?;
            grant_capability_modify(&path, cap_sids)?;
        } else {
            std::fs::create_dir_all(&path).map_err(|error| {
                format!("create writable path {} failed: {error}", path.display())
            })?;
            grant_sandbox_group_modify(&path)?;
            grant_capability_modify(&path, cap_sids)?;
        }
    }

    for output_path in request.stdout_path.iter().chain(request.stderr_path.iter()) {
        let output_path = PathBuf::from(output_path);
        v2_paths::validate_inside_managed("outputPath", &output_path, managed_root)?;
        if let Some(parent) = output_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                format!("create output parent {} failed: {error}", parent.display())
            })?;
            grant_sandbox_group_modify(parent)?;
            grant_capability_modify(parent, cap_sids)?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn grant_sandbox_group_read(path: &Path) -> Result<(), String> {
    crate::windows_acl::grant_sandbox_group_read_execute(path)
}

#[cfg(windows)]
fn grant_sandbox_group_modify(path: &Path) -> Result<(), String> {
    crate::windows_acl::grant_sandbox_group_modify(path)
}

#[cfg(windows)]
fn grant_capability_modify(path: &Path, cap_sids: &[String]) -> Result<(), String> {
    for sid in cap_sids {
        crate::windows_acl::grant_modify_to_sid_string(path, sid)?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn grant_sandbox_group_read(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
fn grant_sandbox_group_modify(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
fn grant_capability_modify(_path: &Path, _cap_sids: &[String]) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn create_output_pipe(label: &str) -> Result<crate::named_pipes::OutputPipeServer, String> {
    crate::named_pipes::OutputPipeServer::create(label)
}

#[cfg(windows)]
fn create_input_pipe(
    label: &str,
    content: Vec<u8>,
) -> Result<crate::named_pipes::InputPipeServer, String> {
    crate::named_pipes::InputPipeServer::create(label, content)
}

#[cfg(windows)]
fn join_pipe_reader(
    handle: thread::JoinHandle<Result<Vec<u8>, String>>,
) -> Result<Vec<u8>, String> {
    handle
        .join()
        .map_err(|_| "named pipe reader thread panicked".to_string())?
}

#[cfg(windows)]
fn join_pipe_writer(handle: thread::JoinHandle<Result<(), String>>) -> Result<(), String> {
    handle
        .join()
        .map_err(|_| "named pipe writer thread panicked".to_string())?
}

#[cfg(windows)]
fn spawn_runner_as_sandbox_user(
    credentials: &crate::sandbox_credentials::SandboxCredentials,
    runner_exe: &Path,
    args: &[String],
    cwd: &Path,
) -> Result<crate::windows_logon::SpawnedLogonProcess, String> {
    crate::windows_logon::spawn_process_with_logon(credentials, runner_exe, args, cwd)
}

#[cfg(windows)]
fn wait_for_spawned_runner(
    process: crate::windows_logon::SpawnedLogonProcess,
    timeout_ms: u32,
) -> Result<crate::windows_logon::ProcessRunResult, String> {
    crate::windows_logon::wait_for_process(process, timeout_ms)
}

#[cfg(not(windows))]
struct NonWindowsOutputPipe;

#[cfg(not(windows))]
struct NonWindowsInputPipe;

#[cfg(not(windows))]
impl NonWindowsOutputPipe {
    fn name(&self) -> &str {
        ""
    }

    fn into_reader_thread(self) -> thread::JoinHandle<Result<Vec<u8>, String>> {
        thread::spawn(|| Ok(Vec::new()))
    }
}

#[cfg(not(windows))]
impl NonWindowsInputPipe {
    fn name(&self) -> &str {
        ""
    }

    fn into_writer_thread(self) -> thread::JoinHandle<Result<(), String>> {
        thread::spawn(|| Ok(()))
    }
}

#[cfg(not(windows))]
fn create_output_pipe(_label: &str) -> Result<NonWindowsOutputPipe, String> {
    Err("named pipes are only supported on Windows".to_string())
}

#[cfg(not(windows))]
fn create_input_pipe(_label: &str, _content: Vec<u8>) -> Result<NonWindowsInputPipe, String> {
    Err("named pipes are only supported on Windows".to_string())
}

#[cfg(not(windows))]
fn join_pipe_reader(
    handle: thread::JoinHandle<Result<Vec<u8>, String>>,
) -> Result<Vec<u8>, String> {
    handle
        .join()
        .map_err(|_| "named pipe reader thread panicked".to_string())?
}

#[cfg(not(windows))]
fn join_pipe_writer(handle: thread::JoinHandle<Result<(), String>>) -> Result<(), String> {
    handle
        .join()
        .map_err(|_| "named pipe writer thread panicked".to_string())?
}

#[cfg(not(windows))]
fn spawn_runner_as_sandbox_user(
    _credentials: &crate::sandbox_credentials::SandboxCredentials,
    _runner_exe: &Path,
    _args: &[String],
    _cwd: &Path,
) -> Result<NonWindowsProcessRunResult, String> {
    Err("sandbox runner launch is only supported on Windows".to_string())
}

#[cfg(not(windows))]
fn wait_for_spawned_runner(
    _process: NonWindowsProcessRunResult,
    _timeout_ms: u32,
) -> Result<NonWindowsProcessRunResult, String> {
    Err("sandbox runner launch is only supported on Windows".to_string())
}

fn runner_exe_path() -> Result<PathBuf, String> {
    let current =
        std::env::current_exe().map_err(|error| format!("current_exe failed: {error}"))?;
    let dir = current
        .parent()
        .ok_or_else(|| format!("helper executable has no parent: {}", current.display()))?;
    let filename = if cfg!(windows) {
        "office-agent-command-runner.exe"
    } else {
        "office-agent-command-runner"
    };
    Ok(dir.join(filename))
}

#[cfg(windows)]
fn run_runner_as_sandbox_user(
    credentials: &crate::sandbox_credentials::SandboxCredentials,
    runner_exe: &Path,
    args: &[String],
    cwd: &Path,
    timeout_ms: u32,
) -> Result<u32, String> {
    crate::windows_logon::run_process_with_logon(credentials, runner_exe, args, cwd, timeout_ms)
}

#[cfg(not(windows))]
fn run_runner_as_sandbox_user(
    _credentials: &crate::sandbox_credentials::SandboxCredentials,
    _runner_exe: &Path,
    _args: &[String],
    _cwd: &Path,
    _timeout_ms: u32,
) -> Result<u32, String> {
    Err("sandbox runner launch is only supported on Windows".to_string())
}

#[cfg(not(windows))]
struct NonWindowsProcessRunResult {
    pid: u32,
    exit_code: u32,
}
