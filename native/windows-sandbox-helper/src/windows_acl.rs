#![cfg(windows)]

use crate::constants;
use crate::windows_accounts::wide_null;
use std::path::Path;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{LocalFree, HLOCAL};
use windows::Win32::Security::Authorization::{
    BuildTrusteeWithNameW, BuildTrusteeWithSidW, ConvertStringSidToSidW, GetNamedSecurityInfoW,
    SetEntriesInAclW, SetNamedSecurityInfoW, EXPLICIT_ACCESS_W, GRANT_ACCESS, SET_ACCESS,
    SE_FILE_OBJECT,
};
use windows::Win32::Security::{
    ACL, DACL_SECURITY_INFORMATION, OBJECT_INHERIT_ACE, PROTECTED_DACL_SECURITY_INFORMATION, PSID,
    SUB_CONTAINERS_AND_OBJECTS_INHERIT,
};
use windows::Win32::Storage::FileSystem::{
    DELETE, FILE_DELETE_CHILD, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
    FILE_TRAVERSE, SYNCHRONIZE,
};

const GENERIC_ALL: u32 = 0x1000_0000;
const SID_ADMINISTRATORS: &str = "S-1-5-32-544";
const SID_SYSTEM: &str = "S-1-5-18";

pub fn lock_down_setup_dirs(managed_root: &Path, real_user_sid: &str) -> Result<(), String> {
    let sandbox_dir = constants::sandbox_dir(managed_root);
    let secrets_dir = constants::sandbox_secrets_dir(managed_root);
    std::fs::create_dir_all(&sandbox_dir).map_err(|error| {
        format!(
            "failed to create sandbox dir for ACL lockdown {}: {error}",
            sandbox_dir.display()
        )
    })?;
    std::fs::create_dir_all(&secrets_dir).map_err(|error| {
        format!(
            "failed to create sandbox secrets dir for ACL lockdown {}: {error}",
            secrets_dir.display()
        )
    })?;

    let real_user = SidPtr::from_string(real_user_sid)?;
    let administrators = SidPtr::from_string(SID_ADMINISTRATORS)?;
    let system = SidPtr::from_string(SID_SYSTEM)?;
    let allow_full = [real_user.sid(), administrators.sid(), system.sid()];

    set_protected_full_control_dacl(&sandbox_dir, &allow_full)?;
    set_protected_full_control_dacl(&secrets_dir, &allow_full)?;
    Ok(())
}

pub fn grant_sandbox_group_read_execute(path: &Path) -> Result<(), String> {
    let group_w = wide_null(constants::SANDBOX_USERS_GROUP);
    grant_named_trustee_access(
        path,
        PCWSTR(group_w.as_ptr()),
        FILE_GENERIC_READ.0 | FILE_GENERIC_EXECUTE.0,
        true,
    )
}

pub fn grant_sandbox_group_traverse(path: &Path) -> Result<(), String> {
    let group_w = wide_null(constants::SANDBOX_USERS_GROUP);
    grant_named_trustee_access(
        path,
        PCWSTR(group_w.as_ptr()),
        FILE_TRAVERSE.0 | SYNCHRONIZE.0,
        false,
    )
}

pub fn grant_sandbox_group_modify(path: &Path) -> Result<(), String> {
    let group_w = wide_null(constants::SANDBOX_USERS_GROUP);
    grant_named_trustee_access(
        path,
        PCWSTR(group_w.as_ptr()),
        FILE_GENERIC_READ.0
            | FILE_GENERIC_EXECUTE.0
            | FILE_GENERIC_WRITE.0
            | DELETE.0
            | FILE_DELETE_CHILD.0,
        true,
    )
}

pub fn grant_modify_to_sid_string(path: &Path, sid_string: &str) -> Result<(), String> {
    let sid = SidPtr::from_string(sid_string)?;
    grant_sid_access(
        path,
        sid.sid(),
        FILE_GENERIC_READ.0
            | FILE_GENERIC_EXECUTE.0
            | FILE_GENERIC_WRITE.0
            | DELETE.0
            | FILE_DELETE_CHILD.0,
    )
}

fn grant_named_trustee_access(
    path: &Path,
    trustee_name: PCWSTR,
    access_mask: u32,
    inherit: bool,
) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("ACL target does not exist: {}", path.display()));
    }
    let mut path_w = wide_null(path.as_os_str());
    unsafe {
        let mut old_dacl: *mut ACL = std::ptr::null_mut();
        let mut security_descriptor = windows::Win32::Security::PSECURITY_DESCRIPTOR::default();
        let get_error = GetNamedSecurityInfoW(
            PCWSTR(path_w.as_mut_ptr()),
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
                "GetNamedSecurityInfoW failed for {}: {}",
                path.display(),
                get_error.0
            ));
        }
        let _sd_guard = LocalMemoryGuard(HLOCAL(security_descriptor.0));

        let mut explicit_access = EXPLICIT_ACCESS_W::default();
        explicit_access.grfAccessPermissions = access_mask;
        explicit_access.grfAccessMode = SET_ACCESS;
        explicit_access.grfInheritance = if inherit {
            SUB_CONTAINERS_AND_OBJECTS_INHERIT
                | OBJECT_INHERIT_ACE
                | windows::Win32::Security::CONTAINER_INHERIT_ACE
        } else {
            windows::Win32::Security::ACE_FLAGS(0)
        };
        BuildTrusteeWithNameW(&mut explicit_access.Trustee, trustee_name);

        let mut new_dacl: *mut ACL = std::ptr::null_mut();
        let acl_error = SetEntriesInAclW(Some(&[explicit_access]), Some(old_dacl), &mut new_dacl);
        if acl_error.0 != 0 {
            return Err(format!(
                "SetEntriesInAclW failed for {}: {}",
                path.display(),
                acl_error.0
            ));
        }
        let _acl_guard = LocalMemoryGuard(HLOCAL(new_dacl.cast()));
        let set_error = SetNamedSecurityInfoW(
            PCWSTR(path_w.as_mut_ptr()),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            PSID::default(),
            PSID::default(),
            Some(new_dacl),
            None,
        );
        if set_error.0 != 0 {
            return Err(format!(
                "SetNamedSecurityInfoW failed for {}: {}",
                path.display(),
                set_error.0
            ));
        }
    }
    Ok(())
}

