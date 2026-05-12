#![cfg(windows)]

use crate::windows_accounts::wide_null;
use std::thread;
use std::time::Duration;
use windows_sys::Win32::Foundation::{GetLastError, ERROR_SERVICE_ALREADY_RUNNING};
use windows_sys::Win32::System::Services::{
    CloseServiceHandle, OpenSCManagerW, OpenServiceW, QueryServiceStatus, StartServiceW,
    SC_MANAGER_CONNECT, SERVICE_QUERY_STATUS, SERVICE_RUNNING, SERVICE_START,
    SERVICE_START_PENDING, SERVICE_STATUS,
};

pub fn ensure_secondary_logon_running() -> Result<(), String> {
    ensure_service_running("seclogon")
}

pub fn secondary_logon_running() -> Result<bool, String> {
    service_running("seclogon")
}

fn ensure_service_running(service_name: &str) -> Result<(), String> {
    let service = open_service(service_name, SERVICE_QUERY_STATUS | SERVICE_START)?;
    let _service_guard = ServiceHandleGuard(service);
    if query_running(service)? {
        return Ok(());
    }
    let ok = unsafe { StartServiceW(service, 0, std::ptr::null()) };
    if ok == 0 {
        let error = unsafe { GetLastError() };
        if error != ERROR_SERVICE_ALREADY_RUNNING {
            return Err(format!("StartServiceW({service_name}) failed: {error}"));
        }
    }
    for _ in 0..20 {
        if query_running(service)? {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err(format!(
        "service {service_name} did not reach running state"
    ))
}

fn service_running(service_name: &str) -> Result<bool, String> {
    let service = open_service(service_name, SERVICE_QUERY_STATUS)?;
    let _service_guard = ServiceHandleGuard(service);
    query_running(service)
}

fn open_service(service_name: &str, access: u32) -> Result<*mut std::ffi::c_void, String> {
    let manager = unsafe { OpenSCManagerW(std::ptr::null(), std::ptr::null(), SC_MANAGER_CONNECT) };
    if manager.is_null() {
        return Err(format!("OpenSCManagerW failed: {}", unsafe {
            GetLastError()
        }));
    }
    let _manager_guard = ServiceHandleGuard(manager);
    let name_w = wide_null(service_name);
    let service = unsafe { OpenServiceW(manager, name_w.as_ptr(), access) };
    if service.is_null() {
        return Err(format!("OpenServiceW({service_name}) failed: {}", unsafe {
            GetLastError()
        }));
    }
    Ok(service)
}

fn query_running(service: *mut std::ffi::c_void) -> Result<bool, String> {
    let mut status = SERVICE_STATUS {
        dwServiceType: 0,
        dwCurrentState: 0,
        dwControlsAccepted: 0,
        dwWin32ExitCode: 0,
        dwServiceSpecificExitCode: 0,
        dwCheckPoint: 0,
        dwWaitHint: 0,
    };
    let ok = unsafe { QueryServiceStatus(service, &mut status) };
    if ok == 0 {
        return Err(format!("QueryServiceStatus failed: {}", unsafe {
            GetLastError()
        }));
    }
    Ok(status.dwCurrentState == SERVICE_RUNNING || status.dwCurrentState == SERVICE_START_PENDING)
}

struct ServiceHandleGuard(*mut std::ffi::c_void);

impl Drop for ServiceHandleGuard {
    fn drop(&mut self) {
        unsafe {
            if !self.0.is_null() {
                let _ = CloseServiceHandle(self.0);
            }
        }
    }
}
