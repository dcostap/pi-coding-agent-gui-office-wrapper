use crate::protocol::{FileWriteRequest, HelperResponse, LaunchRequest, MkdirRequest};
use std::path::{Path, PathBuf};

pub fn launch(request: LaunchRequest) -> HelperResponse {
    if let Err(error) = validate_launch_request(&request) {
        return HelperResponse::err(request.request_id, "INVALID_REQUEST", error);
    }

    launch_platform(request)
}

pub fn file_write(request: FileWriteRequest) -> HelperResponse {
    if let Err(error) = validate_managed_path_request(&request.managed_root, &request.path) {
        return HelperResponse::err(request.request_id, "INVALID_REQUEST", error);
    }

    file_write_platform(request)
}

pub fn mkdir(request: MkdirRequest) -> HelperResponse {
    if let Err(error) = validate_managed_path_request(&request.managed_root, &request.path) {
        return HelperResponse::err(request.request_id, "INVALID_REQUEST", error);
    }

    mkdir_platform(request)
}

fn validate_launch_request(request: &LaunchRequest) -> Result<(), String> {
    let managed_root = canonicalish(&request.managed_root);
    let cwd = canonicalish(&request.cwd);
    let session_dir = canonicalish(&request.session_dir);

    if !cwd.starts_with(&managed_root) {
        return Err(format!(
            "cwd must be inside managedRoot: cwd={}, managedRoot={}",
            cwd.display(),
            managed_root.display()
        ));
    }

    if !session_dir.starts_with(&managed_root) {
        return Err(format!(
            "sessionDir must be inside managedRoot: sessionDir={}, managedRoot={}",
            session_dir.display(),
            managed_root.display()
        ));
    }

    for path in request
        .writable_paths
        .iter()
        .chain(request.stdout_path.iter())
        .chain(request.stderr_path.iter())
    {
        let candidate = canonicalish(path);
        if !candidate.starts_with(&managed_root) {
            return Err(format!(
                "writable/output path must be inside managedRoot: {}",
                candidate.display()
            ));
        }
    }

    if request.executable.trim().is_empty() {
        return Err("executable is required".to_string());
    }

    Ok(())
}

fn validate_managed_path_request(managed_root: &str, path: &str) -> Result<(), String> {
    let managed_root = canonicalish(managed_root);
    let candidate = canonicalish(path);
    if !candidate.starts_with(&managed_root) {
        return Err(format!(
            "path must be inside managedRoot: path={}, managedRoot={}",
            candidate.display(),
            managed_root.display()
        ));
    }
    Ok(())
}

fn canonicalish(path: impl AsRef<Path>) -> PathBuf {
    let raw = path.as_ref();
    if raw.is_absolute() {
        raw.components().collect()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(raw)
            .components()
            .collect()
    }
}

#[cfg(windows)]
fn launch_platform(request: LaunchRequest) -> HelperResponse {
    let request_id = request.request_id.clone();
    match windows_sandbox::launch_write_restricted(request) {
        Ok(result) => result,
        Err(error) => HelperResponse::err(request_id, "LAUNCH_FAILED", error),
    }
}

#[cfg(windows)]
fn file_write_platform(request: FileWriteRequest) -> HelperResponse {
    let request_id = request.request_id.clone();
    match windows_sandbox::write_file_strict(request) {
        Ok(()) => HelperResponse::self_test(request_id),
        Err(error) => HelperResponse::err(request_id, "FILE_WRITE_FAILED", error),
    }
}

#[cfg(windows)]
fn mkdir_platform(request: MkdirRequest) -> HelperResponse {
    let request_id = request.request_id.clone();
    match windows_sandbox::mkdir_strict(request) {
        Ok(()) => HelperResponse::self_test(request_id),
        Err(error) => HelperResponse::err(request_id, "MKDIR_FAILED", error),
    }
}

#[cfg(not(windows))]
fn launch_platform(request: LaunchRequest) -> HelperResponse {
    HelperResponse::err(
        request.request_id,
        "UNSUPPORTED_PLATFORM",
        "OfficeAgent Windows sandbox helper can only launch on Windows.",
    )
}

#[cfg(not(windows))]
fn file_write_platform(request: FileWriteRequest) -> HelperResponse {
    HelperResponse::err(
        request.request_id,
        "UNSUPPORTED_PLATFORM",
        "OfficeAgent Windows sandbox helper can only write files on Windows.",
    )
}

