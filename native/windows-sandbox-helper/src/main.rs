mod protocol;
mod platform;

use crate::protocol::{HelperRequest, HelperResponse};
use std::io::{self, Read};

fn main() {
    let response = match run() {
        Ok(response) => response,
        Err(error) => HelperResponse::err(None, "HELPER_ERROR", error.to_string()),
    };

    println!(
        "{}",
        serde_json::to_string(&response).unwrap_or_else(|error| {
            format!(
                r#"{{"ok":false,"error":{{"code":"SERIALIZE_ERROR","message":"{}"}}}}"#,
                error
            )
        })
    );
}

fn run() -> Result<HelperResponse, Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    if input.trim().is_empty() {
        return Ok(HelperResponse::err(
            None,
            "EMPTY_REQUEST",
            "Expected one JSON request on stdin.",
        ));
    }

    let request: HelperRequest = serde_json::from_str(&input)?;
    let response = match request {
        HelperRequest::SelfTest { request_id } => HelperResponse::self_test(request_id),
        HelperRequest::Launch(request) => platform::launch(request),
    };
    Ok(response)
}
