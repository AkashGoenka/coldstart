package com.example.svc

@Service
class UserService(private val repo: UserRepository) : BaseService() {

    override fun name(): String = "users"

    fun fetch(id: Long): UserDto = repo.findById(id)
}
