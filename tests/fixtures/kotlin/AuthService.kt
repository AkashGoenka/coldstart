package com.example.auth

import com.example.repositories.UserRepository
import com.example.services.TokenService
import java.security.MessageDigest

data class LoginRequest(
    val email: String,
    val password: String
)

data class AuthResult(
    val token: String,
    val userId: String
)

class AuthService(
    private val userRepository: UserRepository,
    private val tokenService: TokenService
) : BaseService(), AuthInterface {

    fun login(request: LoginRequest): AuthResult {
        val user = userRepository.findByEmail(request.email)
            ?: throw IllegalArgumentException("User not found")
        if (!verifyPassword(request.password, user.passwordHash)) {
            throw IllegalArgumentException("Invalid credentials")
        }
        val token = tokenService.sign(mapOf("userId" to user.id))
        return AuthResult(token = token, userId = user.id)
    }

    fun verifyPassword(plain: String, hashed: String): Boolean {
        return hashPassword(plain) == hashed
    }

    companion object {
        fun hashPassword(plain: String): String {
            val digest = MessageDigest.getInstance("SHA-256")
            val bytes = digest.digest(plain.toByteArray())
            return bytes.joinToString("") { "%02x".format(it) }
        }
    }
}

interface AuthInterface {
    fun login(request: LoginRequest): AuthResult
    fun verifyPassword(plain: String, hashed: String): Boolean
}
