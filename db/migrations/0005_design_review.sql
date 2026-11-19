-- Design review accounts: people (or design tools) who sign in with DESIGN_CODE instead of the invite code.
-- Their ids start with "d:" so they never share an account with a tester of the same name,
-- and they stop working as soon as the DESIGN_CODE secret is removed.
ALTER TABLE users ADD COLUMN is_design INTEGER NOT NULL DEFAULT 0;
