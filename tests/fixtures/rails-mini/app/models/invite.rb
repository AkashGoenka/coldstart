class Invite < ApplicationRecord
  # Top-level homonym. A nesting-aware resolver must NOT pick this when a
  # reference appears inside `module Members` and Members::Invite exists.
end