#[cfg(not(windows))]
fn mkdir_platform(request: MkdirRequest) -> HelperResponse {
    HelperResponse::err(
        request.request_id,
        "UNSUPPORTED_PLATFORM",
        "OfficeAgent Windows sandbox helper can only create directories on Windows.",
    )
}

#[cfg(windows)]
mod windows_sandbox {
    use crate::protocol::{
        FileWriteRequest, HelperResponse, LaunchRequest, LaunchResult, MkdirRequest,
    };
    use std::ffi::c_void;
    use std::fs::{File, OpenOptions};
    use std::mem::{size_of, zeroed};
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::AsRawHandle;
    use std::path::Path;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{
        CloseHandle, LocalFree, SetHandleInformation, BOOL, HANDLE, HANDLE_FLAG_INHERIT, HLOCAL,
        WAIT_FAILED, WAIT_OBJECT_0, WAIT_TIMEOUT,
    };
    use windows::Win32::Security::Authorization::{
        BuildTrusteeWithSidW, GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW,
        EXPLICIT_ACCESS_W, GRANT_ACCESS, SE_FILE_OBJECT,
    };
    use windows::Win32::Security::{
        AllocateAndInitializeSid, CopySid, CreateRestrictedToken, FreeSid, GetLengthSid,
        GetTokenInformation, ImpersonateLoggedOnUser, RevertToSelf, SetTokenInformation,
        TokenDefaultDacl, TokenGroups, ACL, CREATE_RESTRICTED_TOKEN_FLAGS,
        DACL_SECURITY_INFORMATION, PSID, SECURITY_NT_AUTHORITY, SECURITY_WORLD_SID_AUTHORITY,
        SID_AND_ATTRIBUTES, SUB_CONTAINERS_AND_OBJECTS_INHERIT, TOKEN_ADJUST_DEFAULT,
        TOKEN_ADJUST_SESSIONID, TOKEN_ASSIGN_PRIMARY, TOKEN_DEFAULT_DACL, TOKEN_DUPLICATE,
        TOKEN_GROUPS, TOKEN_IMPERSONATE, TOKEN_QUERY,
    };
    use windows::Win32::Storage::FileSystem::{
        DELETE, FILE_DELETE_CHILD, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
    };
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::{
        CreateProcessAsUserW, GetCurrentProcess, GetExitCodeProcess, OpenProcessToken,
        ResumeThread, TerminateProcess, WaitForSingleObject, CREATE_NO_WINDOW, CREATE_SUSPENDED,
        CREATE_UNICODE_ENVIRONMENT, INFINITE, PROCESS_CREATION_FLAGS, PROCESS_INFORMATION,
        STARTF_USESTDHANDLES, STARTUPINFOW,
    };

    const WRITE_RESTRICTED: u32 = 0x08;
    const GENERIC_ALL: u32 = 0x1000_0000;
    const SE_GROUP_LOGON_ID: u32 = 0xC000_0000;

    pub fn launch_write_restricted(request: LaunchRequest) -> Result<HelperResponse, String> {
        std::fs::create_dir_all(&request.session_dir)
            .map_err(|error| format!("failed to create sessionDir: {error}"))?;

        let request_id = request.request_id.clone();
        let restricting_sid = RestrictingSid::for_managed_root(&request.managed_root)?;
        grant_write_restricted_paths(&request, restricting_sid.sid())?;
        let process = unsafe { create_write_restricted_process(&request, restricting_sid.sid())? };
        let pid = process.process_id;
        let wait_ms = request
            .timeout_ms
            .unwrap_or(INFINITE as u64)
            .min(INFINITE as u64) as u32;

        let wait_result = unsafe { WaitForSingleObject(process.process_handle, wait_ms) };
        let mut exit_code = None;
        if wait_result == WAIT_TIMEOUT {
            unsafe {
                let _ = TerminateJobObject(process.job_handle, 124);
            }
            exit_code = Some(124);
        } else if wait_result == WAIT_OBJECT_0 {
            let mut code = 0u32;
            unsafe { GetExitCodeProcess(process.process_handle, &mut code) }
                .map_err(|error| format!("GetExitCodeProcess failed: {error}"))?;
            exit_code = Some(code);
        } else if wait_result == WAIT_FAILED {
            return Err("WaitForSingleObject failed".to_string());
        }

        Ok(HelperResponse::ok(
            request_id,
            LaunchResult { pid, exit_code },
        ))
    }

