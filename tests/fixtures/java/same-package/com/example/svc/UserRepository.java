package com.example.svc;

public interface UserRepository {
    UserDto findById(long id);
}
