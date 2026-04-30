<?php
namespace App;

use App\Models\User;

class AuthService {
    public function findUser(): User {
        return new User();
    }
}
