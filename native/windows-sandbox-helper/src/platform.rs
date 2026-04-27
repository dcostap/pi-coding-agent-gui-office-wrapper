use crate::protocol::{HelperResponse, LaunchRequest};
use std::path::{Path, PathBuf};

pub fn launch(request: LaunchRequest) -> HelperResponse {
    if let Err(error) = validate_launch_request(&request) {
        return HelperResponse::err(request.request_id, "INVALID_REQUEST", error);
    }

    launch_platform(request)
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
                "writable/output path must be inside managedRoot for v1 scaffold: {}",
                candidate.display()
            ));
        }
    }

    for path in &request.read_only_paths {
        if !Path::new(path).is_absolute() {
            return Err(format!("read-only grant path must be absolute: {path}"));
        }
    }

    if request.executable.trim().is_empty() {
        return Err("executable is required".to_string());
    }

    Ok(())
}

fn canonicalish(path: impl AsRef<Path>) -> PathBuf {
    // Do not require the path to exist yet; normalize enough for containment validation.
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
    match windows_sandbox::launch_appcontainer(request) {
        Ok(result) => result,
        Err(error) => HelperResponse::err(request_id, "LAUNCH_FAILED", error),
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

#[cfg(windows)]
mod windows_sandbox {
    use crate::protocol::{HelperResponse, LaunchRequest, LaunchResult};
    use std::ffi::c_void;
    use std::fs::{File, OpenOptions};
    use std::mem::{size_of, zeroed};
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::AsRawHandle;
    use std::path::Path;
    use windows::core::{w, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{
        CloseHandle, LocalFree, SetHandleInformation, BOOL, ERROR_ALREADY_EXISTS, HANDLE,
        HANDLE_FLAG_INHERIT, HLOCAL, WAIT_FAILED, WAIT_OBJECT_0, WAIT_TIMEOUT,
    };
    use windows::Win32::Security::Authorization::{
        BuildTrusteeWithSidW, GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW,
        EXPLICIT_ACCESS_W, GRANT_ACCESS, SE_FILE_OBJECT,
    };
    use windows::Win32::Security::Isolation::{
        CreateAppContainerProfile, DeriveAppContainerSidFromAppContainerName,
    };
    use windows::Win32::Security::{
        ACL, DACL_SECURITY_INFORMATION, FreeSid, PSID, SECURITY_CAPABILITIES,
        SUB_CONTAINERS_AND_OBJECTS_INHERIT,
    };
    use windows::Win32::Storage::FileSystem::{
        FILE_GENERIC_EXECUTE, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
    };
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject, TerminateJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JobObjectExtendedLimitInformation,
    };
    use windows::Win32::System::Threading::{
        CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
        InitializeProcThreadAttributeList, ResumeThread, UpdateProcThreadAttribute,
        WaitForSingleObject, CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT,
        EXTENDED_STARTUPINFO_PRESENT, INFINITE, LPPROC_THREAD_ATTRIBUTE_LIST,
        PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, PROCESS_CREATION_FLAGS, PROCESS_INFORMATION,
        STARTF_USESTDHANDLES, STARTUPINFOEXW,
    };

    pub fn launch_appcontainer(request: LaunchRequest) -> Result<HelperResponse, String> {
        std::fs::create_dir_all(&request.session_dir)
            .map_err(|error| format!("failed to create sessionDir: {error}"))?;

        let request_id = request.request_id.clone();
        let profile_name = appcontainer_profile_name(&request.managed_root);
        let appcontainer_sid = AppContainerSid::create_or_derive(&profile_name)?;

        grant_managed_root_access(&request, appcontainer_sid.0)?;

        let process = unsafe { create_sandboxed_process(&request, appcontainer_sid.0)? };
        let pid = process.process_id;
        let wait_ms = request.timeout_ms.unwrap_or(INFINITE as u64).min(INFINITE as u64) as u32;

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

    unsafe fn create_sandboxed_process(
        request: &LaunchRequest,
        appcontainer_sid: PSID,
    ) -> Result<SandboxedProcess, String> {
        let mut security_capabilities = SECURITY_CAPABILITIES {
            AppContainerSid: appcontainer_sid,
            Capabilities: std::ptr::null_mut(),
            CapabilityCount: 0,
            Reserved: 0,
        };

        let mut attribute_list_size = 0usize;
        let _ = InitializeProcThreadAttributeList(
            LPPROC_THREAD_ATTRIBUTE_LIST::default(),
            1,
            0,
            &mut attribute_list_size,
        );
        if attribute_list_size == 0 {
            return Err("InitializeProcThreadAttributeList did not report required size".to_string());
        }

        let mut attribute_storage = vec![0u8; attribute_list_size];
        let attribute_list = LPPROC_THREAD_ATTRIBUTE_LIST(attribute_storage.as_mut_ptr() as *mut c_void);
        InitializeProcThreadAttributeList(attribute_list, 1, 0, &mut attribute_list_size)
            .map_err(|error| format!("InitializeProcThreadAttributeList failed: {error}"))?;

        let _attribute_guard = ProcThreadAttributeListGuard(attribute_list);
        UpdateProcThreadAttribute(
            attribute_list,
            0,
            PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize,
            Some((&mut security_capabilities as *mut SECURITY_CAPABILITIES).cast()),
            size_of::<SECURITY_CAPABILITIES>(),
            None,
            None,
        )
        .map_err(|error| format!("UpdateProcThreadAttribute security capabilities failed: {error}"))?;

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

        let mut startup_info: STARTUPINFOEXW = zeroed();
        startup_info.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
        startup_info.lpAttributeList = attribute_list;
        if redirect_stdio {
            startup_info.StartupInfo.dwFlags |= STARTF_USESTDHANDLES;
            if let Some(file) = &stdout_file {
                startup_info.StartupInfo.hStdOutput = HANDLE(file.as_raw_handle().cast());
            }
            if let Some(file) = &stderr_file {
                startup_info.StartupInfo.hStdError = HANDLE(file.as_raw_handle().cast());
            }
        }

        let executable_w = wide_null(&request.executable);
        let mut command_line_w = wide_null(&build_command_line(&request.executable, &request.args));
        let cwd_w = wide_null(&request.cwd);
        let environment_block = build_environment_block(&request.env);

        let mut process_information: PROCESS_INFORMATION = zeroed();
        let creation_flags = PROCESS_CREATION_FLAGS(
            EXTENDED_STARTUPINFO_PRESENT.0
                | CREATE_UNICODE_ENVIRONMENT.0
                | CREATE_SUSPENDED.0
                | CREATE_NO_WINDOW.0,
        );

        CreateProcessW(
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
            (&startup_info as *const STARTUPINFOEXW).cast(),
            &mut process_information,
        )
        .map_err(|error| format!("CreateProcessW AppContainer launch failed: {error}"))?;

        let job_handle = create_kill_on_close_job()?;
        AssignProcessToJobObject(job_handle, process_information.hProcess)
            .map_err(|error| format!("AssignProcessToJobObject failed: {error}"))?;

        if ResumeThread(process_information.hThread) == u32::MAX {
            return Err("ResumeThread failed".to_string());
        }

        Ok(SandboxedProcess {
            process_handle: process_information.hProcess,
            thread_handle: process_information.hThread,
            job_handle,
            process_id: process_information.dwProcessId,
        })
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

    fn grant_managed_root_access(request: &LaunchRequest, appcontainer_sid: PSID) -> Result<(), String> {
        grant_path_access(
            &request.managed_root,
            appcontainer_sid,
            FILE_GENERIC_READ.0 | FILE_GENERIC_EXECUTE.0 | FILE_GENERIC_WRITE.0,
        )?;
        grant_path_access(
            &request.session_dir,
            appcontainer_sid,
            FILE_GENERIC_READ.0 | FILE_GENERIC_EXECUTE.0 | FILE_GENERIC_WRITE.0,
        )?;
        for path in &request.writable_paths {
            grant_path_access(
                path,
                appcontainer_sid,
                FILE_GENERIC_READ.0 | FILE_GENERIC_EXECUTE.0 | FILE_GENERIC_WRITE.0,
            )?;
        }
        for path in &request.read_only_paths {
            grant_path_access(
                path,
                appcontainer_sid,
                FILE_GENERIC_READ.0 | FILE_GENERIC_EXECUTE.0,
            )?;
        }
        Ok(())
    }

    fn grant_path_access(path: &str, appcontainer_sid: PSID, access_mask: u32) -> Result<(), String> {
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
                return Err(format!("GetNamedSecurityInfoW failed for {path}: {}", get_error.0));
            }
            let _sd_guard = LocalMemoryGuard(HLOCAL(security_descriptor.0));

            let mut explicit_access = EXPLICIT_ACCESS_W::default();
            explicit_access.grfAccessPermissions = access_mask;
            explicit_access.grfAccessMode = GRANT_ACCESS;
            explicit_access.grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT;
            BuildTrusteeWithSidW(&mut explicit_access.Trustee, appcontainer_sid);

            let mut new_dacl: *mut ACL = std::ptr::null_mut();
            let acl_error = SetEntriesInAclW(Some(&[explicit_access]), Some(old_dacl), &mut new_dacl);
            if acl_error.0 != 0 {
                return Err(format!("SetEntriesInAclW failed for {path}: {}", acl_error.0));
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
                return Err(format!("SetNamedSecurityInfoW failed for {path}: {}", set_error.0));
            }
        }
        Ok(())
    }

    fn appcontainer_profile_name(managed_root: &str) -> String {
        format!("officeagent.v1.{:016x}", fnv1a64(managed_root.to_ascii_lowercase().as_bytes()))
    }

    fn fnv1a64(bytes: &[u8]) -> u64 {
        let mut hash = 0xcbf29ce484222325u64;
        for byte in bytes {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash
    }

    fn build_command_line(executable: &str, args: &[String]) -> String {
        std::iter::once(quote_command_arg_always(executable))
            .chain(args.iter().map(|arg| quote_command_arg(arg)))
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn quote_command_arg_always(arg: &str) -> String {
        quote_command_arg_inner(arg, true)
    }

    fn quote_command_arg(arg: &str) -> String {
        quote_command_arg_inner(arg, false)
    }

    fn quote_command_arg_inner(arg: &str, always: bool) -> String {
        if always || arg.is_empty() || arg.chars().any(|ch| ch.is_whitespace() || ch == '"') {
            let mut quoted = String::from("\"");
            let mut backslashes = 0usize;
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

    fn build_environment_block(env: &std::collections::BTreeMap<String, String>) -> Option<Vec<u16>> {
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

    struct AppContainerSid(PSID);

    impl AppContainerSid {
        fn create_or_derive(profile_name: &str) -> Result<Self, String> {
            let name_w = wide_null(profile_name);
            unsafe {
                match CreateAppContainerProfile(
                    PCWSTR(name_w.as_ptr()),
                    w!("OfficeAgent Sandbox"),
                    w!("OfficeAgent managed workspace sandbox"),
                    None,
                ) {
                    Ok(sid) => Ok(Self(sid)),
                    Err(error) if error.code() == ERROR_ALREADY_EXISTS.to_hresult() => {
                        DeriveAppContainerSidFromAppContainerName(PCWSTR(name_w.as_ptr()))
                            .map(Self)
                            .map_err(|derive_error| {
                                format!("DeriveAppContainerSidFromAppContainerName failed: {derive_error}")
                            })
                    }
                    Err(error) => Err(format!("CreateAppContainerProfile failed: {error}")),
                }
            }
        }
    }

    impl Drop for AppContainerSid {
        fn drop(&mut self) {
            unsafe {
                let _ = FreeSid(self.0);
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

    struct ProcThreadAttributeListGuard(LPPROC_THREAD_ATTRIBUTE_LIST);

    impl Drop for ProcThreadAttributeListGuard {
        fn drop(&mut self) {
            unsafe {
                DeleteProcThreadAttributeList(self.0);
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
}
