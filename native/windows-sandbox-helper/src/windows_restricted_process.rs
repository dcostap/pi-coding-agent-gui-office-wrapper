#![cfg(windows)]

use crate::runner_protocol::RunnerRequest;
use std::collections::BTreeMap;
use std::ffi::c_void;
use std::fs::File;
use std::io::Write;
use std::mem::{size_of, zeroed};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::AsRawHandle;
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, LocalFree, SetHandleInformation, ERROR_INVALID_PARAMETER,
    ERROR_SUCCESS, GENERIC_ALL, HANDLE, HANDLE_FLAG_INHERIT, HLOCAL, LUID, WAIT_FAILED,
    WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSidToSidW, SetEntriesInAclW, EXPLICIT_ACCESS_W, GRANT_ACCESS, TRUSTEE_IS_SID,
    TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows_sys::Win32::Security::{
    AdjustTokenPrivileges, CopySid, CreateRestrictedToken, CreateWellKnownSid, GetLengthSid,
    GetTokenInformation, LookupPrivilegeValueW, SetTokenInformation, TokenDefaultDacl, TokenGroups,
    WinWorldSid, ACL, DISABLE_MAX_PRIVILEGE, LUA_TOKEN, PSID, SID_AND_ATTRIBUTES,
    TOKEN_ADJUST_DEFAULT, TOKEN_ADJUST_PRIVILEGES, TOKEN_ADJUST_SESSIONID, TOKEN_ASSIGN_PRIMARY,
    TOKEN_DUPLICATE, TOKEN_PRIVILEGES, TOKEN_QUERY, WRITE_RESTRICTED,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{
    CreateProcessAsUserW, GetCurrentProcess, GetExitCodeProcess, OpenProcessToken,
    TerminateProcess, WaitForSingleObject, CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT,
    PROCESS_INFORMATION, STARTF_USESTDHANDLES, STARTUPINFOW,
};

const SE_GROUP_LOGON_ID: u32 = 0xC000_0000;

#[repr(C)]
struct TokenDefaultDaclInfo {
    default_dacl: *mut ACL,
}

pub fn run_restricted(
    request: &RunnerRequest,
    stdout: &File,
    stderr: &File,
    stdin: &File,
) -> Result<i32, String> {
    let child = spawn_restricted(request, stdout, stderr, stdin)?;
    let exit_code = child.wait_raw(request.timeout_ms.unwrap_or(300_000))?;
    if exit_code > 255 {
        let mut stderr = stderr;
        let _ = writeln!(
            stderr,
            "OfficeAgent restricted child raw exit code: 0x{exit_code:08x} ({exit_code})"
        );
        if is_restricted_child_compat_failure(exit_code) {
            let _ = writeln!(
                stderr,
                "OfficeAgent retrying this command under the sandbox account without the final restricted-token layer for compatibility."
            );
            return run_unrestricted_compat(request, stdout, stderr, stdin);
        }
        return Ok(255);
    }
    Ok(exit_code as i32)
}

fn is_restricted_child_compat_failure(exit_code: u32) -> bool {
    matches!(exit_code, 0xC000_0142 | 0xC06D_007E)
}

fn run_unrestricted_compat(
    request: &RunnerRequest,
    stdout: &File,
    stderr: &File,
    stdin: &File,
) -> Result<i32, String> {
    let mut command = Command::new(&request.executable);
    command
        .args(&request.args)
        .current_dir(&request.cwd)
        .stdin(Stdio::from(
            stdin
                .try_clone()
                .map_err(|error| format!("clone stdin failed: {error}"))?,
        ))
        .stdout(Stdio::from(
            stdout
                .try_clone()
                .map_err(|error| format!("clone stdout failed: {error}"))?,
        ))
        .stderr(Stdio::from(
            stderr
                .try_clone()
                .map_err(|error| format!("clone stderr failed: {error}"))?,
        ));
    command.creation_flags(CREATE_NO_WINDOW);
    for (key, value) in &request.env {
        command.env(key, value);
    }
    let mut child = command.spawn().map_err(|error| {
        format!(
            "spawn unrestricted sandbox compatibility child {:?} failed: {error}",
            request.executable
        )
    })?;
    let job = ChildJob::assign(&mut child)?;
    wait_child_with_job(&mut child, &job, request.timeout_ms.unwrap_or(300_000))
}

struct ChildJob(HANDLE);

impl ChildJob {
    fn assign(child: &mut Child) -> Result<Self, String> {
        let job = create_kill_on_close_job()?;
        let assigned = unsafe { AssignProcessToJobObject(job, child.as_raw_handle().cast()) };
        if assigned == 0 {
            unsafe {
                CloseHandle(job);
            }
            return Err(format!(
                "AssignProcessToJobObject unrestricted compatibility child failed: {}",
                last_error()
            ));
        }
        Ok(Self(job))
    }
}

impl Drop for ChildJob {
    fn drop(&mut self) {
        unsafe {
            if !self.0.is_null() {
                CloseHandle(self.0);
            }
        }
    }
}

fn wait_child_with_job(child: &mut Child, job: &ChildJob, timeout_ms: u64) -> Result<i32, String> {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        match child
            .try_wait()
            .map_err(|error| format!("wait unrestricted compatibility child failed: {error}"))?
        {
            Some(status) => return Ok(status.code().unwrap_or(1).clamp(0, 255)),
            None => {
                if Instant::now() >= deadline {
                    unsafe {
                        let _ = TerminateJobObject(job.0, 124);
                    }
                    let _ = child.kill();
                    let _ = child.wait();
                    return Ok(124);
                }
                thread::sleep(Duration::from_millis(25));
            }
        }
    }
}

