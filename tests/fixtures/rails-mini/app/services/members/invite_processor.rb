module Members
  class InviteProcessor
    def call
      # Bare `Invite` reference inside `module Members`. Ruby resolves this to
      # Members::Invite (lexical nesting), not the top-level Invite.
      Invite.find(1)
    end
  end
end
