#![cfg(windows)]

use crate::sandbox_credentials::SandboxCredentials;
use std::mem::{size_of, zeroed};
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use windows::core::{Error, PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_FAILED, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows::Win32::Security::{LogonUserW, LOGON32_LOGON_INTERACTIVE, LOGON32_PROVIDER_DEFAULT};
use windows::Win32::System::Threading::{
    CreateProcessAsUserW, CreateProcessWithLogonW, CreateProcessWithTokenW, GetExitCodeProcess,
    TerminateProcess, WaitForSingleObject, CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT,
    LOGON_WITH_PROFILE, PROCESS_CREATION_FLAGS, PROCESS_INFORMATION, STARTUPINFOW,
};

pub fn verify_credentials(credentials: &SandboxCredentials) -> Result<(), String> {
    let username_w = wide_null(&credentials.username);
    let domain_w = wide_null(&credentials.domain);
    let password_w = wide_null(&credentials.password);
    let mut token = HANDLE::default();
    unsafe {
        LogonUserW(
            PCWSTR(username_w.as_ptr()),
            PCWSTR(domain_w.as_ptr()),
            PCWSTR(password_w.as_ptr()),
            LOGON32_LOGON_INTERACTIVE,
            LOGON32_PROVIDER_DEFAULT,
            &mut token,
        )
        .map_err(|error| format!("LogonUserW OfficeAgentSandbox failed: {error}"))?;
        let _ = CloseHandle(token);
    }
    Ok(())
}

#[derive(Debug, Clone, Copy)]
pub struct ProcessRunResult {
    pub pid: u32,
    pub exit_code: u32,
}

pub struct SpawnedLogonProcess {
    pub pid: u32,
    process_handle: HANDLE,
    thread_handle: HANDLE,
}

pub fn run_process_with_logon(
    credentials: &SandboxCredentials,
    executable: &Path,
    args: &[String],
    cwd: &Path,
    timeout_ms: u32,
) -> Result<u32, String> {
    run_process_with_logon_detailed(credentials, executable, args, cwd, timeout_ms)
        .map(|result| result.exit_code)
}

pub fn run_process_with_logon_detailed(
    credentials: &SandboxCredentials,
    executable: &Path,
    args: &[String],
    cwd: &Path,
    timeout_ms: u32,
) -> Result<ProcessRunResult, String> {
    let process = spawn_process_with_logon(credentials, executable, args, cwd)?;
    wait_for_process(process, timeout_ms)
}

pub fn spawn_process_with_logon(
    credentials: &SandboxCredentials,
    executable: &Path,
    args: &[String],
    cwd: &Path,
) -> Result<SpawnedLogonProcess, String> {
    let username_w = wide_null(&credentials.username);
    let domain_w = wide_null(&credentials.domain);
    let password_w = wide_null(&credentials.password);
    let executable_string = executable.to_string_lossy().to_string();
    let executable_w = wide_null(&executable_string);
    let mut command_line_w = wide_null(&build_command_line(&executable_string, args));
    let cwd_string = cwd.to_string_lossy().to_string();
    let cwd_w = wide_null(&cwd_string);
    let mut startup_info: STARTUPINFOW = unsafe { zeroed() };
    startup_info.cb = size_of::<STARTUPINFOW>() as u32;
    // Do not force lpDesktop here. With CreateProcessWithLogonW + CREATE_NO_WINDOW,
    // setting winsta0\\default causes some console tools to fail DLL initialization
    // under the dedicated sandbox account (for example whoami/node with 0xc0000142).
    let mut process_information: PROCESS_INFORMATION = unsafe { zeroed() };

    let logon_flags = LOGON_WITH_PROFILE;
    let creation_flags = PROCESS_CREATION_FLAGS(CREATE_NO_WINDOW.0 | CREATE_UNICODE_ENVIRONMENT.0);

    unsafe {
        match CreateProcessWithLogonW(
            PCWSTR(username_w.as_ptr()),
            PCWSTR(domain_w.as_ptr()),
            PCWSTR(password_w.as_ptr()),
            logon_flags,
            PCWSTR(executable_w.as_ptr()),
            PWSTR(command_line_w.as_mut_ptr()),
            creation_flags,
            None,
            PCWSTR(cwd_w.as_ptr()),
            &startup_info,
            &mut process_information,
        ) {
            Ok(()) => {}
            Err(cpwl_error) => {
                let mut token = HANDLE::default();
                LogonUserW(
                    PCWSTR(username_w.as_ptr()),
                    PCWSTR(domain_w.as_ptr()),
                    PCWSTR(password_w.as_ptr()),
                    LOGON32_LOGON_INTERACTIVE,
                    LOGON32_PROVIDER_DEFAULT,
                    &mut token,
                )
                .map_err(|logon_error| {
                    format!(
                        "CreateProcessWithLogonW failed: {cpwl_error}; fallback LogonUserW failed: {logon_error}"
                    )
                })?;
                let token_guard = HandleGuard(token);
                let mut token_command_line_w =
                    wide_null(&build_command_line(&executable_string, args));
                match CreateProcessWithTokenW(
                    token,
                    logon_flags,
                    PCWSTR(executable_w.as_ptr()),
                    PWSTR(token_command_line_w.as_mut_ptr()),
                    creation_flags,
                    None,
                    PCWSTR(cwd_w.as_ptr()),
                    &startup_info,
                    &mut process_information,
                ) {
                    Ok(()) => {}
                    Err(cpwt_error) => {
                        let mut fallback_command_line_w =
                            wide_null(&build_command_line(&executable_string, args));
                        CreateProcessAsUserW(
                            token,
                            PCWSTR(executable_w.as_ptr()),
                            PWSTR(fallback_command_line_w.as_mut_ptr()),
                            None,
                            None,
                            false,
                            creation_flags,
                            None,
                            PCWSTR(cwd_w.as_ptr()),
                            &startup_info,
                            &mut process_information,
                        )
                        .map_err(|cpau_error| {
                            crate::diagnostics::format_logon_launch_blocked_message(
                                &cpwl_error.to_string(),
                                &format_hresult(&cpwl_error),
                                &cpwt_error.to_string(),
                                &format_hresult(&cpwt_error),
                                &cpau_error.to_string(),
                                &format_hresult(&cpau_error),
                            )
                        })?;
                    }
                }
                drop(token_guard);
            }
        }

        Ok(SpawnedLogonProcess {
            pid: process_information.dwProcessId,
            process_handle: process_information.hProcess,
            thread_handle: process_information.hThread,
        })
    }
}

pub fn wait_for_process(
    mut process: SpawnedLogonProcess,
    timeout_ms: u32,
) -> Result<ProcessRunResult, String> {
    unsafe {
        let wait = WaitForSingleObject(process.process_handle, timeout_ms);
        if wait == WAIT_TIMEOUT {
            let _ = TerminateProcess(process.process_handle, 124);
            let pid = process.pid;
            process.close();
            return Ok(ProcessRunResult {
                pid,
                exit_code: 124,
            });
        }
        if wait == WAIT_FAILED {
            return Err("WaitForSingleObject failed for sandbox runner".to_string());
        }
        if wait != WAIT_OBJECT_0 {
            return Err(format!(
                "unexpected wait result for sandbox runner: {wait:?}"
            ));
        }
        let mut exit_code = 0u32;
        GetExitCodeProcess(process.process_handle, &mut exit_code)
            .map_err(|error| format!("GetExitCodeProcess failed: {error}"))?;
        let pid = process.pid;
        process.close();
        Ok(ProcessRunResult { pid, exit_code })
    }
}

fn format_hresult(error: &Error) -> String {
    format!("0x{:08X}", error.code().0 as u32)
}

fn build_command_line(executable: &str, args: &[String]) -> String {
    std::iter::once(executable)
        .chain(args.iter().map(String::as_str))
        .map(quote_windows_arg)
        .collect::<Vec<_>>()
        .join(" ")
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
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

impl SpawnedLogonProcess {
    fn close(&mut self) {
        unsafe {
            if !self.thread_handle.is_invalid() {
                let _ = CloseHandle(self.thread_handle);
                self.thread_handle = HANDLE::default();
            }
            if !self.process_handle.is_invalid() {
                let _ = CloseHandle(self.process_handle);
                self.process_handle = HANDLE::default();
            }
        }
    }
}

impl Drop for SpawnedLogonProcess {
    fn drop(&mut self) {
        self.close();
    }
}

struct HandleGuard(HANDLE);

impl Drop for HandleGuard {
    fn drop(&mut self) {
        unsafe {
            if !self.0.is_invalid() {
                let _ = CloseHandle(self.0);
            }
        }
    }
}
