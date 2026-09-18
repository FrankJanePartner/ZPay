use chacha20poly1305::{aead::{Aead, AeadCore, KeyInit, OsRng, Payload}, XChaCha20Poly1305, XNonce};
use std::{fs::{self, File}, io::Write, path::Path};
use zeroize::Zeroizing;

pub fn seal(key: &[u8; 32], merchant: &str, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| "Invalid vault key")?;
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let encrypted = cipher.encrypt(&nonce, Payload { msg: plaintext, aad: merchant.as_bytes() })
        .map_err(|_| "Recovery encryption failed")?;
    let mut result = nonce.to_vec();
    result.extend(encrypted);
    Ok(result)
}

pub fn open(key: &[u8; 32], merchant: &str, ciphertext: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    if ciphertext.len() < 40 { return Err("Invalid encrypted recovery record".into()); }
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| "Invalid vault key")?;
    cipher.decrypt(XNonce::from_slice(&ciphertext[..24]), Payload {
        msg: &ciphertext[24..], aad: merchant.as_bytes()
    }).map(Zeroizing::new).map_err(|_| "Recovery authentication failed".into())
}

// Atomic, no-overwrite persistence. fsync the file and parent before replying.
pub fn persist_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Missing parent directory")?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist_noclobber(path).map_err(|e| e.to_string())?;
    File::open(parent).and_then(|f| f.sync_all()).map_err(|e| e.to_string())
}

pub fn private_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovery_roundtrip_rejects_wrong_merchant_key_and_tampering() {
        let key = [7; 32];
        let bytes = seal(&key, "42", b"test-only recovery payload").unwrap();
        assert_eq!(&**open(&key, "42", &bytes).unwrap(), b"test-only recovery payload");
        assert!(open(&key, "43", &bytes).is_err());
        assert!(open(&[8; 32], "42", &bytes).is_err());
        let mut corrupted = bytes;
        corrupted[25] ^= 1;
        assert!(open(&key, "42", &corrupted).is_err());
    }
    #[test]
    fn persistence_never_overwrites_an_existing_record() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("request.json");
        persist_new(&path, b"original").unwrap();
        assert!(persist_new(&path, b"replacement").is_err());
        assert_eq!(fs::read(path).unwrap(), b"original");
    }
}