    pub fn write_file_strict(request: FileWriteRequest) -> Result<(), String> {
        let restricting_sid = RestrictingSid::for_managed_root(&request.managed_root)?;
        grant_path_access(
            &request.managed_root,
            restricting_sid.sid(),
            writable_access_mask(),
        )?;
        unsafe {
            with_strict_write_restricted_impersonation(restricting_sid.sid(), || {
                if request.create_parent_dirs {
                    if let Some(parent) = Path::new(&request.path).parent() {
                        std::fs::create_dir_all(parent).map_err(|error| {
                            format!("failed to create parent directories: {error}")
                        })?;
                    }
                }
                std::fs::write(&request.path, request.content.as_bytes())
                    .map_err(|error| format!("failed to write file {}: {error}", request.path))
            })
        }
    }

    pub fn mkdir_strict(request: MkdirRequest) -> Result<(), String> {
        let restricting_sid = RestrictingSid::for_managed_root(&request.managed_root)?;
        grant_path_access(
            &request.managed_root,
            restricting_sid.sid(),
            writable_access_mask(),
        )?;
        unsafe {
            with_strict_write_restricted_impersonation(restricting_sid.sid(), || {
                std::fs::create_dir_all(&request.path).map_err(|error| {
                    format!("failed to create directory {}: {error}", request.path)
                })
            })
        }
    }

    unsafe fn create_write_restricted_process(
        request: &LaunchRequest,
        restricting_sid: PSID,
    ) -> Result<SandboxedProcess, String> {
        let token = create_write_restricted_primary_token(restricting_sid)?;
        let _token_guard = HandleGuard(token);
        create_token_process(request, token)
    }

    unsafe fn with_strict_write_restricted_impersonation<T>(
        restricting_sid: PSID,
        action: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let token = create_write_restricted_primary_token_with_policy(
            restricting_sid,
            RestrictingSidPolicy::strict_file_ops(),
        )?;
        let _token_guard = HandleGuard(token);
        ImpersonateLoggedOnUser(token)
            .map_err(|error| format!("ImpersonateLoggedOnUser(strict file op) failed: {error}"))?;
        let result = action();
        let revert_result =
            RevertToSelf().map_err(|error| format!("RevertToSelf(strict file op) failed: {error}"));
        match (result, revert_result) {
            (Ok(value), Ok(())) => Ok(value),
            (Err(error), Ok(())) => Err(error),
            (Ok(_), Err(error)) => Err(error),
            (Err(action_error), Err(revert_error)) => {
                Err(format!("{action_error}; additionally {revert_error}"))
            }
        }
    }

    unsafe fn create_write_restricted_primary_token(
        restricting_sid: PSID,
    ) -> Result<HANDLE, String> {
        create_write_restricted_primary_token_with_policy(
            restricting_sid,
            RestrictingSidPolicy::powershell_compat(),
        )
    }

