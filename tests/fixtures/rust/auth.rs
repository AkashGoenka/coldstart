use std::collections::HashMap;

pub mod token;
pub mod hash;

pub struct AuthService {
    users: HashMap<String, String>,
}

pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

pub struct AuthResult {
    pub token: String,
    pub user_id: String,
}

impl AuthService {
    pub fn new() -> Self {
        AuthService {
            users: HashMap::new(),
        }
    }

    pub fn login(&self, req: LoginRequest) -> Result<AuthResult, String> {
        let _ = req;
        Err("not implemented".to_string())
    }

    pub fn validate_token(&self, token: &str) -> Result<String, String> {
        let _ = token;
        Ok("user_id".to_string())
    }
}

pub fn hash_password(plain: &str) -> String {
    format!("{:x}", plain.len())
}

pub trait Authenticator {
    fn authenticate(&self, email: &str, password: &str) -> bool;
}
