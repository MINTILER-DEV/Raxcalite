use crate::AppState;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct Transform<'a> {
    pub cache: bool,
    pub kind: &'a str,
    pub source: &'a str,
    pub encoding: &'a str,
    pub url: &'a str,
    pub debug: bool,
    #[serde(rename = "sourceMaps")]
    pub source_maps: bool,
    pub worker: Option<&'a str>,
}
#[derive(Deserialize)]
pub struct Transformed {
    pub code: String,
    #[serde(default)]
    pub warnings: Vec<String>,
}
pub async fn rewrite(state: &AppState, input: Transform<'_>) -> Result<Transformed, String> {
    let response = state
        .transform
        .post(format!("http://127.0.0.1:{}", state.config.transform_port))
        .bearer_auth(&state.config.transform_token)
        .json(&input)
        .send()
        .await
        .map_err(|_| "Transformer unavailable")?;
    if !response.status().is_success() {
        return Err(
            "Source transformation failed; enable diagnostics and inspect the source syntax".into(),
        );
    }
    response
        .json()
        .await
        .map_err(|_| "Invalid transformer response".into())
}
