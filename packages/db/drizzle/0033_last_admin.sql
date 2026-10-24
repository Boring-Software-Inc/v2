CREATE OR REPLACE FUNCTION "member_keeps_an_admin"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF NOT ('admin' = ANY(string_to_array(replace(OLD.role, ' ', ''), ','))) THEN
		RETURN NULL;
	END IF;
	IF TG_OP = 'UPDATE'
		AND NEW.organization_id = OLD.organization_id
		AND 'admin' = ANY(string_to_array(replace(NEW.role, ' ', ''), ',')) THEN
		RETURN NULL;
	END IF;
	PERFORM 1 FROM "organization"
		WHERE "id" = OLD.organization_id AND "is_personal" = false
		FOR UPDATE;
	IF NOT FOUND THEN
		RETURN NULL;
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM "member"
		WHERE "organization_id" = OLD.organization_id
			AND 'admin' = ANY(string_to_array(replace("role", ' ', ''), ','))
	) THEN
		RAISE EXCEPTION 'an org must keep at least one admin'
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "member_keeps_an_admin"
	AFTER DELETE OR UPDATE OF "role", "organization_id" ON "member"
	FOR EACH ROW EXECUTE FUNCTION "member_keeps_an_admin"();