    unsafe fn create_write_restricted_primary_token_with_policy(
        restricting_sid: PSID,
        restricting_sid_policy: RestrictingSidPolicy,
    ) -> Result<HANDLE, String> {
        let mut current_token = HANDLE::default();
        OpenProcessToken(
            GetCurrentProcess(),
            TOKEN_DUPLICATE
                | TOKEN_ASSIGN_PRIMARY
                | TOKEN_ADJUST_DEFAULT
                | TOKEN_ADJUST_SESSIONID
                | TOKEN_QUERY
                | TOKEN_IMPERSONATE,
            &mut current_token,
        )
        .map_err(|error| format!("OpenProcessToken failed: {error}"))?;
        let _current_token_guard = HandleGuard(current_token);

        let mut logon_sid_bytes = get_logon_sid_bytes(current_token)?;
        let logon_sid = PSID(logon_sid_bytes.as_mut_ptr().cast());
        let world_sid = WorldSid::new()?;
        let mut restricting_sids = vec![SID_AND_ATTRIBUTES {
            Sid: restricting_sid,
            Attributes: 0,
        }];
        if restricting_sid_policy.include_logon {
            restricting_sids.push(SID_AND_ATTRIBUTES {
                Sid: logon_sid,
                Attributes: 0,
            });
        }
        if restricting_sid_policy.include_everyone {
            restricting_sids.push(SID_AND_ATTRIBUTES {
                Sid: world_sid.0,
                Attributes: 0,
            });
        }
        let mut restricted_token = HANDLE::default();
        CreateRestrictedToken(
            current_token,
            CREATE_RESTRICTED_TOKEN_FLAGS(WRITE_RESTRICTED),
            None,
            None,
            Some(&restricting_sids),
            &mut restricted_token,
        )
        .map_err(|error| format!("CreateRestrictedToken(WRITE_RESTRICTED) failed: {error}"))?;

        let mut default_dacl_sids = vec![restricting_sid];
        if restricting_sid_policy.default_dacl_logon {
            default_dacl_sids.push(logon_sid);
        }
        if restricting_sid_policy.default_dacl_everyone {
            default_dacl_sids.push(world_sid.0);
        }
        if let Err(error) = set_token_default_dacl(restricted_token, &default_dacl_sids) {
            let _ = CloseHandle(restricted_token);
            return Err(error);
        }

        Ok(restricted_token)
    }

    unsafe fn set_token_default_dacl(token: HANDLE, sids: &[PSID]) -> Result<(), String> {
        let entries = sids
            .iter()
            .copied()
            .map(|sid| explicit_access_for_sid(sid, GENERIC_ALL))
            .collect::<Vec<_>>();
        let mut new_dacl: *mut ACL = std::ptr::null_mut();
        let acl_error = SetEntriesInAclW(Some(&entries), None, &mut new_dacl);
        if acl_error.0 != 0 {
            return Err(format!(
                "SetEntriesInAclW(TokenDefaultDacl) failed: {}",
                acl_error.0
            ));
        }
        let _acl_guard = LocalMemoryGuard(HLOCAL(new_dacl.cast()));
        let mut token_dacl = TOKEN_DEFAULT_DACL {
            DefaultDacl: new_dacl,
        };
        SetTokenInformation(
            token,
            TokenDefaultDacl,
            (&mut token_dacl as *mut TOKEN_DEFAULT_DACL).cast(),
            size_of::<TOKEN_DEFAULT_DACL>() as u32,
        )
        .map_err(|error| format!("SetTokenInformation(TokenDefaultDacl) failed: {error}"))
    }

    unsafe fn get_logon_sid_bytes(token: HANDLE) -> Result<Vec<u8>, String> {
        let mut needed = 0u32;
        let _ = GetTokenInformation(token, TokenGroups, None, 0, &mut needed);
        if needed == 0 {
            return Err("GetTokenInformation(TokenGroups) did not report buffer size".to_string());
        }
        let mut buffer = vec![0u8; needed as usize];
        GetTokenInformation(
            token,
            TokenGroups,
            Some(buffer.as_mut_ptr().cast::<c_void>()),
            needed,
            &mut needed,
        )
        .map_err(|error| format!("GetTokenInformation(TokenGroups) failed: {error}"))?;

        let groups = buffer.as_ptr().cast::<TOKEN_GROUPS>();
        let group_count = (*groups).GroupCount as usize;
        let first_group = (*groups).Groups.as_ptr();
        for index in 0..group_count {
            let group = *first_group.add(index);
            if (group.Attributes & SE_GROUP_LOGON_ID) == SE_GROUP_LOGON_ID {
                let sid_len = GetLengthSid(group.Sid) as u32;
                let mut sid_bytes = vec![0u8; sid_len as usize];
                CopySid(sid_len, PSID(sid_bytes.as_mut_ptr().cast()), group.Sid)
                    .map_err(|error| format!("CopySid(logon SID) failed: {error}"))?;
                return Ok(sid_bytes);
            }
        }
        Err("current token does not contain a logon SID".to_string())
    }

