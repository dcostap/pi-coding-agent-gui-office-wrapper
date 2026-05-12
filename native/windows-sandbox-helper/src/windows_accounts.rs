#![cfg(windows)]

//! Local user/group helpers adapted from Codex `sandbox_users.rs`, with the
//! OfficeAgent one-user model and reset support.

use crate::constants::{SANDBOX_USERNAME, SANDBOX_USERS_GROUP, SANDBOX_USERS_GROUP_COMMENT};
use rand::rngs::OsRng;
use rand::RngCore;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use windows_sys::Win32::Foundation::{GetLastError, LocalFree, ERROR_INSUFFICIENT_BUFFER};
use windows_sys::Win32::NetworkManagement::NetManagement::{
    NERR_Success, NetApiBufferFree, NetLocalGroupAdd, NetLocalGroupAddMembers, NetLocalGroupDel,
    NetLocalGroupDelMembers, NetUserAdd, NetUserDel, NetUserGetInfo, NetUserSetInfo,
    LOCALGROUP_INFO_1, LOCALGROUP_MEMBERS_INFO_3, UF_DONT_EXPIRE_PASSWD, UF_SCRIPT, USER_INFO_1,
    USER_INFO_1003, USER_PRIV_USER,
};
use windows_sys::Win32::Security::Authentication::Identity::{
    LsaAddAccountRights, LsaClose, LsaNtStatusToWinError, LsaOpenPolicy, LSA_OBJECT_ATTRIBUTES,
    LSA_UNICODE_STRING, POLICY_CREATE_ACCOUNT, POLICY_LOOKUP_NAMES,
};
use windows_sys::Win32::Security::Authorization::ConvertStringSidToSidW;
use windows_sys::Win32::Security::{LookupAccountNameW, LookupAccountSidW, SID_NAME_USE};

const NERR_SUCCESS: u32 = NERR_Success;
const ERROR_ALIAS_EXISTS: u32 = 1379;
const ERROR_MEMBER_IN_ALIAS: u32 = 1378;
const ERROR_NO_SUCH_ALIAS: u32 = 1376;
const NERR_GROUP_EXISTS: u32 = 2223;
const NERR_GROUP_NOT_FOUND: u32 = 2220;
const NERR_USER_NOT_FOUND: u32 = 2221;
const SID_ADMINISTRATORS: &str = "S-1-5-32-544";
const SID_USERS: &str = "S-1-5-32-545";

pub fn ensure_sandbox_group() -> Result<(), String> {
    ensure_local_group(SANDBOX_USERS_GROUP, SANDBOX_USERS_GROUP_COMMENT)
}

pub fn sandbox_user_exists() -> Result<bool, String> {
    local_user_exists(SANDBOX_USERNAME)
}

pub fn ensure_sandbox_user(password: &str) -> Result<(), String> {
    ensure_local_user(SANDBOX_USERNAME, password)?;
    ensure_local_group_member(SANDBOX_USERS_GROUP, SANDBOX_USERNAME)?;
    if let Ok(users_group_name) = lookup_account_name_for_sid(SID_USERS) {
        ensure_local_group_member(&users_group_name, SANDBOX_USERNAME)?;
    }
    if let Ok(admins_group_name) = lookup_account_name_for_sid(SID_ADMINISTRATORS) {
        remove_local_group_member_best_effort(&admins_group_name, SANDBOX_USERNAME);
    }
    grant_account_rights(
        SANDBOX_USERNAME,
        &["SeInteractiveLogonRight", "SeBatchLogonRight"],
    )?;
    Ok(())
}

pub fn reset_sandbox_accounts() -> Result<(), String> {
    if let Ok(admins_group_name) = lookup_account_name_for_sid(SID_ADMINISTRATORS) {
        remove_local_group_member_best_effort(&admins_group_name, SANDBOX_USERNAME);
    }
    if let Ok(users_group_name) = lookup_account_name_for_sid(SID_USERS) {
        remove_local_group_member_best_effort(&users_group_name, SANDBOX_USERNAME);
    }
    remove_local_group_member_best_effort(SANDBOX_USERS_GROUP, SANDBOX_USERNAME);
    delete_local_user_if_exists(SANDBOX_USERNAME)?;
    delete_local_group_if_exists(SANDBOX_USERS_GROUP)?;
    Ok(())
}

pub fn random_password() -> String {
    const CHARS: &[u8] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+";
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes
        .iter()
        .map(|byte| CHARS[usize::from(*byte) % CHARS.len()] as char)
        .collect()
}

