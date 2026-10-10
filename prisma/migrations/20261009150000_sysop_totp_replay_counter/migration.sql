ALTER TABLE public.users
  ADD COLUMN "sysopTotpCounter" INTEGER,
  ADD COLUMN "sysopTotpSecretHash" CHAR(64);

ALTER TABLE public.users
  ADD CONSTRAINT "users_sysop_totp_replay_pair"
  CHECK (
    ("sysopTotpCounter" IS NULL AND "sysopTotpSecretHash" IS NULL)
    OR ("sysopTotpCounter" IS NOT NULL AND "sysopTotpSecretHash" IS NOT NULL
        AND "sysopTotpCounter" >= 0)
  );
