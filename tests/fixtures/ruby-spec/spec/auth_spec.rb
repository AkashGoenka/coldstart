require 'support/helpers'

RSpec.describe 'AuthService' do
  include Helpers

  it 'logs in' do
    user = stub_user
    expect(user.id).to eq(1)
  end
end
