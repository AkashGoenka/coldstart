<?php

namespace App\Services;

use App\Models\User;

class UserService
{
    public function getUser($id)
    {
        return app(User::class)->find($id);
    }

    public function createUser()
    {
        return resolve(User::class);
    }

    public function registerUser()
    {
        app()->bind('user.key', User::class);
    }
}
