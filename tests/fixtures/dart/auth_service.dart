import 'package:crypto/crypto.dart';
import 'package:auth/user_repository.dart';
import 'package:auth/token_service.dart';

class LoginRequest {
  final String email;
  final String password;

  const LoginRequest({required this.email, required this.password});
}

class AuthResult {
  final String token;
  final String userId;

  const AuthResult({required this.token, required this.userId});
}

class AuthService extends BaseService implements AuthInterface {
  final UserRepository _userRepository;
  final TokenService _tokenService;

  AuthService(this._userRepository, this._tokenService);

  Future<AuthResult> login(LoginRequest request) async {
    final user = await _userRepository.findByEmail(request.email);
    if (user == null) throw Exception('User not found');
    if (!verifyPassword(request.password, user.passwordHash)) {
      throw Exception('Invalid credentials');
    }
    final token = _tokenService.sign({'userId': user.id});
    return AuthResult(token: token, userId: user.id);
  }

  bool verifyPassword(String plain, String hashed) {
    return hashPassword(plain) == hashed;
  }

  static String hashPassword(String plain) {
    final bytes = utf8.encode(plain);
    return sha256.convert(bytes).toString();
  }
}

abstract class AuthInterface {
  Future<AuthResult> login(LoginRequest request);
  bool verifyPassword(String plain, String hashed);
}

String generateToken(String userId) {
  return sha256.convert(utf8.encode(userId)).toString();
}
