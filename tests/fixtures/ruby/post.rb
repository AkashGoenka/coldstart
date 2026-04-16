require_relative './application_record'

# Rails-style model fixture for coldstart parser tests.
class Post < ApplicationRecord
  belongs_to :user
  has_many :comments
  has_one :featured_image

  before_action :set_post

  validates :title, presence: true

  def self.published
    where(published: true)
  end

  def publish!
    update!(published: true)
  end

  private

  def set_post
    @post = Post.find(params[:id])
  end
end