struct RestrictedChild {
    process: HANDLE,
    thread: HANDLE,
    job: HANDLE,
}

impl RestrictedChild {
    fn wait_raw(mut self, timeout_ms: u64) -> Result<u32, String> {
        let timeout = timeout_ms.min(u64::from(u32::MAX)) as u32;
        let wait = unsafe { WaitForSingleObject(self.process, timeout) };
        if wait == WAIT_TIMEOUT {
            unsafe {
                if !self.job.is_null() {
                    let _ = TerminateJobObject(self.job, 124);
                }
                let _ = TerminateProcess(self.process, 124);
            }
            self.close();
            return Ok(124);
        }
        if wait == WAIT_FAILED {
            return Err(format!("WaitForSingleObject failed: {}", last_error()));
        }
        if wait != WAIT_OBJECT_0 {
            return Err(format!("unexpected wait result: {wait}"));
        }
        let mut exit_code = 0u32;
        let ok = unsafe { GetExitCodeProcess(self.process, &mut exit_code) };
        if ok == 0 {
            return Err(format!("GetExitCodeProcess failed: {}", last_error()));
        }
        self.close();
        Ok(exit_code)
    }

    fn close(&mut self) {
        unsafe {
            if !self.thread.is_null() {
                CloseHandle(self.thread);
                self.thread = std::ptr::null_mut();
            }
            if !self.process.is_null() {
                CloseHandle(self.process);
                self.process = std::ptr::null_mut();
            }
            if !self.job.is_null() {
                CloseHandle(self.job);
                self.job = std::ptr::null_mut();
            }
        }
    }
}

impl Drop for RestrictedChild {
    fn drop(&mut self) {
        self.close();
    }
}

fn spawn_restricted(
    request: &RunnerRequest,
    stdout: &File,
    stderr: &File,
    stdin: &File,
) -> Result<RestrictedChild, String> {
    let mut inherit_handles = vec![raw_handle(stdin), raw_handle(stdout), raw_handle(stderr)];
    for handle in &inherit_handles {
        set_inheritable(*handle, true)?;
    }

    let token = create_restricted_token(&request.capability_sids)?;
    let token_guard = HandleGuard(token);
    let command_line = build_command_line(&request.executable, &request.args);
    let mut command_line_w = wide_null_str(&command_line);
    let mut cwd_w = wide_null_path(&request.cwd);
    let env_block = build_environment_block(&request.env);
    let mut startup: STARTUPINFOW = unsafe { zeroed() };
    startup.cb = size_of::<STARTUPINFOW>() as u32;
    let mut desktop_w = wide_null_str("Winsta0\\Default");
    startup.lpDesktop = desktop_w.as_mut_ptr();
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = raw_handle(stdin);
    startup.hStdOutput = raw_handle(stdout);
    startup.hStdError = raw_handle(stderr);
    let mut process_info: PROCESS_INFORMATION = unsafe { zeroed() };

    let ok = unsafe {
        CreateProcessAsUserW(
            token_guard.0,
            std::ptr::null_mut(),
            command_line_w.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
            CREATE_UNICODE_ENVIRONMENT,
            env_block.as_ptr().cast::<c_void>(),
            cwd_w.as_mut_ptr(),
            &startup,
            &mut process_info,
        )
    };

    for handle in inherit_handles.drain(..) {
        let _ = set_inheritable(handle, false);
    }

    if ok == 0 {
        return Err(format!(
            "CreateProcessAsUserW restricted child failed: {}",
            last_error()
        ));
    }

    let job = create_kill_on_close_job()?;
    let assigned = unsafe { AssignProcessToJobObject(job, process_info.hProcess) };
    if assigned == 0 {
        unsafe {
            let _ = TerminateProcess(process_info.hProcess, 125);
            CloseHandle(job);
            CloseHandle(process_info.hThread);
            CloseHandle(process_info.hProcess);
        }
        return Err(format!("AssignProcessToJobObject failed: {}", last_error()));
    }

    Ok(RestrictedChild {
        process: process_info.hProcess,
        thread: process_info.hThread,
        job,
    })
}

