CREATE TABLE admin_password (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
