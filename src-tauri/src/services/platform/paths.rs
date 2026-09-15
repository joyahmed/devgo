pub fn windows_to_wsl_path(windows_path: &str, distro: &str) -> String {
    let normalized = windows_path.replace('\\', "/");

    let wsl_unc_prefix = format!("//wsl.localhost/{}", distro);
    if normalized.starts_with(&wsl_unc_prefix) {
        return normalized[wsl_unc_prefix.len()..].to_string();
    }

    if normalized == "/" {
        return normalized;
    }

    if let Some(rest) = normalized.strip_prefix('/') {
        if !rest.is_empty() && rest.contains('/') {
            return normalized;
        }
    }

    if normalized.len() >= 3
        && normalized.as_bytes()[1] == b':'
        && normalized.as_bytes()[2] == b'/'
    {
        let drive = (normalized.as_bytes()[0] as char)
            .to_lowercase()
            .to_string();
        return format!("/mnt/{}{}", drive, &normalized[2..]);
    }

    normalized
}