fn create_restricted_token(capability_sids: &[String]) -> Result<HANDLE, String> {
    if capability_sids.is_empty() {
        return Err("restricted child launch requires at least one capability SID".to_string());
    }
    unsafe {
        let desired = TOKEN_DUPLICATE
            | TOKEN_QUERY
            | TOKEN_ASSIGN_PRIMARY
            | TOKEN_ADJUST_DEFAULT
            | TOKEN_ADJUST_SESSIONID
            | TOKEN_ADJUST_PRIVILEGES;
        let mut base: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), desired, &mut base) == 0 {
            return Err(format!("OpenProcessToken failed: {}", last_error()));
        }
        let base_guard = HandleGuard(base);
        let mut converted_sids = Vec::with_capacity(capability_sids.len());
        for sid in capability_sids {
            converted_sids.push(SidPtr::from_string(sid)?);
        }
        let mut logon_sid = get_logon_sid_bytes(base_guard.0)?;
        let mut everyone_sid = world_sid_bytes()?;
        let mut entries = Vec::<SID_AND_ATTRIBUTES>::with_capacity(converted_sids.len() + 2);
        for sid in &converted_sids {
            entries.push(SID_AND_ATTRIBUTES {
                Sid: sid.0,
                Attributes: 0,
            });
        }
        entries.push(SID_AND_ATTRIBUTES {
            Sid: logon_sid.as_mut_ptr().cast(),
            Attributes: 0,
        });
        entries.push(SID_AND_ATTRIBUTES {
            Sid: everyone_sid.as_mut_ptr().cast(),
            Attributes: 0,
        });
        let mut restricted: HANDLE = std::ptr::null_mut();
        let ok = CreateRestrictedToken(
            base_guard.0,
            DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED,
            0,
            std::ptr::null(),
            0,
            std::ptr::null(),
            entries.len() as u32,
            entries.as_ptr(),
            &mut restricted,
        );
        if ok == 0 {
            return Err(format!("CreateRestrictedToken failed: {}", last_error()));
        }
        let mut dacl_sids = Vec::with_capacity(converted_sids.len() + 2);
        dacl_sids.push(logon_sid.as_mut_ptr().cast());
        dacl_sids.push(everyone_sid.as_mut_ptr().cast());
        dacl_sids.extend(converted_sids.iter().map(|sid| sid.0));
        if let Err(error) = set_default_dacl(restricted, &dacl_sids) {
            CloseHandle(restricted);
            return Err(error);
        }
        if let Err(error) = enable_single_privilege(restricted, "SeChangeNotifyPrivilege") {
            CloseHandle(restricted);
            return Err(error);
        }
        Ok(restricted)
    }
}

unsafe fn enable_single_privilege(token: HANDLE, name: &str) -> Result<(), String> {
    let mut luid = LUID {
        LowPart: 0,
        HighPart: 0,
    };
    let name_w = wide_null_str(name);
    if LookupPrivilegeValueW(std::ptr::null(), name_w.as_ptr(), &mut luid) == 0 {
        return Err(format!(
            "LookupPrivilegeValueW({name}) failed: {}",
            last_error()
        ));
    }
    let mut privileges: TOKEN_PRIVILEGES = zeroed();
    privileges.PrivilegeCount = 1;
    privileges.Privileges[0].Luid = luid;
    privileges.Privileges[0].Attributes = 0x0000_0002;
    if AdjustTokenPrivileges(
        token,
        0,
        &privileges,
        0,
        std::ptr::null_mut(),
        std::ptr::null_mut(),
    ) == 0
    {
        return Err(format!(
            "AdjustTokenPrivileges({name}) failed: {}",
            last_error()
        ));
    }
    let error = unsafe { GetLastError() };
    if error != 0 {
        return Err(format!(
            "AdjustTokenPrivileges({name}) returned error {error}"
        ));
    }
    Ok(())
}

