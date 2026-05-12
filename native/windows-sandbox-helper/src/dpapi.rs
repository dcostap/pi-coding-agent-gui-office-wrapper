#![cfg(windows)]

//! DPAPI helpers adapted from Codex `windows-sandbox-rs/src/dpapi.rs`.
//! OfficeAgent uses machine scope so elevated setup and non-elevated runtime can
//! both decrypt the stored sandbox credential after filesystem ACL checks pass.

use windows_sys::Win32::Foundation::{GetLastError, LocalFree, HLOCAL};
use windows_sys::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_LOCAL_MACHINE, CRYPTPROTECT_UI_FORBIDDEN,
    CRYPT_INTEGER_BLOB,
};

fn make_blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    }
}

#[allow(clippy::unnecessary_mut_passed)]
pub fn protect_machine(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut in_blob = make_blob(data);
    let mut out_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptProtectData(
            &mut in_blob,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN | CRYPTPROTECT_LOCAL_MACHINE,
            &mut out_blob,
        )
    };
    if ok == 0 {
        return Err(format!("CryptProtectData failed: {}", unsafe {
            GetLastError()
        }));
    }
    let out =
        unsafe { std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize) }.to_vec();
    unsafe {
        if !out_blob.pbData.is_null() {
            LocalFree(out_blob.pbData as HLOCAL);
        }
    }
    Ok(out)
}

#[allow(clippy::unnecessary_mut_passed)]
pub fn unprotect_machine(blob: &[u8]) -> Result<Vec<u8>, String> {
    let mut in_blob = make_blob(blob);
    let mut out_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptUnprotectData(
            &mut in_blob,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN | CRYPTPROTECT_LOCAL_MACHINE,
            &mut out_blob,
        )
    };
    if ok == 0 {
        return Err(format!("CryptUnprotectData failed: {}", unsafe {
            GetLastError()
        }));
    }
    let out =
        unsafe { std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize) }.to_vec();
    unsafe {
        if !out_blob.pbData.is_null() {
            LocalFree(out_blob.pbData as HLOCAL);
        }
    }
    Ok(out)
}