    unsafe fn create_token_process(
        request: &LaunchRequest,
        token: HANDLE,
    ) -> Result<SandboxedProcess, String> {
        let stdout_file = request
            .stdout_path
            .as_deref()
            .map(create_inheritable_output_file)
            .transpose()?;
        let stderr_file = request
            .stderr_path
            .as_deref()
            .map(create_inheritable_output_file)
            .transpose()?;
        let redirect_stdio = stdout_file.is_some() || stderr_file.is_some();

        let mut startup_info: STARTUPINFOW = zeroed();
        startup_info.cb = size_of::<STARTUPINFOW>() as u32;
        let mut desktop_w = wide_null("winsta0\\default");
        startup_info.lpDesktop = PWSTR(desktop_w.as_mut_ptr());
        if redirect_stdio {
            startup_info.dwFlags |= STARTF_USESTDHANDLES;
            if let Some(file) = &stdout_file {
                startup_info.hStdOutput = HANDLE(file.as_raw_handle().cast());
            }
            if let Some(file) = &stderr_file {
                startup_info.hStdError = HANDLE(file.as_raw_handle().cast());
            }
        }

        let executable_w = wide_null(&request.executable);
        let mut command_line_w = wide_null(&build_command_line(&request.executable, &request.args));
        let cwd_w = wide_null(&request.cwd);
        let environment_block = build_environment_block(&request.env);

        let mut process_information: PROCESS_INFORMATION = zeroed();
        let creation_flags = PROCESS_CREATION_FLAGS(
            CREATE_UNICODE_ENVIRONMENT.0 | CREATE_SUSPENDED.0 | CREATE_NO_WINDOW.0,
        );

        CreateProcessAsUserW(
            token,
            PCWSTR(executable_w.as_ptr()),
            PWSTR(command_line_w.as_mut_ptr()),
            None,
            None,
            BOOL(if redirect_stdio { 1 } else { 0 }),
            creation_flags,
            environment_block
                .as_ref()
                .map(|block| block.as_ptr().cast::<c_void>()),
            PCWSTR(cwd_w.as_ptr()),
            &startup_info,
            &mut process_information,
        )
        .map_err(|error| format!("CreateProcessAsUserW write-restricted launch failed: {error}"))?;

        let mut process_guard = CreatedProcessGuard::new(process_information);
        let job_guard = HandleGuard(create_kill_on_close_job()?);
        AssignProcessToJobObject(job_guard.0, process_guard.process_handle())
            .map_err(|error| format!("AssignProcessToJobObject failed: {error}"))?;

        if ResumeThread(process_guard.thread_handle()) == u32::MAX {
            return Err("ResumeThread failed".to_string());
        }

        Ok(process_guard.into_sandboxed_process(job_guard.into_inner()))
    }

    fn create_inheritable_output_file(path: &str) -> Result<File, String> {
        if let Some(parent) = Path::new(path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create output parent for {path}: {error}"))?;
        }
        let file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(path)
            .map_err(|error| format!("failed to open output file {path}: {error}"))?;
        unsafe {
            SetHandleInformation(
                HANDLE(file.as_raw_handle().cast()),
                HANDLE_FLAG_INHERIT.0,
                HANDLE_FLAG_INHERIT,
            )
            .map_err(|error| format!("SetHandleInformation inherit failed for {path}: {error}"))?;
        }
        Ok(file)
    }

    unsafe fn create_kill_on_close_job() -> Result<HANDLE, String> {
        let job_handle = CreateJobObjectW(None, PCWSTR::null())
            .map_err(|error| format!("CreateJobObjectW failed: {error}"))?;
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job_handle,
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .map_err(|error| format!("SetInformationJobObject kill-on-close failed: {error}"))?;
        Ok(job_handle)
    }

    fn grant_write_restricted_paths(
        request: &LaunchRequest,
        restricting_sid: PSID,
    ) -> Result<(), String> {
        grant_path_access(
            &request.managed_root,
            restricting_sid,
            writable_access_mask(),
        )?;
        grant_path_access(
            &request.session_dir,
            restricting_sid,
            writable_access_mask(),
        )?;
        for path in &request.writable_paths {
            grant_path_access(path, restricting_sid, writable_access_mask())?;
        }
        if let Some(path) = &request.stdout_path {
            if let Some(parent) = Path::new(path).parent() {
                grant_path_access(
                    &parent.to_string_lossy(),
                    restricting_sid,
                    writable_access_mask(),
                )?;
            }
        }
        if let Some(path) = &request.stderr_path {
            if let Some(parent) = Path::new(path).parent() {
                grant_path_access(
                    &parent.to_string_lossy(),
                    restricting_sid,
                    writable_access_mask(),
                )?;
            }
        }
        Ok(())
    }

