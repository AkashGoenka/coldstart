using System;
using System.Security.Cryptography;
using System.Text;
using ExampleApp.Repositories;
using ExampleApp.Services;

namespace ExampleApp.Auth
{
    public class LoginRequest
    {
        public string Email { get; set; }
        public string Password { get; set; }
    }

    public class AuthResult
    {
        public string Token { get; set; }
        public string UserId { get; set; }
    }

    public class AuthService : IAuthService
    {
        private readonly IUserRepository _userRepository;
        private readonly ITokenService _tokenService;

        public AuthService(IUserRepository userRepository, ITokenService tokenService)
        {
            _userRepository = userRepository;
            _tokenService = tokenService;
        }

        public AuthResult Login(LoginRequest request)
        {
            var user = _userRepository.FindByEmail(request.Email);
            if (user == null) throw new Exception("User not found");
            if (!VerifyPassword(request.Password, user.PasswordHash))
                throw new Exception("Invalid credentials");
            var token = _tokenService.Sign(new { UserId = user.Id });
            return new AuthResult { Token = token, UserId = user.Id };
        }

        public bool VerifyPassword(string plain, string hashed)
        {
            return HashPassword(plain) == hashed;
        }

        public static string HashPassword(string plain)
        {
            using var sha = SHA256.Create();
            var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(plain));
            return BitConverter.ToString(bytes).Replace("-", "").ToLower();
        }
    }

    public interface IAuthService
    {
        AuthResult Login(LoginRequest request);
        bool VerifyPassword(string plain, string hashed);
    }
}
