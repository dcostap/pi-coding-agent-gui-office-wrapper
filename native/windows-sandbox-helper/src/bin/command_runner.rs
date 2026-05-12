use officeagent_windows_sandbox_helper::constants;
use officeagent_windows_sandbox_helper::runner_protocol::RunnerRequest;
use std::fs::{File, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.iter().any(|arg| arg == "--self-test") {
        std::process::exit(self_test_exit_code());
    }

    if let Some(request_path) = request_file_arg(&args) {
        match run_request(Path::new(&request_path)) {
            Ok(code) => std::process::exit(clamp_exit_code(code)),
            Err(error) => {
                eprintln!("command runner failed: {error}");
                std::process::exit(125);
            }
        }
    }

    eprintln!("expected --self-test or --request-file=<path>");
    std::process::exit(2);
}

#[cfg(not(windows))]
fn apply_windows_command_flags(_command: &mut std::process::Command) {}

fn request_file_arg(args: &[String]) -> Option<String> {
    args.iter()
        .find_map(|arg| arg.strip_prefix("--request-file=").map(str::to_string))
}

fn run_request(path: &Path) -> Result<i32, String> {
    let bytes = std::fs::read(path)
        .map_err(|error| format!("read request file {} failed: {error}", path.display()))?;
    let request = serde_json::from_slice::<RunnerRequest>(&bytes)
        .map_err(|error| format!("parse request file {} failed: {error}", path.display()))?;

    if uses_restricted_child(&request) {
        return run_restricted_request(&request);
    }

    run_unrestricted_request(&request)
}

