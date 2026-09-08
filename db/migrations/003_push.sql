CREATE TABLE IF NOT EXISTS push_subscriptions (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 endpoint text NOT NULL, p256dh text NOT NULL, auth text NOT NULL,
 language text NOT NULL CHECK(language IN ('mk','en')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_user_idx ON push_subscriptions(user_id);
CREATE TABLE IF NOT EXISTS push_deliveries (
 subscription_id text NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
 day text NOT NULL, status text NOT NULL, attempts integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(subscription_id,day)
);
