package com.example.svc

interface UserRepository {
    fun findById(id: Long): UserDto
}