#[cfg(windows)]
fn run_unrestricted_request(request: &RunnerRequest) -> Result<i32, String> {
    use std::collections::HashMap;
    use std::mem::{size_of, zeroed};
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::{
        CloseHandle, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT, WAIT_FAILED, WAIT_OBJECT_0,
        WAIT_TIMEOUT,
    };
    use windows_sys::Win32::System::Diagnostics::Debug::{
        SetErrorMode, SEM_FAILCRITICALERRORS, SEM_NOGPFAULTERRORBOX, SEM_NOOPENFILEERRORBOX,
    };
    use windows_sys::Win32::System::Threading::{
        CreateProcessW, GetExitCodeProcess, TerminateProcess, WaitForSingleObject,
        CREATE_UNICODE_ENVIRONMENT, PROCESS_INFORMATION, STARTF_USESTDHANDLES, STARTUPINFOW,
    };

    unsafe {
        SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX);
    }

    let stdout = if let Some(stdout_pipe) = &request.stdout_pipe {
        open_pipe_writer(stdout_pipe)?
    } else if let Some(stdout_path) = &request.stdout_path {
        create_output_file(stdout_path)?
    } else {
        open_null_write()?
    };
    let stderr = if let Some(stderr_pipe) = &request.stderr_pipe {
        open_pipe_writer(stderr_pipe)?
    } else if let Some(stderr_path) = &request.stderr_path {
        create_output_file(stderr_path)?
    } else {
        open_null_write()?
    };
    let stdin = if let Some(stdin_pipe) = &request.stdin_pipe {
        open_pipe_reader(stdin_pipe)?
    } else {
        open_null_read()?
    };

    let stdin_handle = stdin.as_raw_handle() as HANDLE;
    let stdout_handle = stdout.as_raw_handle() as HANDLE;
    let stderr_handle = stderr.as_raw_handle() as HANDLE;
    for handle in [stdin_handle, stdout_handle, stderr_handle] {
        let ok = unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) };
        if ok == 0 {
            return Err("SetHandleInformation failed for stdio handle".to_string());
        }
    }

    let mut env_map: HashMap<String, String> = std::env::vars()
        .filter(|(key, _)| !key.starts_with('='))
        .collect();
    for (key, value) in &request.env {
        if key.starts_with('=') {
            continue;
        }
        env_map.insert(key.clone(), value.clone());
    }
    let mut env_block = make_env_block(&env_map);
    let argv = std::iter::once(request.executable.to_string_lossy().to_string())
        .chain(request.args.iter().cloned())
        .collect::<Vec<_>>();
    let command_line = argv
        .iter()
        .map(|arg| quote_windows_arg(arg))
        .collect::<Vec<_>>()
        .join(" ");
    let executable_w = wide_null(&request.executable.to_string_lossy());
    let mut command_line_w = wide_null(&command_line);
    let effective_cwd =
        create_accessible_cwd_junction(&request.cwd).unwrap_or_else(|| request.cwd.clone());
    let cwd_w = wide_null(&effective_cwd.to_string_lossy());
    let mut startup_info: STARTUPINFOW = unsafe { zeroed() };
    startup_info.cb = size_of::<STARTUPINFOW>() as u32;
    startup_info.dwFlags = STARTF_USESTDHANDLES;
    startup_info.hStdInput = stdin_handle;
    startup_info.hStdOutput = stdout_handle;
    startup_info.hStdError = stderr_handle;
    // Do not force lpDesktop for the default sandbox-user child. In combination
    // with CREATE_NO_WINDOW this makes some console tools fail DLL initialization
    // under the dedicated sandbox account (0xc0000142).
    let mut process_info: PROCESS_INFORMATION = unsafe { zeroed() };

    let created = unsafe {
        CreateProcessW(
            executable_w.as_ptr(),
            command_line_w.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
            CREATE_UNICODE_ENVIRONMENT,
            env_block.as_mut_ptr().cast(),
            cwd_w.as_ptr(),
            &startup_info,
            &mut process_info,
        )
    };
    if created == 0 {
        return Err(format!(
            "CreateProcessW failed for command {command_line:?}: {}",
            std::io::Error::last_os_error()
        ));
    }

    unsafe {
        let _ = CloseHandle(process_info.hThread);
    }
    let job = JobCleanup::assign_process_handle(windows::Win32::Foundation::HANDLE(
        process_info.hProcess as *mut _,
    ))?;
    let timeout_ms = request
        .timeout_ms
        .unwrap_or(u64::MAX)
        .min(u64::from(u32::MAX)) as u32;
    let wait = unsafe { WaitForSingleObject(process_info.hProcess, timeout_ms) };
    if wait == WAIT_TIMEOUT {
        job.terminate(124);
        unsafe {
            let _ = TerminateProcess(process_info.hProcess, 124);
            let _ = CloseHandle(process_info.hProcess);
        }
        return Ok(124);
    }
    if wait == WAIT_FAILED {
        unsafe {
            let _ = CloseHandle(process_info.hProcess);
        }
        return Err("WaitForSingleObject failed for command".to_string());
    }
    if wait != WAIT_OBJECT_0 {
        unsafe {
            let _ = CloseHandle(process_info.hProcess);
        }
        return Err(format!("unexpected wait result for command: {wait}"));
    }
    loop {
        if job.active_process_count().unwrap_or(0) == 0 {
            break;
        }
        thread::sleep(Duration::from_millis(25));
    }
    let mut exit_code = 1u32;
    unsafe {
        let _ = GetExitCodeProcess(process_info.hProcess, &mut exit_code);
        let _ = CloseHandle(process_info.hProcess);
    }
    if exit_code > 255 {
        let mut stderr_for_diag = &stderr;
        let _ = writeln!(
            stderr_for_diag,
            "office-agent command exited with Windows status 0x{exit_code:08x}"
        );
    }
    Ok(exit_code as i32)
}

#[cfg(not(windows))]
fn run_unrestricted_request(request: &RunnerRequest) -> Result<i32, String> {
    let mut command = std::process::Command::new(&request.executable);
    command.args(&request.args).current_dir(&request.cwd);
    apply_windows_command_flags(&mut command);
    for (key, value) in &request.env {
        command.env(key, value);
    }
    if let Some(stdout_pipe) = &request.stdout_pipe {
        command.stdout(std::process::Stdio::from(open_pipe_writer(stdout_pipe)?));
    } else if let Some(stdout_path) = &request.stdout_path {
        command.stdout(std::process::Stdio::from(create_output_file(stdout_path)?));
    } else {
        command.stdout(std::process::Stdio::null());
    }
    if let Some(stderr_pipe) = &request.stderr_pipe {
        command.stderr(std::process::Stdio::from(open_pipe_writer(stderr_pipe)?));
    } else if let Some(stderr_path) = &request.stderr_path {
        command.stderr(std::process::Stdio::from(create_output_file(stderr_path)?));
    } else {
        command.stderr(std::process::Stdio::null());
    }
    if let Some(stdin_pipe) = &request.stdin_pipe {
        command.stdin(std::process::Stdio::from(open_pipe_reader(stdin_pipe)?));
    } else {
        command.stdin(std::process::Stdio::null());
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("spawn command {:?} failed: {error}", request.executable))?;
    let deadline = request
        .timeout_ms
        .map(|timeout| std::time::Instant::now() + Duration::from_millis(timeout));
    loop {
        match child
            .try_wait()
            .map_err(|error| format!("wait command failed: {error}"))?
        {
            Some(status) => return Ok(status.code().unwrap_or(1)),
            None => {
                if deadline.is_some_and(|deadline| std::time::Instant::now() >= deadline) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Ok(124);
                }
                thread::sleep(Duration::from_millis(25));
            }
        }
    }
}

