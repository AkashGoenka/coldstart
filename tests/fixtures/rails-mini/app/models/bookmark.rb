class Bookmark
  belongs_to :status
  belongs_to :user
  validates :status_id, presence: true
  validates :user_id, presence: true
  before_action :set_defaults
end