fn ensure_local_user(name: &str, password: &str) -> Result<(), String> {
    let name_w = wide_null(name);
    let password_w = wide_null(password);
    unsafe {
        let info = USER_INFO_1 {
            usri1_name: name_w.as_ptr() as *mut u16,
            usri1_password: password_w.as_ptr() as *mut u16,
            usri1_password_age: 0,
            usri1_priv: USER_PRIV_USER,
            usri1_home_dir: std::ptr::null_mut(),
            usri1_comment: std::ptr::null_mut(),
            usri1_flags: UF_SCRIPT | UF_DONT_EXPIRE_PASSWD,
            usri1_script_path: std::ptr::null_mut(),
        };
        let status = NetUserAdd(
            std::ptr::null(),
            1,
            &info as *const _ as *mut u8,
            std::ptr::null_mut(),
        );
        if status == NERR_Success {
            return Ok(());
        }
        if local_user_exists(name)? {
            let pw_info = USER_INFO_1003 {
                usri1003_password: password_w.as_ptr() as *mut u16,
            };
            let update = NetUserSetInfo(
                std::ptr::null(),
                name_w.as_ptr(),
                1003,
                &pw_info as *const _ as *mut u8,
                std::ptr::null_mut(),
            );
            if update == NERR_Success {
                return Ok(());
            }
            return Err(format!(
                "NetUserSetInfo failed for {name}: status={update} after NetUserAdd={status}"
            ));
        }
        Err(format!("NetUserAdd failed for {name}: status={status}"))
    }
}

fn local_user_exists(name: &str) -> Result<bool, String> {
    let name_w = wide_null(name);
    unsafe {
        let mut buffer: *mut u8 = std::ptr::null_mut();
        let status = NetUserGetInfo(std::ptr::null(), name_w.as_ptr(), 1, &mut buffer);
        if !buffer.is_null() {
            NetApiBufferFree(buffer.cast());
        }
        match status {
            NERR_SUCCESS => Ok(true),
            NERR_USER_NOT_FOUND => Ok(false),
            other => Err(format!("NetUserGetInfo failed for {name}: status={other}")),
        }
    }
}

fn ensure_local_group(name: &str, comment: &str) -> Result<(), String> {
    let name_w = wide_null(name);
    let comment_w = wide_null(comment);
    unsafe {
        let info = LOCALGROUP_INFO_1 {
            lgrpi1_name: name_w.as_ptr() as *mut u16,
            lgrpi1_comment: comment_w.as_ptr() as *mut u16,
        };
        let mut parm_err = 0u32;
        let status = NetLocalGroupAdd(
            std::ptr::null(),
            1,
            &info as *const _ as *mut u8,
            &mut parm_err,
        );
        match status {
            NERR_SUCCESS | ERROR_ALIAS_EXISTS | NERR_GROUP_EXISTS => Ok(()),
            other => Err(format!(
                "NetLocalGroupAdd failed for {name}: status={other}, parm_err={parm_err}"
            )),
        }
    }
}

fn ensure_local_group_member(group_name: &str, member_name: &str) -> Result<(), String> {
    let group_w = wide_null(group_name);
    let member_w = wide_null(member_name);
    unsafe {
        let member = LOCALGROUP_MEMBERS_INFO_3 {
            lgrmi3_domainandname: member_w.as_ptr() as *mut u16,
        };
        let status = NetLocalGroupAddMembers(
            std::ptr::null(),
            group_w.as_ptr(),
            3,
            &member as *const _ as *mut u8,
            1,
        );
        match status {
            NERR_SUCCESS | ERROR_MEMBER_IN_ALIAS => Ok(()),
            other => Err(format!(
                "NetLocalGroupAddMembers failed for group={group_name} member={member_name}: status={other}"
            )),
        }
    }
}

fn remove_local_group_member_best_effort(group_name: &str, member_name: &str) {
    let group_w = wide_null(group_name);
    let member_w = wide_null(member_name);
    unsafe {
        let member = LOCALGROUP_MEMBERS_INFO_3 {
            lgrmi3_domainandname: member_w.as_ptr() as *mut u16,
        };
        let _ = NetLocalGroupDelMembers(
            std::ptr::null(),
            group_w.as_ptr(),
            3,
            &member as *const _ as *mut u8,
            1,
        );
    }
}

fn delete_local_user_if_exists(name: &str) -> Result<(), String> {
    let name_w = wide_null(name);
    unsafe {
        let status = NetUserDel(std::ptr::null(), name_w.as_ptr());
        match status {
            NERR_SUCCESS | NERR_USER_NOT_FOUND => Ok(()),
            other => Err(format!("NetUserDel failed for {name}: status={other}")),
        }
    }
}

fn delete_local_group_if_exists(name: &str) -> Result<(), String> {
    let name_w = wide_null(name);
    unsafe {
        let status = NetLocalGroupDel(std::ptr::null(), name_w.as_ptr());
        match status {
            NERR_SUCCESS | NERR_GROUP_NOT_FOUND | ERROR_NO_SUCH_ALIAS => Ok(()),
            other => Err(format!(
                "NetLocalGroupDel failed for {name}: status={other}"
            )),
        }
    }
}

