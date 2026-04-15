package com.example.auth;

import com.example.user.UserRepository;
import com.example.token.TokenService;
import java.util.List;
import java.security.MessageDigest;

/**
 * Authentication service — used as a fixture for coldstart parser tests.
 */
public class AuthService implements Authenticatable {

    private static final String ALGORITHM = "SHA-256";
    private static final int MAX_RETRIES = 3;

    private final UserRepository userRepository;
    private final TokenService tokenService;

    public AuthService(UserRepository userRepository, TokenService tokenService) {
        this.userRepository = userRepository;
        this.tokenService = tokenService;
    }

    public AuthResult login(LoginRequest request) {
        User user = userRepository.findByEmail(request.getEmail());
        if (user == null) {
            return AuthResult.failure("User not found");
        }
        boolean valid = verifyPassword(request.getPassword(), user.getPasswordHash());
        if (!valid) {
            return AuthResult.failure("Invalid password");
        }
        String token = tokenService.sign(user.getId());
        return AuthResult.success(token);
    }

    private boolean verifyPassword(String raw, String hash) {
        String hashed = hashPassword(raw);
        return hashed.equals(hash);
    }

    public static String hashPassword(String password) {
        try {
            MessageDigest digest = MessageDigest.getInstance(ALGORITHM);
            byte[] bytes = digest.digest(password.getBytes());
            return bytesToHex(bytes);
        } catch (Exception e) {
            throw new RuntimeException("Hash failed", e);
        }
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
