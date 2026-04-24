import Foundation
import UIKit

protocol AuthInterface {
    func login(username: String, password: String) -> Bool
    func logout()
}

class BaseService {
    func initialize() {}
}

class AuthService: BaseService, AuthInterface {
    private var token: String?

    func login(username: String, password: String) -> Bool {
        token = username
        return true
    }

    func logout() {
        token = nil
    }
}

struct LoginRequest {
    let username: String
    let password: String
}

enum AuthError: Error {
    case invalidCredentials
    case networkFailure
}

func generateToken(userId: String) -> String {
    return userId
}
