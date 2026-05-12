#![cfg(windows)]

//! Hidden-user helpers adapted from Codex `hide_users.rs`.

use crate::windows_accounts::wide_null;
use std::ffi::OsStr;
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegSetValueExW, HKEY, HKEY_LOCAL_MACHINE,
    KEY_WRITE, REG_DWORD, REG_OPTION_NON_VOLATILE,
};

const USERLIST_KEY_PATH: &str =
    r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList";

pub fn hide_user_in_winlogon(username: &str) -> Result<(), String> {
    let key = create_userlist_key()?;
    let result = set_hidden_value(key, username);
    unsafe {
        RegCloseKey(key);
    }
    result
}

pub fn remove_hidden_user_value(username: &str) -> Result<(), String> {
    let key = create_userlist_key()?;
    let name_w = wide_null(OsStr::new(username));
    let status = unsafe { RegDeleteValueW(key, name_w.as_ptr()) };
    unsafe {
        RegCloseKey(key);
    }
    // 2 = ERROR_FILE_NOT_FOUND: already clean.
    if status == 0 || status == 2 {
        Ok(())
    } else {
        Err(format!(
            "RegDeleteValueW Winlogon UserList value for {username} failed: {status}"
        ))
    }
}

fn set_hidden_value(key: HKEY, username: &str) -> Result<(), String> {
    let name_w = wide_null(OsStr::new(username));
    let value = 0u32;
    let status = unsafe {
        RegSetValueExW(
            key,
            name_w.as_ptr(),
            0,
            REG_DWORD,
            &value as *const u32 as *const u8,
            std::mem::size_of_val(&value) as u32,
        )
    };
    if status == 0 {
        Ok(())
    } else {
        Err(format!(
            "RegSetValueExW Winlogon UserList value for {username} failed: {status}"
        ))
    }
}

fn create_userlist_key() -> Result<HKEY, String> {
    let key_path = wide_null(USERLIST_KEY_PATH);
    let mut key: HKEY = std::ptr::null_mut();
    let status = unsafe {
        RegCreateKeyExW(
            HKEY_LOCAL_MACHINE,
            key_path.as_ptr(),
            0,
            std::ptr::null_mut(),
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            std::ptr::null(),
            &mut key,
            std::ptr::null_mut(),
        )
    };
    if status == 0 {
        Ok(key)
    } else {
        Err(format!(
            "RegCreateKeyExW Winlogon UserList failed: {status}"
        ))
    }
}