unsafe fn set_default_dacl(token: HANDLE, sids: &[PSID]) -> Result<(), String> {
    let entries = sids
        .iter()
        .map(|sid| EXPLICIT_ACCESS_W {
            grfAccessPermissions: GENERIC_ALL,
            grfAccessMode: GRANT_ACCESS,
            grfInheritance: 0,
            Trustee: TRUSTEE_W {
                pMultipleTrustee: std::ptr::null_mut(),
                MultipleTrusteeOperation: 0,
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: TRUSTEE_IS_UNKNOWN,
                ptstrName: (*sid).cast(),
            },
        })
        .collect::<Vec<_>>();
    let mut new_dacl: *mut ACL = std::ptr::null_mut();
    let acl_error = SetEntriesInAclW(
        entries.len() as u32,
        entries.as_ptr(),
        std::ptr::null(),
        &mut new_dacl,
    );
    if acl_error != ERROR_SUCCESS {
        return Err(format!(
            "SetEntriesInAclW(TokenDefaultDacl) failed: {acl_error}"
        ));
    }
    let mut info = TokenDefaultDaclInfo {
        default_dacl: new_dacl,
    };
    let ok = SetTokenInformation(
        token,
        TokenDefaultDacl,
        (&mut info as *mut TokenDefaultDaclInfo).cast(),
        size_of::<TokenDefaultDaclInfo>() as u32,
    );
    let set_error = last_error();
    if !new_dacl.is_null() {
        LocalFree(new_dacl.cast());
    }
    if ok == 0 {
        return Err(format!(
            "SetTokenInformation(TokenDefaultDacl) failed: {set_error}"
        ));
    }
    Ok(())
}

unsafe fn get_logon_sid_bytes(token: HANDLE) -> Result<Vec<u8>, String> {
    let mut needed = 0u32;
    GetTokenInformation(token, TokenGroups, std::ptr::null_mut(), 0, &mut needed);
    if needed == 0 {
        return Err(format!(
            "GetTokenInformation(TokenGroups) size probe failed: {}",
            last_error()
        ));
    }
    let mut buf = vec![0u8; needed as usize];
    if GetTokenInformation(
        token,
        TokenGroups,
        buf.as_mut_ptr().cast(),
        needed,
        &mut needed,
    ) == 0
    {
        return Err(format!(
            "GetTokenInformation(TokenGroups) failed: {}",
            last_error()
        ));
    }
    if buf.len() < size_of::<u32>() {
        return Err("TokenGroups buffer too small".to_string());
    }
    let group_count = std::ptr::read_unaligned(buf.as_ptr().cast::<u32>()) as usize;
    let after_count = buf.as_ptr().add(size_of::<u32>()) as usize;
    let align = std::mem::align_of::<SID_AND_ATTRIBUTES>();
    let aligned = (after_count + (align - 1)) & !(align - 1);
    let groups = aligned as *const SID_AND_ATTRIBUTES;
    for index in 0..group_count {
        let group = std::ptr::read_unaligned(groups.add(index));
        if (group.Attributes & SE_GROUP_LOGON_ID) == SE_GROUP_LOGON_ID {
            let len = GetLengthSid(group.Sid);
            if len == 0 {
                return Err(format!("GetLengthSid(logon) failed: {}", last_error()));
            }
            let mut sid = vec![0u8; len as usize];
            if CopySid(len, sid.as_mut_ptr().cast(), group.Sid) == 0 {
                return Err(format!("CopySid(logon) failed: {}", last_error()));
            }
            return Ok(sid);
        }
    }
    Err("logon SID not present on runner token".to_string())
}