    fn writable_access_mask() -> u32 {
        FILE_GENERIC_READ.0
            | FILE_GENERIC_EXECUTE.0
            | FILE_GENERIC_WRITE.0
            | DELETE.0
            | FILE_DELETE_CHILD.0
    }

    fn grant_path_access(path: &str, sid: PSID, access_mask: u32) -> Result<(), String> {
        if !Path::new(path).exists() {
            std::fs::create_dir_all(path)
                .map_err(|error| format!("failed to create ACL target {path}: {error}"))?;
        }

        let path_w = wide_null(path);
        unsafe {
            let mut old_dacl: *mut ACL = std::ptr::null_mut();
            let mut security_descriptor = windows::Win32::Security::PSECURITY_DESCRIPTOR::default();
            let get_error = GetNamedSecurityInfoW(
                PCWSTR(path_w.as_ptr()),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                None,
                None,
                Some(&mut old_dacl),
                None,
                &mut security_descriptor,
            );
            if get_error.0 != 0 {
                return Err(format!(
                    "GetNamedSecurityInfoW failed for {path}: {}",
                    get_error.0
                ));
            }
            let _sd_guard = LocalMemoryGuard(HLOCAL(security_descriptor.0));

            let mut explicit_access = EXPLICIT_ACCESS_W::default();
            explicit_access.grfAccessPermissions = access_mask;
            explicit_access.grfAccessMode = GRANT_ACCESS;
            explicit_access.grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT;
            BuildTrusteeWithSidW(&mut explicit_access.Trustee, sid);

            let mut new_dacl: *mut ACL = std::ptr::null_mut();
            let acl_error =
                SetEntriesInAclW(Some(&[explicit_access]), Some(old_dacl), &mut new_dacl);
            if acl_error.0 != 0 {
                return Err(format!(
                    "SetEntriesInAclW failed for {path}: {}",
                    acl_error.0
                ));
            }
            let _acl_guard = LocalMemoryGuard(HLOCAL(new_dacl.cast()));

            let set_error = SetNamedSecurityInfoW(
                PCWSTR(path_w.as_ptr()),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                PSID::default(),
                PSID::default(),
                Some(new_dacl),
                None,
            );
            if set_error.0 != 0 {
                return Err(format!(
                    "SetNamedSecurityInfoW failed for {path}: {}",
                    set_error.0
                ));
            }
        }
        Ok(())
    }

