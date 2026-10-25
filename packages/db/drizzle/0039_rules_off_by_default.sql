INSERT INTO "rule_configs" ("id", "repo_id", "rule_id", "version", "enabled", "config", "updated_at")
SELECT
	encode(
		set_bit(
			set_bit(
				overlay(
					uuid_send(gen_random_uuid())
					placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
					FROM 1 FOR 6
				),
				52, 1
			),
			53, 1
		),
		'hex'
	)::uuid::text,
	r."id",
	b."rule_id",
	1,
	true,
	b."config",
	now()
FROM "repos" r
CROSS JOIN (
	VALUES
		('account-age', '{"minDays":7}'::jsonb, true),
		('crypto-address', '{}'::jsonb, true),
		('honeypot', '{"paths":[".github/workflows/**"]}'::jsonb, true),
		('max-files-changed', '{"max":200}'::jsonb, true),
		('english-only', '{"maxNonLatinRatio":0.5}'::jsonb, false)
) AS b("rule_id", "config", "github_only")
WHERE r."forge" = 'github' OR NOT b."github_only"
ON CONFLICT ("repo_id", "rule_id") DO NOTHING;
