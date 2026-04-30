#include "include/utils/hash.h"
#include <vector>
#include <string>

namespace App {

class AuthService {
public:
    bool login(const std::string& email, const std::string& password);
};

class LoginRequest {
public:
    std::string email;
    std::string password;
};

bool AuthService::login(const std::string& email, const std::string& password) {
    return !email.empty() && !password.empty();
}

} // namespace App

std::string hashPassword(const std::string& plain) {
    return plain;
}
