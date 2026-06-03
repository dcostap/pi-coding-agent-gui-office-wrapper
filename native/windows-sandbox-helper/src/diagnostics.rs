use std::collections::BTreeMap;

pub const SANDBOX_LOGON_LAUNCH_BLOCKED: &str = "SANDBOX_LOGON_LAUNCH_BLOCKED";
pub const CREATE_PROCESS_WITH_LOGON_W: &str = "CreateProcessWithLogonW";
pub const CREATE_PROCESS_WITH_TOKEN_W: &str = "CreateProcessWithTokenW";
pub const CREATE_PROCESS_AS_USER_W: &str = "CreateProcessAsUserW";
pub const HRESULT_ACCESS_DENIED: &str = "0x80070005";
pub const HRESULT_PRIVILEGE_NOT_HELD: &str = "0x80070522";

#[derive(Debug, Clone)]
pub struct ErrorDiagnostics {
    pub diagnostic_code: String,
    pub secondary_logon_likely_blocked: bool,
    pub windows_error_codes: BTreeMap<String, String>,
}

pub fn classify_error_message(message: &str) -> Option<ErrorDiagnostics> {
    let upper = message.to_ascii_uppercase();
    let lower = message.to_ascii_lowercase();
    let has_blocked_marker = upper.contains(SANDBOX_LOGON_LAUNCH_BLOCKED);
    let has_logon_launch_shape = message.contains(CREATE_PROCESS_WITH_LOGON_W)
        && message.contains(CREATE_PROCESS_WITH_TOKEN_W)
        && message.contains(CREATE_PROCESS_AS_USER_W);
    let has_known_hresult_shape =
        lower.contains(HRESULT_ACCESS_DENIED) && lower.contains(HRESULT_PRIVILEGE_NOT_HELD);

    if !has_blocked_marker && !(has_logon_launch_shape && has_known_hresult_shape) {
        return None;
    }

    let mut windows_error_codes = BTreeMap::new();
    collect_known_code(
        message,
        CREATE_PROCESS_WITH_LOGON_W,
        "createProcessWithLogonW",
        &mut windows_error_codes,
    );
    collect_known_code(
        message,
        CREATE_PROCESS_WITH_TOKEN_W,
        "createProcessWithTokenW",
        &mut windows_error_codes,
    );
    collect_known_code(
        message,
        CREATE_PROCESS_AS_USER_W,
        "createProcessAsUserW",
        &mut windows_error_codes,
    );

    Some(ErrorDiagnostics {
        diagnostic_code: SANDBOX_LOGON_LAUNCH_BLOCKED.to_string(),
        secondary_logon_likely_blocked: true,
        windows_error_codes,
    })
}

pub fn format_logon_launch_blocked_message(
    cpwl_error: &str,
    cpwl_hresult: &str,
    cpwt_error: &str,
    cpwt_hresult: &str,
    cpau_error: &str,
    cpau_hresult: &str,
) -> String {
    format!(
        "{SANDBOX_LOGON_LAUNCH_BLOCKED}: OfficeAgent could not launch the sandbox command runner as the OfficeAgentSandbox user. secondaryLogonLikelyBlocked=true; {CREATE_PROCESS_WITH_LOGON_W} HRESULT={cpwl_hresult}; {CREATE_PROCESS_WITH_TOKEN_W} HRESULT={cpwt_hresult}; {CREATE_PROCESS_AS_USER_W} HRESULT={cpau_hresult}. Details: {CREATE_PROCESS_WITH_LOGON_W} failed: {cpwl_error}; {CREATE_PROCESS_WITH_TOKEN_W} fallback failed: {cpwt_error}; {CREATE_PROCESS_AS_USER_W} fallback failed: {cpau_error}"
    )
}

fn collect_known_code(
    message: &str,
    function_name: &str,
    key: &str,
    output: &mut BTreeMap<String, String>,
) {
    let Some(function_index) = message.find(function_name) else {
        return;
    };
    let after_function = &message[function_index..];
    let lower = after_function.to_ascii_lowercase();
    for code in [HRESULT_ACCESS_DENIED, HRESULT_PRIVILEGE_NOT_HELD] {
        if lower.contains(code) {
            output.insert(key.to_string(), code.to_string());
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_uppercase_hresult_fallback_message() {
        let message = "CreateProcessWithLogonW failed: Acceso denegado. (0X80070005); CreateProcessWithTokenW fallback failed: Acceso denegado. (0X80070005); CreateProcessAsUserW fallback failed: El cliente no dispone de un privilegio requerido. (0X80070522)";

        let diagnostics = classify_error_message(message).expect("expected diagnostics");

        assert_eq!(diagnostics.diagnostic_code, SANDBOX_LOGON_LAUNCH_BLOCKED);
        assert!(diagnostics.secondary_logon_likely_blocked);
        assert_eq!(
            diagnostics
                .windows_error_codes
                .get("createProcessWithLogonW"),
            Some(&HRESULT_ACCESS_DENIED.to_string()),
        );
        assert_eq!(
            diagnostics
                .windows_error_codes
                .get("createProcessWithTokenW"),
            Some(&HRESULT_ACCESS_DENIED.to_string()),
        );
        assert_eq!(
            diagnostics.windows_error_codes.get("createProcessAsUserW"),
            Some(&HRESULT_PRIVILEGE_NOT_HELD.to_string()),
        );
    }

    #[test]
    fn classifies_formatted_blocked_message() {
        let message = format_logon_launch_blocked_message(
            "Acceso denegado. (0x80070005)",
            "0x80070005",
            "Acceso denegado. (0x80070005)",
            "0x80070005",
            "El cliente no dispone de un privilegio requerido. (0x80070522)",
            "0x80070522",
        );

        let diagnostics = classify_error_message(&message).expect("expected diagnostics");

        assert_eq!(diagnostics.diagnostic_code, SANDBOX_LOGON_LAUNCH_BLOCKED);
        assert!(diagnostics.secondary_logon_likely_blocked);
        assert_eq!(diagnostics.windows_error_codes.len(), 3);
    }
}
