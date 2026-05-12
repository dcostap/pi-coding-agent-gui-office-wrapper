#![cfg(windows)]

use std::ffi::c_void;
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, LocalFree, HANDLE, HLOCAL};
use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
use windows_sys::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

pub struct CurrentUserIdentity {
    pub name: String,
    pub sid: String,
}

pub fn current_user_identity() -> Result<CurrentUserIdentity, String> {
    let sid = current_token_user_sid_string()?;
    let name = current_user_name();
    Ok(CurrentUserIdentity { name, sid })
}

fn current_user_name() -> String {
    let username = std::env::var("USERNAME").unwrap_or_else(|_| "<unknown>".to_string());
    match std::env::var("USERDOMAIN") {
        Ok(domain) if !domain.trim().is_empty() => format!("{domain}\\{username}"),
        _ => username,
    }
}

fn current_token_user_sid_string() -> Result<String, String> {
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err(format!("OpenProcessToken failed: {}", GetLastError()));
        }
        let _guard = HandleGuard(token);

        let mut needed = 0u32;
        let _ = GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut needed);
        if needed == 0 {
            return Err("GetTokenInformation(TokenUser) did not report buffer size".to_string());
        }
        let mut buffer = vec![0u8; needed as usize];
        if GetTokenInformation(
            token,
            TokenUser,
            buffer.as_mut_ptr().cast::<c_void>(),
            needed,
            &mut needed,
        ) == 0
        {
            return Err(format!(
                "GetTokenInformation(TokenUser) failed: {}",
                GetLastError()
            ));
        }
        let token_user = &*(buffer.as_ptr().cast::<TOKEN_USER>());
        sid_to_string(token_user.User.Sid)
    }
}

unsafe fn sid_to_string(sid: *mut c_void) -> Result<String, String> {
    let mut sid_string: *mut u16 = std::ptr::null_mut();
    if ConvertSidToStringSidW(sid, &mut sid_string) == 0 {
        return Err(format!("ConvertSidToStringSidW failed: {}", GetLastError()));
    }
    let mut len = 0usize;
    while *sid_string.add(len) != 0 {
        len += 1;
    }
    let result = String::from_utf16_lossy(std::slice::from_raw_parts(sid_string, len));
    LocalFree(sid_string as HLOCAL);
    Ok(result)
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
