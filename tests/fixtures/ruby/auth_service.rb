require 'bcrypt'
require_relative './user_repository'
require_relative './token_service'

# Authentication service fixture for coldstart parser tests.
module Auth
  class AuthService
    MAX_RETRIES = 3

    def initialize(user_repository, token_service)
      @user_repository = user_repository
      @token_service = token_service
    end

    def login(email, password)
      user = @user_repository.find_by_email(email)
      return AuthResult.failure('User not found') unless user

      valid = verify_password(password, user.password_hash)
      return AuthResult.failure('Invalid password') unless valid

      token = @token_service.sign(user.id)
      AuthResult.success(token)
    end

    def self.hash_password(password)
      BCrypt::Password.create(password)
    end

    private

    def verify_password(raw, hash)
      BCrypt::Password.new(hash) == raw
    end
  end
end
