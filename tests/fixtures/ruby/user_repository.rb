require_relative './models/user'

# User repository fixture for coldstart parser tests.
class UserRepository
  include Enumerable

  def find_by_email(email)
    @users.find { |u| u.email == email }
  end

  def find_by_id(id)
    @users.find { |u| u.id == id }
  end

  def all
    @users
  end
end