#[cfg(windows)]
struct JobCleanup(windows::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl JobCleanup {
    fn assign_process_handle(
        process_handle: windows::Win32::Foundation::HANDLE,
    ) -> Result<Self, String> {
        use std::mem::{size_of, zeroed};
        use windows::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        let job = unsafe { CreateJobObjectW(None, None) }
            .map_err(|error| format!("CreateJobObjectW failed: {error}"))?;
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        }
        .map_err(|error| format!("SetInformationJobObject kill-on-close failed: {error}"))?;
        unsafe { AssignProcessToJobObject(job, process_handle) }
            .map_err(|error| format!("AssignProcessToJobObject failed: {error}"))?;
        Ok(Self(job))
    }

    fn active_process_count(&self) -> Result<u32, String> {
        use std::mem::size_of;
        use windows::Win32::System::JobObjects::{
            JobObjectBasicAccountingInformation, QueryInformationJobObject,
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
        };
        let mut accounting = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
        unsafe {
            QueryInformationJobObject(
                self.0,
                JobObjectBasicAccountingInformation,
                (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                None,
            )
        }
        .map_err(|error| format!("QueryInformationJobObject basic accounting failed: {error}"))?;
        Ok(accounting.ActiveProcesses)
    }

    fn terminate(&self, exit_code: u32) {
        unsafe {
            let _ = windows::Win32::System::JobObjects::TerminateJobObject(self.0, exit_code);
        }
    }
}

#[cfg(windows)]
impl Drop for JobCleanup {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

#[cfg(not(windows))]
struct JobCleanup;

#[cfg(not(windows))]
impl JobCleanup {
    fn assign(_child: &mut std::process::Child) -> Result<Self, String> {
        Ok(Self)
    }

    fn assign_process_handle(_process_handle: isize) -> Result<Self, String> {
        Ok(Self)
    }

    fn active_process_count(&self) -> Result<u32, String> {
        Ok(0)
    }

    fn terminate(&self, _exit_code: u32) {}
}

#[cfg(windows)]
fn uses_restricted_child(request: &RunnerRequest) -> bool {
    std::env::var("OFFICE_AGENT_WINDOWS_SANDBOX_RESTRICTED_CHILD")
        .map(|value| value == "1")
        .unwrap_or(false)
        && !request.capability_sids.is_empty()
}

#[cfg(not(windows))]
fn uses_restricted_child(_request: &RunnerRequest) -> bool {
    false
}

#[cfg(windows)]
fn run_restricted_request(request: &RunnerRequest) -> Result<i32, String> {
    let stdout = if let Some(stdout_pipe) = &request.stdout_pipe {
        open_pipe_writer(stdout_pipe)?
    } else if let Some(stdout_path) = &request.stdout_path {
        create_output_file(stdout_path)?
    } else {
        open_null_write()?
    };
    let stderr = if let Some(stderr_pipe) = &request.stderr_pipe {
        open_pipe_writer(stderr_pipe)?
    } else if let Some(stderr_path) = &request.stderr_path {
        create_output_file(stderr_path)?
    } else {
        open_null_write()?
    };
    let stdin = if let Some(stdin_pipe) = &request.stdin_pipe {
        open_pipe_reader(stdin_pipe)?
    } else {
        open_null_read()?
    };
    officeagent_windows_sandbox_helper::windows_restricted_process::run_restricted(
        request, &stdout, &stderr, &stdin,
    )
}

#[cfg(windows)]
fn create_accessible_cwd_junction(requested_cwd: &Path) -> Option<PathBuf> {
    use std::os::windows::process::CommandExt;

    let userprofile = std::env::var_os("USERPROFILE").map(PathBuf::from)?;
    let root = userprofile.join(".officeagent").join("sandbox").join("cwd");
    std::fs::create_dir_all(&root).ok()?;

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    requested_cwd.to_string_lossy().hash(&mut hasher);
    let junction = root.join(format!("{:x}", hasher.finish()));
    if junction.exists() {
        return Some(junction);
    }

    let link = format!("\"{}\"", junction.display());
    let target = format!("\"{}\"", requested_cwd.display());
    let status = Command::new("cmd")
        .raw_arg("/d")
        .raw_arg("/c")
        .raw_arg("mklink")
        .raw_arg("/J")
        .raw_arg(&link)
        .raw_arg(&target)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()?;
    if status.success() && junction.exists() {
        Some(junction)
    } else {
        None
    }
}

#[cfg(not(windows))]
fn create_accessible_cwd_junction(requested_cwd: &Path) -> Option<PathBuf> {
    Some(requested_cwd.to_path_buf())
}

fn make_env_block(env: &std::collections::HashMap<String, String>) -> Vec<u16> {
    let mut items = env.iter().collect::<Vec<_>>();
    items.sort_by(|a, b| {
        a.0.to_uppercase()
            .cmp(&b.0.to_uppercase())
            .then(a.0.cmp(b.0))
    });
    let mut block = Vec::new();
    for (key, value) in items {
        let mut entry = wide_null(&format!("{key}={value}"));
        entry.pop();
        block.extend(entry);
        block.push(0);
    }
    block.push(0);
    block
}

fn quote_windows_arg(arg: &str) -> String {
    if arg.is_empty() {
        return "\"\"".to_string();
    }
    let needs_quotes = arg.chars().any(|ch| ch.is_whitespace() || ch == '"');
    if !needs_quotes {
        return arg.to_string();
    }
    let mut result = String::from("\"");
    let mut backslashes = 0;
    for ch in arg.chars() {
        match ch {
            '\\' => backslashes += 1,
            '"' => {
                result.push_str(&"\\".repeat(backslashes * 2 + 1));
                result.push('"');
                backslashes = 0;
            }
            _ => {
                result.push_str(&"\\".repeat(backslashes));
                backslashes = 0;
                result.push(ch);
            }
        }
    }
    result.push_str(&"\\".repeat(backslashes * 2));
    result.push('"');
    result
}

fn wide_null(value: &str) -> Vec<u16> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        std::ffi::OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }
    #[cfg(not(windows))]
    {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }
}