fn grant_account_rights(account_name: &str, rights: &[&str]) -> Result<(), String> {
    let mut sid = lookup_account_sid(account_name)?;
    let policy = open_lsa_policy()?;
    let _policy_guard = LsaPolicyGuard(policy);
    let mut right_names = rights
        .iter()
        .map(|right| wide_null(*right))
        .collect::<Vec<_>>();
    let lsa_rights = right_names
        .iter_mut()
        .map(|wide| LSA_UNICODE_STRING {
            Length: ((wide.len() - 1) * 2) as u16,
            MaximumLength: (wide.len() * 2) as u16,
            Buffer: wide.as_mut_ptr(),
        })
        .collect::<Vec<_>>();
    let status = unsafe {
        LsaAddAccountRights(
            policy,
            sid.as_mut_ptr().cast::<std::ffi::c_void>(),
            lsa_rights.as_ptr(),
            lsa_rights.len() as u32,
        )
    };
    if status != 0 {
        return Err(format!(
            "LsaAddAccountRights failed for {account_name}: ntstatus={status} win32={}",
            unsafe { LsaNtStatusToWinError(status) }
        ));
    }
    Ok(())
}

fn lookup_account_sid(name: &str) -> Result<Vec<u8>, String> {
    let name_w = wide_null(name);
    let mut sid = Vec::<u8>::new();
    let mut sid_len = 0u32;
    let mut domain = Vec::<u16>::new();
    let mut domain_len = 0u32;
    let mut use_type: SID_NAME_USE = 0;
    loop {
        let ok = unsafe {
            LookupAccountNameW(
                std::ptr::null(),
                name_w.as_ptr(),
                sid.as_mut_ptr().cast::<std::ffi::c_void>(),
                &mut sid_len,
                domain.as_mut_ptr(),
                &mut domain_len,
                &mut use_type,
            )
        };
        if ok != 0 {
            unsafe { sid.set_len(sid_len as usize) };
            return Ok(sid);
        }
        let error = unsafe { GetLastError() };
        if error == ERROR_INSUFFICIENT_BUFFER {
            sid.resize(sid_len as usize, 0);
            domain.resize(domain_len as usize, 0);
            continue;
        }
        return Err(format!("LookupAccountNameW failed for {name}: {error}"));
    }
}

fn open_lsa_policy() -> Result<isize, String> {
    let mut attributes = LSA_OBJECT_ATTRIBUTES {
        Length: std::mem::size_of::<LSA_OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: std::ptr::null_mut(),
        ObjectName: std::ptr::null_mut(),
        Attributes: 0,
        SecurityDescriptor: std::ptr::null_mut(),
        SecurityQualityOfService: std::ptr::null_mut(),
    };
    let mut handle = 0isize;
    let status = unsafe {
        LsaOpenPolicy(
            std::ptr::null(),
            &mut attributes,
            (POLICY_CREATE_ACCOUNT | POLICY_LOOKUP_NAMES) as u32,
            &mut handle,
        )
    };
    if status != 0 {
        return Err(format!(
            "LsaOpenPolicy failed: ntstatus={status} win32={}",
            unsafe { LsaNtStatusToWinError(status) }
        ));
    }
    Ok(handle)
}

struct LsaPolicyGuard(isize);

impl Drop for LsaPolicyGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = LsaClose(self.0);
        }
    }
}

fn lookup_account_name_for_sid(sid_str: &str) -> Result<String, String> {
    let sid_w = wide_null(sid_str);
    let mut psid: *mut std::ffi::c_void = std::ptr::null_mut();
    if unsafe { ConvertStringSidToSidW(sid_w.as_ptr(), &mut psid) } == 0 {
        return Err(format!(
            "ConvertStringSidToSidW failed for {sid_str}: {}",
            unsafe { GetLastError() }
        ));
    }

    let mut name_len = 0u32;
    let mut domain_len = 0u32;
    let mut use_type: SID_NAME_USE = 0;
    let preflight = unsafe {
        LookupAccountSidW(
            std::ptr::null(),
            psid,
            std::ptr::null_mut(),
            &mut name_len,
            std::ptr::null_mut(),
            &mut domain_len,
            &mut use_type,
        )
    };
    if preflight == 0 {
        let error = unsafe { GetLastError() };
        if error != ERROR_INSUFFICIENT_BUFFER {
            unsafe {
                LocalFree(psid.cast());
            }
            return Err(format!(
                "LookupAccountSidW preflight failed for {sid_str}: {error}"
            ));
        }
    }

    let mut name_buf = vec![0u16; name_len as usize];
    let mut domain_buf = vec![0u16; domain_len as usize];
    let ok = unsafe {
        LookupAccountSidW(
            std::ptr::null(),
            psid,
            name_buf.as_mut_ptr(),
            &mut name_len,
            domain_buf.as_mut_ptr(),
            &mut domain_len,
            &mut use_type,
        )
    };
    unsafe {
        LocalFree(psid.cast());
    }
    if ok == 0 {
        return Err(format!(
            "LookupAccountSidW failed for {sid_str}: {}",
            unsafe { GetLastError() }
        ));
    }
    Ok(String::from_utf16_lossy(&name_buf)
        .trim_end_matches('\0')
        .to_string())
}

pub fn wide_null(value: impl AsRef<OsStr>) -> Vec<u16> {
    value
        .as_ref()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}
