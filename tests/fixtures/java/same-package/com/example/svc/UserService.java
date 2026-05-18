package com.example.svc;

@Service
public class UserService extends BaseService {

    private final UserRepository repo;

    public UserService(UserRepository repo) {
        this.repo = repo;
    }

    @Override
    protected String name() {
        return "users";
    }

    public UserDto fetch(long id) {
        return repo.findById(id);
    }
}