    unsafe fn explicit_access_for_sid(sid: PSID, access_mask: u32) -> EXPLICIT_ACCESS_W {
        let mut access = EXPLICIT_ACCESS_W::default();
        access.grfAccessPermissions = access_mask;
        access.grfAccessMode = GRANT_ACCESS;
        access.grfInheritance = Default::default();
        BuildTrusteeWithSidW(&mut access.Trustee, sid);
        access
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

    fn build_environment_block(
        env: &std::collections::BTreeMap<String, String>,
    ) -> Option<Vec<u16>> {
        if env.is_empty() {
            return None;
        }
        let mut block = Vec::<u16>::new();
        for (key, value) in env {
            block.extend(format!("{key}={value}").encode_utf16());
            block.push(0);
        }
        block.push(0);
        Some(block)
    }

    fn wide_null(value: &str) -> Vec<u16> {
        std::ffi::OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn restricting_sid_parts(managed_root: &str) -> (u32, u32, u32, u32) {
        let normalized = managed_root.to_ascii_lowercase();
        let h1 = fnv1a64(normalized.as_bytes());
        let h2 = fnv1a64(format!("officeagent:{normalized}").as_bytes());
        (
            ((h1 >> 32) as u32) | 1,
            (h1 as u32) | 1,
            ((h2 >> 32) as u32) | 1,
            (h2 as u32) | 1,
        )
    }

    fn fnv1a64(bytes: &[u8]) -> u64 {
        let mut hash = 0xcbf2_9ce4_8422_2325u64;
        for byte in bytes {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        hash
    }

    struct RestrictingSidPolicy {
        include_logon: bool,
        include_everyone: bool,
        default_dacl_logon: bool,
        default_dacl_everyone: bool,
    }

    impl RestrictingSidPolicy {
        fn powershell_compat() -> Self {
            Self {
                include_logon: true,
                include_everyone: true,
                default_dacl_logon: true,
                default_dacl_everyone: true,
            }
        }

        fn strict_file_ops() -> Self {
            Self {
                include_logon: false,
                include_everyone: false,
                default_dacl_logon: false,
                default_dacl_everyone: false,
            }
        }
    }

    struct WorldSid(PSID);

    impl WorldSid {
        fn new() -> Result<Self, String> {
            let mut sid = PSID::default();
            unsafe {
                AllocateAndInitializeSid(
                    &SECURITY_WORLD_SID_AUTHORITY,
                    1,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    &mut sid,
                )
                .map_err(|error| {
                    format!("AllocateAndInitializeSid(Everyone SID) failed: {error}")
                })?;
            }
            Ok(Self(sid))
        }
    }

    impl Drop for WorldSid {
        fn drop(&mut self) {
            unsafe {
                let _ = FreeSid(self.0);
            }
        }
    }

    struct RestrictingSid(PSID);

    impl RestrictingSid {
        fn for_managed_root(managed_root: &str) -> Result<Self, String> {
            let (a, b, c, d) = restricting_sid_parts(managed_root);
            let mut sid = PSID::default();
            unsafe {
                AllocateAndInitializeSid(
                    &SECURITY_NT_AUTHORITY,
                    5,
                    21,
                    a,
                    b,
                    c,
                    d,
                    0,
                    0,
                    0,
                    &mut sid,
                )
                .map_err(|error| {
                    format!("AllocateAndInitializeSid(OfficeAgent restricting SID) failed: {error}")
                })?;
            }
            Ok(Self(sid))
        }

        fn sid(&self) -> PSID {
            self.0
        }
    }

    impl Drop for RestrictingSid {
        fn drop(&mut self) {
            unsafe {
                let _ = FreeSid(self.0);
            }
        }
    }

    struct CreatedProcessGuard {
        process_information: PROCESS_INFORMATION,
        terminate_on_drop: bool,
    }

    impl CreatedProcessGuard {
        fn new(process_information: PROCESS_INFORMATION) -> Self {
            Self {
                process_information,
                terminate_on_drop: true,
            }
        }

        fn process_handle(&self) -> HANDLE {
            self.process_information.hProcess
        }

        fn thread_handle(&self) -> HANDLE {
            self.process_information.hThread
        }

        fn into_sandboxed_process(&mut self, job_handle: HANDLE) -> SandboxedProcess {
            self.terminate_on_drop = false;
            let process = SandboxedProcess {
                process_handle: self.process_information.hProcess,
                thread_handle: self.process_information.hThread,
                job_handle,
                process_id: self.process_information.dwProcessId,
            };
            self.process_information.hProcess = HANDLE::default();
            self.process_information.hThread = HANDLE::default();
            process
        }
    }

    impl Drop for CreatedProcessGuard {
        fn drop(&mut self) {
            unsafe {
                if !self.process_information.hProcess.is_invalid() {
                    if self.terminate_on_drop {
                        let _ = TerminateProcess(self.process_information.hProcess, 1);
                    }
                    let _ = CloseHandle(self.process_information.hProcess);
                }
                if !self.process_information.hThread.is_invalid() {
                    let _ = CloseHandle(self.process_information.hThread);
                }
            }
        }
    }

    struct SandboxedProcess {
        process_handle: HANDLE,
        thread_handle: HANDLE,
        job_handle: HANDLE,
        process_id: u32,
    }

    impl Drop for SandboxedProcess {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.thread_handle);
                let _ = CloseHandle(self.process_handle);
                let _ = CloseHandle(self.job_handle);
            }
        }
    }

    struct HandleGuard(HANDLE);

    impl HandleGuard {
        fn into_inner(self) -> HANDLE {
            let handle = self.0;
            std::mem::forget(self);
            handle
        }
    }

    impl Drop for HandleGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    struct LocalMemoryGuard(HLOCAL);

    impl Drop for LocalMemoryGuard {
        fn drop(&mut self) {
            if !self.0.is_invalid() {
                unsafe {
                    let _ = LocalFree(self.0);
                }
            }
        }
    }
}