unsafe fn world_sid_bytes() -> Result<Vec<u8>, String> {
    let mut size = 0u32;
    CreateWellKnownSid(
        WinWorldSid,
        std::ptr::null_mut(),
        std::ptr::null_mut(),
        &mut size,
    );
    if size == 0 {
        return Err(format!(
            "CreateWellKnownSid size probe failed: {}",
            last_error()
        ));
    }
    let mut sid = vec![0u8; size as usize];
    if CreateWellKnownSid(
        WinWorldSid,
        std::ptr::null_mut(),
        sid.as_mut_ptr().cast(),
        &mut size,
    ) == 0
    {
        return Err(format!("CreateWellKnownSid failed: {}", last_error()));
    }
    Ok(sid)
}

fn create_kill_on_close_job() -> Result<HANDLE, String> {
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Err(format!("CreateJobObjectW failed: {}", last_error()));
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) == 0
        {
            CloseHandle(job);
            return Err(format!(
                "SetInformationJobObject kill-on-close failed: {}",
                last_error()
            ));
        }
        Ok(job)
    }
}

struct HandleGuard(HANDLE);

impl Drop for HandleGuard {
    fn drop(&mut self) {
        unsafe {
            if !self.0.is_null() {
                CloseHandle(self.0);
            }
        }
    }
}

struct SidPtr(PSID);

impl SidPtr {
    fn from_string(sid: &str) -> Result<Self, String> {
        let mut psid: PSID = std::ptr::null_mut();
        let sid_w = wide_null_str(sid);
        let ok = unsafe { ConvertStringSidToSidW(sid_w.as_ptr(), &mut psid) };
        if ok == 0 || psid.is_null() {
            return Err(format!(
                "ConvertStringSidToSidW({sid}) failed: {}",
                last_error()
            ));
        }
        Ok(Self(psid))
    }
}

impl Drop for SidPtr {
    fn drop(&mut self) {
        unsafe {
            if !self.0.is_null() {
                LocalFree(self.0 as HLOCAL);
            }
        }
    }
}

fn set_inheritable(handle: HANDLE, inherit: bool) -> Result<(), String> {
    let flags = if inherit { HANDLE_FLAG_INHERIT } else { 0 };
    let ok = unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, flags) };
    if ok == 0 {
        return Err(format!("SetHandleInformation failed: {}", last_error()));
    }
    Ok(())
}

fn raw_handle(file: &File) -> HANDLE {
    file.as_raw_handle().cast::<c_void>()
}

fn build_environment_block(overrides: &BTreeMap<String, String>) -> Vec<u16> {
    let mut env = std::env::vars().collect::<BTreeMap<_, _>>();
    for (key, value) in overrides {
        env.insert(key.clone(), value.clone());
    }
    let mut block = Vec::new();
    for (key, value) in env {
        if key.contains('=') {
            continue;
        }
        block.extend(wide_str(&format!("{key}={value}")));
        block.push(0);
    }
    block.push(0);
    block
}

fn build_command_line(executable: &Path, args: &[String]) -> String {
    let mut parts = Vec::with_capacity(args.len() + 1);
    parts.push(quote_arg(&executable.to_string_lossy()));
    parts.extend(args.iter().map(|arg| quote_arg(arg)));
    parts.join(" ")
}

fn quote_arg(arg: &str) -> String {
    if arg.is_empty() || arg.chars().any(|ch| ch.is_whitespace() || ch == '"') {
        let mut quoted = String::from("\"");
        let mut backslashes = 0;
        for ch in arg.chars() {
            match ch {
                '\\' => backslashes += 1,
                '"' => {
                    quoted.push_str(&"\\".repeat(backslashes * 2 + 1));
                    quoted.push('"');
                    backslashes = 0;
                }
                _ => {
                    quoted.push_str(&"\\".repeat(backslashes));
                    backslashes = 0;
                    quoted.push(ch);
                }
            }
        }
        quoted.push_str(&"\\".repeat(backslashes * 2));
        quoted.push('"');
        quoted
    } else {
        arg.to_string()
    }
}

fn wide_null_path(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain([0]).collect()
}

fn wide_null_str(value: &str) -> Vec<u16> {
    wide_str(value).into_iter().chain([0]).collect()
}

fn wide_str(value: &str) -> Vec<u16> {
    std::ffi::OsStr::new(value).encode_wide().collect()
}

fn last_error() -> u32 {
    let error = unsafe { GetLastError() };
    if error == 0 {
        ERROR_INVALID_PARAMETER
    } else {
        error
    }
}
