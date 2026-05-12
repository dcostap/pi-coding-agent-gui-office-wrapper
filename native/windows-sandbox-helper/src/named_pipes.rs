#![cfg(windows)]

use rand::Rng;
use std::fs::File;
use std::io::{ErrorKind, Read, Write};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::FromRawHandle;
use std::thread;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{GetLastError, LocalFree, HANDLE, HLOCAL, INVALID_HANDLE_VALUE};
use windows::Win32::Security::Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW;
use windows::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};
use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
use windows::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, PIPE_READMODE_BYTE, PIPE_TYPE_BYTE, PIPE_WAIT,
};

const ERROR_PIPE_CONNECTED: u32 = 535;
const PIPE_ACCESS_INBOUND: u32 = 0x0000_0001;
const PIPE_ACCESS_OUTBOUND: u32 = 0x0000_0002;

pub struct OutputPipeServer {
    name: String,
    handle: HANDLE,
}

unsafe impl Send for OutputPipeServer {}

impl OutputPipeServer {
    pub fn create(label: &str) -> Result<Self, String> {
        let name = pipe_name(label);
        let sddl = wide_null("D:(A;;GA;;;WD)");
        let mut sd = PSECURITY_DESCRIPTOR::default();
        unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                PCWSTR(sddl.as_ptr()),
                1,
                &mut sd,
                None,
            )
        }
        .map_err(|error| {
            format!("ConvertStringSecurityDescriptorToSecurityDescriptorW failed: {error}")
        })?;
        let _sd_guard = LocalMemoryGuard(HLOCAL(sd.0));
        let mut security_attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: sd.0,
            bInheritHandle: false.into(),
        };
        let name_w = wide_null(&name);
        let handle = unsafe {
            CreateNamedPipeW(
                PCWSTR(name_w.as_ptr()),
                FILE_FLAGS_AND_ATTRIBUTES(PIPE_ACCESS_INBOUND),
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                1,
                65_536,
                65_536,
                0,
                Some(&mut security_attributes),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return Err(format!("CreateNamedPipeW failed for {name}: {}", unsafe {
                GetLastError().0
            }));
        }
        Ok(Self { name, handle })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn into_reader_thread(self) -> thread::JoinHandle<Result<Vec<u8>, String>> {
        thread::spawn(move || self.connect_and_read())
    }

    fn connect_and_read(self) -> Result<Vec<u8>, String> {
        let ok = unsafe { ConnectNamedPipe(self.handle, None) };
        if ok.is_err() {
            let error = unsafe { GetLastError().0 };
            if error != ERROR_PIPE_CONNECTED {
                return Err(format!(
                    "ConnectNamedPipe failed for {}: {error}",
                    self.name
                ));
            }
        }
        let mut file = unsafe { File::from_raw_handle(self.handle.0) };
        std::mem::forget(self);
        let mut data = Vec::new();
        file.read_to_end(&mut data)
            .map_err(|error| format!("read named pipe failed: {error}"))?;
        Ok(data)
    }
}

pub struct InputPipeServer {
    name: String,
    handle: HANDLE,
    content: Vec<u8>,
}

unsafe impl Send for InputPipeServer {}

impl InputPipeServer {
    pub fn create(label: &str, content: Vec<u8>) -> Result<Self, String> {
        let name = pipe_name(label);
        let sddl = wide_null("D:(A;;GA;;;WD)");
        let mut sd = PSECURITY_DESCRIPTOR::default();
        unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                PCWSTR(sddl.as_ptr()),
                1,
                &mut sd,
                None,
            )
        }
        .map_err(|error| {
            format!("ConvertStringSecurityDescriptorToSecurityDescriptorW failed: {error}")
        })?;
        let _sd_guard = LocalMemoryGuard(HLOCAL(sd.0));
        let mut security_attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: sd.0,
            bInheritHandle: false.into(),
        };
        let name_w = wide_null(&name);
        let handle = unsafe {
            CreateNamedPipeW(
                PCWSTR(name_w.as_ptr()),
                FILE_FLAGS_AND_ATTRIBUTES(PIPE_ACCESS_OUTBOUND),
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                1,
                65_536,
                65_536,
                0,
                Some(&mut security_attributes),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return Err(format!("CreateNamedPipeW failed for {name}: {}", unsafe {
                GetLastError().0
            }));
        }
        Ok(Self {
            name,
            handle,
            content,
        })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn into_writer_thread(self) -> thread::JoinHandle<Result<(), String>> {
        thread::spawn(move || self.connect_and_write())
    }

    fn connect_and_write(self) -> Result<(), String> {
        let ok = unsafe { ConnectNamedPipe(self.handle, None) };
        if ok.is_err() {
            let error = unsafe { GetLastError().0 };
            if error != ERROR_PIPE_CONNECTED {
                return Err(format!(
                    "ConnectNamedPipe failed for {}: {error}",
                    self.name
                ));
            }
        }
        let mut file = unsafe { File::from_raw_handle(self.handle.0) };
        let content = self.content.clone();
        std::mem::forget(self);
        match file.write_all(&content) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::BrokenPipe => Ok(()),
            Err(error) => Err(format!("write named pipe failed: {error}")),
        }
    }
}

impl Drop for InputPipeServer {
    fn drop(&mut self) {
        if !self.handle.is_invalid() {
            unsafe {
                let _ = windows::Win32::Foundation::CloseHandle(self.handle);
            }
        }
    }
}

impl Drop for OutputPipeServer {
    fn drop(&mut self) {
        if !self.handle.is_invalid() {
            unsafe {
                let _ = windows::Win32::Foundation::CloseHandle(self.handle);
            }
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

fn pipe_name(label: &str) -> String {
    let mut rng = rand::thread_rng();
    format!(
        r"\\.\pipe\officeagent-runner-{:x}-{}",
        rng.gen::<u128>(),
        label
    )
}

fn wide_null(value: &str) -> Vec<u16> {
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}
