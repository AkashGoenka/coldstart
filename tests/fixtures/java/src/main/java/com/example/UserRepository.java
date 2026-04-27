package com.example;

public interface UserRepository {
    User findByEmail(String email);
}
