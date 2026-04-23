<?php

namespace App\Auth;

use App\Repositories\UserRepository;
use App\Services\TokenService;

class LoginRequest
{
    public string $email;
    public string $password;

    public function __construct(string $email, string $password)
    {
        $this->email = $email;
        $this->password = $password;
    }
}

class AuthResult
{
    public string $token;
    public string $userId;
}

class AuthService extends BaseService implements AuthInterface
{
    private UserRepository $userRepository;
    private TokenService $tokenService;

    public function __construct(UserRepository $userRepository, TokenService $tokenService)
    {
        $this->userRepository = $userRepository;
        $this->tokenService = $tokenService;
    }

    public function login(LoginRequest $request): AuthResult
    {
        $user = $this->userRepository->findByEmail($request->email);
        if (!$user) {
            throw new \Exception('User not found');
        }
        if (!$this->verifyPassword($request->password, $user->passwordHash)) {
            throw new \Exception('Invalid credentials');
        }
        $token = $this->tokenService->sign(['userId' => $user->id]);
        $result = new AuthResult();
        $result->token = $token;
        $result->userId = $user->id;
        return $result;
    }

    public function verifyPassword(string $plain, string $hashed): bool
    {
        return self::hashPassword($plain) === $hashed;
    }

    public static function hashPassword(string $plain): string
    {
        return hash('sha256', $plain);
    }
}

interface AuthInterface
{
    public function login(LoginRequest $request): AuthResult;
    public function verifyPassword(string $plain, string $hashed): bool;
}