fn grant_sid_access(path: &Path, sid: PSID, access_mask: u32) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("ACL target does not exist: {}", path.display()));
    }
    let mut path_w = wide_null(path.as_os_str());
    unsafe {
        let mut old_dacl: *mut ACL = std::ptr::null_mut();
        let mut security_descriptor = windows::Win32::Security::PSECURITY_DESCRIPTOR::default();
        let get_error = GetNamedSecurityInfoW(
            PCWSTR(path_w.as_mut_ptr()),
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
                "GetNamedSecurityInfoW failed for {}: {}",
                path.display(),
                get_error.0
            ));
        }
        let _sd_guard = LocalMemoryGuard(HLOCAL(security_descriptor.0));

        let mut explicit_access = EXPLICIT_ACCESS_W::default();
        explicit_access.grfAccessPermissions = access_mask;
        explicit_access.grfAccessMode = SET_ACCESS;
        explicit_access.grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT
            | OBJECT_INHERIT_ACE
            | windows::Win32::Security::CONTAINER_INHERIT_ACE;
        BuildTrusteeWithSidW(&mut explicit_access.Trustee, sid);

        let mut new_dacl: *mut ACL = std::ptr::null_mut();
        let acl_error = SetEntriesInAclW(Some(&[explicit_access]), Some(old_dacl), &mut new_dacl);
        if acl_error.0 != 0 {
            return Err(format!(
                "SetEntriesInAclW failed for {}: {}",
                path.display(),
                acl_error.0
            ));
        }
        let _acl_guard = LocalMemoryGuard(HLOCAL(new_dacl.cast()));
        let set_error = SetNamedSecurityInfoW(
            PCWSTR(path_w.as_mut_ptr()),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            PSID::default(),
            PSID::default(),
            Some(new_dacl),
            None,
        );
        if set_error.0 != 0 {
            return Err(format!(
                "SetNamedSecurityInfoW failed for {}: {}",
                path.display(),
                set_error.0
            ));
        }
    }
    Ok(())
}

fn set_protected_full_control_dacl(path: &Path, sids: &[PSID]) -> Result<(), String> {
    let mut entries = sids
        .iter()
        .copied()
        .map(explicit_full_control_entry)
        .collect::<Vec<_>>();
    let mut new_dacl: *mut ACL = std::ptr::null_mut();
    let acl_error = unsafe { SetEntriesInAclW(Some(&mut entries), None, &mut new_dacl) };
    if acl_error.0 != 0 {
        return Err(format!(
            "SetEntriesInAclW failed for {}: {}",
            path.display(),
            acl_error.0
        ));
    }
    let _acl_guard = LocalMemoryGuard(HLOCAL(new_dacl.cast()));

    let mut path_w = wide_null(path.as_os_str());
    let set_error = unsafe {
        SetNamedSecurityInfoW(
            PCWSTR(path_w.as_mut_ptr()),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            PSID::default(),
            PSID::default(),
            Some(new_dacl),
            None,
        )
    };
    if set_error.0 != 0 {
        return Err(format!(
            "SetNamedSecurityInfoW protected DACL failed for {}: {}",
            path.display(),
            set_error.0
        ));
    }
    Ok(())
}

fn explicit_full_control_entry(sid: PSID) -> EXPLICIT_ACCESS_W {
    let mut access = EXPLICIT_ACCESS_W::default();
    access.grfAccessPermissions = GENERIC_ALL;
    access.grfAccessMode = GRANT_ACCESS;
    access.grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT
        | OBJECT_INHERIT_ACE
        | windows::Win32::Security::CONTAINER_INHERIT_ACE;
    unsafe {
        BuildTrusteeWithSidW(&mut access.Trustee, sid);
    }
    access
}

struct SidPtr(PSID);

impl SidPtr {
    fn from_string(sid: &str) -> Result<Self, String> {
        let sid_w = wide_null(sid);
        let mut psid = PSID::default();
        unsafe { ConvertStringSidToSidW(PCWSTR(sid_w.as_ptr()), &mut psid) }
            .map_err(|error| format!("ConvertStringSidToSidW failed for {sid}: {error}"))?;
        Ok(Self(psid))
    }

    fn sid(&self) -> PSID {
        self.0
    }
}

impl Drop for SidPtr {
    fn drop(&mut self) {
        unsafe {
            if !self.0.is_invalid() {
                let _ = LocalFree(HLOCAL(self.0 .0));
            }
        }
    }
}

struct LocalMemoryGuard(HLOCAL);

impl Drop for LocalMemoryGuard {
    fn drop(&mut self) {
        unsafe {
            if !self.0.is_invalid() {
                let _ = LocalFree(self.0);
            }
        }
    }
}
