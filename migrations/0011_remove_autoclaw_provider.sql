DO $$
BEGIN
  DELETE FROM "models" WHERE "provider_id" = 'autoclaw';
  DELETE FROM "providers" WHERE "id" = 'autoclaw';
END;
$$;
