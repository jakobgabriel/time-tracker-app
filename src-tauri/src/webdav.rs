use std::time::Duration;

use reqwest::{Client, Method, StatusCode, Url};

use crate::error::{AppError, Result};
use crate::models::Settings;

/// A minimal WebDAV client — just the four verbs an Obsidian vault needs.
/// Works against Nextcloud/ownCloud, Synology, mailbox.org, and any other
/// plain WebDAV share that Obsidian's own sync plugins target.
pub struct Dav {
    client: Client,
    base: Url,
    username: String,
    password: String,
}

impl Dav {
    pub fn from_settings(settings: &Settings) -> Result<Self> {
        let raw = settings.webdav_url.trim();
        if raw.is_empty() {
            return Err(AppError::NotConfigured);
        }
        let mut base = Url::parse(raw)
            .map_err(|_| AppError::Invalid(format!("`{raw}` is not a valid URL")))?;
        if !matches!(base.scheme(), "http" | "https") {
            return Err(AppError::Invalid(
                "the URL must start with http:// or https://".into(),
            ));
        }
        // A directory URL: makes joining relative paths predictable.
        if !base.path().ends_with('/') {
            let path = format!("{}/", base.path());
            base.set_path(&path);
        }

        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(15))
            .user_agent("Tempo/0.1 (+tauri)")
            .build()?;

        Ok(Self {
            client,
            base,
            username: settings.username.trim().to_string(),
            password: settings.password.clone(),
        })
    }

    fn url_for(&self, path: &str, directory: bool) -> Result<Url> {
        let mut url = self.base.clone();
        {
            let mut segments = url
                .path_segments_mut()
                .map_err(|_| AppError::Invalid("the URL cannot have a path".into()))?;
            segments.pop_if_empty();
            for part in path.split('/').filter(|part| !part.is_empty()) {
                segments.push(part);
            }
            if directory {
                segments.push("");
            }
        }
        Ok(url)
    }

    fn request(&self, method: Method, url: Url) -> reqwest::RequestBuilder {
        let builder = self.client.request(method, url);
        if self.username.is_empty() && self.password.is_empty() {
            builder
        } else {
            builder.basic_auth(&self.username, Some(&self.password))
        }
    }

    fn explain(status: StatusCode) -> AppError {
        let hint = match status {
            StatusCode::UNAUTHORIZED => {
                "the server rejected the credentials (use an app password if your provider requires one)"
            }
            StatusCode::FORBIDDEN => "the account is not allowed to access this path",
            StatusCode::NOT_FOUND => "the server has no such path — check the WebDAV URL",
            StatusCode::METHOD_NOT_ALLOWED => "the URL does not point at a WebDAV share",
            StatusCode::INSUFFICIENT_STORAGE => "the server is out of space",
            _ => "unexpected response",
        };
        AppError::Server(format!("{} ({})", hint, status.as_u16()))
    }

    /// Verifies URL + credentials without changing anything on the server.
    pub async fn check(&self) -> Result<()> {
        let method = Method::from_bytes(b"PROPFIND").expect("valid method");
        let response = self
            .request(method, self.url_for("", true)?)
            .header("Depth", "0")
            .header("Content-Type", "application/xml")
            .body(r#"<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop/></d:propfind>"#)
            .send()
            .await?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(Self::explain(response.status()))
        }
    }

    /// Creates a folder and every missing parent, `mkdir -p` style.
    pub async fn ensure_folder(&self, folder: &str) -> Result<()> {
        let method = Method::from_bytes(b"MKCOL").expect("valid method");
        let mut walked = String::new();
        for part in folder.split('/').filter(|part| !part.is_empty()) {
            walked.push_str(part);
            walked.push('/');
            let response = self
                .request(method.clone(), self.url_for(&walked, true)?)
                .send()
                .await?;
            // 405 means it is already there, which is exactly what we want.
            if !response.status().is_success()
                && response.status() != StatusCode::METHOD_NOT_ALLOWED
            {
                return Err(Self::explain(response.status()));
            }
        }
        Ok(())
    }

    /// Reads a note, or `None` when the server does not have it yet.
    pub async fn get(&self, path: &str) -> Result<Option<String>> {
        let response = self
            .request(Method::GET, self.url_for(path, false)?)
            .send()
            .await?;
        match response.status() {
            StatusCode::NOT_FOUND => Ok(None),
            status if status.is_success() => Ok(Some(response.text().await?)),
            status => Err(Self::explain(status)),
        }
    }

    pub async fn put(&self, path: &str, body: String) -> Result<()> {
        let response = self
            .request(Method::PUT, self.url_for(path, false)?)
            .header("Content-Type", "text/markdown; charset=utf-8")
            .body(body)
            .send()
            .await?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(Self::explain(response.status()))
        }
    }
}
