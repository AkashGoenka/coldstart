package com.example.auth;

/**
 * Interface for authentication — fixture for parser tests.
 */
public interface Authenticatable {

    AuthResult login(LoginRequest request);

}