fn open_pipe_writer(name: &str) -> Result<File, String> {
    OpenOptions::new()
        .write(true)
        .open(name)
        .map_err(|error| format!("open named pipe {name} for write failed: {error}"))
}

fn open_pipe_reader(name: &str) -> Result<File, String> {
    OpenOptions::new()
        .read(true)
        .open(name)
        .map_err(|error| format!("open named pipe {name} for read failed: {error}"))
}

fn open_null_write() -> Result<File, String> {
    OpenOptions::new()
        .write(true)
        .open("NUL")
        .map_err(|error| format!("open NUL for write failed: {error}"))
}

fn open_null_read() -> Result<File, String> {
    OpenOptions::new()
        .read(true)
        .open("NUL")
        .map_err(|error| format!("open NUL for read failed: {error}"))
}

fn create_output_file(path: &Path) -> Result<File, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            format!("create output parent {} failed: {error}", parent.display())
        })?;
    }
    OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("open output file {} failed: {error}", path.display()))
}

fn clamp_exit_code(code: i32) -> i32 {
    if code == 0 {
        0
    } else if (1..=255).contains(&code) {
        code
    } else {
        1
    }
}

fn self_test_exit_code() -> i32 {
    let username = std::env::var("USERNAME").unwrap_or_default();
    if username.eq_ignore_ascii_case(constants::SANDBOX_USERNAME) {
        0
    } else {
        eprintln!(
            "command runner self-test expected USERNAME={} but saw {:?}",
            constants::SANDBOX_USERNAME,
            username
        );
        10
    }
}
