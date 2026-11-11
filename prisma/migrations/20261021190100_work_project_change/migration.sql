-- AlterTable
ALTER TABLE "work_project" ADD COLUMN     "modules_seen" JSONB;

-- CreateTable
CREATE TABLE "work_project_change" (
    "project_id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "seq" BIGINT NOT NULL DEFAULT 0,
    "last_tx" BIGINT,

    CONSTRAINT "work_project_change_pkey" PRIMARY KEY ("project_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_project_change_project_id_user_id_key" ON "work_project_change"("project_id", "user_id");

-- AddForeignKey
ALTER TABLE "work_project_change" ADD CONSTRAINT "work_project_change_project_id_user_id_fkey" FOREIGN KEY ("project_id", "user_id") REFERENCES "work_project"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION work_change_init() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "work_project_change" ("project_id", "user_id", "seq") VALUES (NEW."id", NEW."user_id", 0)
  ON CONFLICT ("project_id") DO NOTHING;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS work_change_init ON "work_project";
CREATE TRIGGER work_change_init AFTER INSERT ON "work_project" FOR EACH ROW EXECUTE FUNCTION work_change_init();

INSERT INTO "work_project_change" ("project_id", "user_id", "seq")
SELECT "id", "user_id", 0 FROM "work_project"
ON CONFLICT ("project_id") DO NOTHING;

CREATE OR REPLACE FUNCTION work_change_one(pid text) RETURNS void LANGUAGE sql AS $$
  UPDATE "work_project_change" SET "seq" = "seq" + 1, "last_tx" = txid_current()
  WHERE "project_id" = pid AND "last_tx" IS DISTINCT FROM txid_current();
$$;

CREATE OR REPLACE FUNCTION work_change_ins() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM work_change_one(x.pid) FROM (SELECT DISTINCT project_id AS pid FROM work_change_new WHERE project_id IS NOT NULL) x ORDER BY x.pid;
  RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION work_change_upd() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM work_change_one(x.pid) FROM (
    SELECT project_id AS pid FROM work_change_new WHERE project_id IS NOT NULL
    UNION SELECT project_id FROM work_change_old WHERE project_id IS NOT NULL) x ORDER BY x.pid;
  RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION work_change_del() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM work_change_one(x.pid) FROM (SELECT DISTINCT project_id AS pid FROM work_change_old WHERE project_id IS NOT NULL) x ORDER BY x.pid;
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['data_sheet_rows', 'sheet_row_pair', 'work_task'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS work_change_ins ON %I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS work_change_upd ON %I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS work_change_del ON %I', t);
    EXECUTE format('CREATE TRIGGER work_change_ins AFTER INSERT ON %I REFERENCING NEW TABLE AS work_change_new FOR EACH STATEMENT EXECUTE FUNCTION work_change_ins()', t);
    EXECUTE format('CREATE TRIGGER work_change_upd AFTER UPDATE ON %I REFERENCING OLD TABLE AS work_change_old NEW TABLE AS work_change_new FOR EACH STATEMENT EXECUTE FUNCTION work_change_upd()', t);
    EXECUTE format('CREATE TRIGGER work_change_del AFTER DELETE ON %I REFERENCING OLD TABLE AS work_change_old FOR EACH STATEMENT EXECUTE FUNCTION work_change_del()', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION work_change_pair(a text, b text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM work_change_one(x.pid) FROM (SELECT DISTINCT pid FROM unnest(ARRAY[a, b]) AS pid WHERE pid IS NOT NULL) x ORDER BY x.pid;
END $$;
CREATE OR REPLACE FUNCTION work_change_sheet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM work_change_pair(CASE WHEN TG_OP <> 'INSERT' THEN OLD.project_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.project_id END);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS work_change_ins ON "data_sheets";
DROP TRIGGER IF EXISTS work_change_upd ON "data_sheets";
DROP TRIGGER IF EXISTS work_change_del ON "data_sheets";
CREATE TRIGGER work_change_ins AFTER INSERT ON "data_sheets" FOR EACH ROW EXECUTE FUNCTION work_change_sheet();
CREATE TRIGGER work_change_upd AFTER UPDATE ON "data_sheets" FOR EACH ROW
  WHEN ((OLD."schema", OLD."template", OLD."template_family", OLD."name", OLD."project_id") IS DISTINCT FROM (NEW."schema", NEW."template", NEW."template_family", NEW."name", NEW."project_id"))
  EXECUTE FUNCTION work_change_sheet();
CREATE TRIGGER work_change_del AFTER DELETE ON "data_sheets" FOR EACH ROW EXECUTE FUNCTION work_change_sheet();

CREATE OR REPLACE FUNCTION work_change_ref() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM work_change_pair(CASE WHEN TG_OP <> 'INSERT' THEN OLD.from_project_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.from_project_id END);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS work_change_ins ON "project_reference";
DROP TRIGGER IF EXISTS work_change_upd ON "project_reference";
DROP TRIGGER IF EXISTS work_change_del ON "project_reference";
CREATE TRIGGER work_change_ins AFTER INSERT ON "project_reference" FOR EACH ROW EXECUTE FUNCTION work_change_ref();
CREATE TRIGGER work_change_upd AFTER UPDATE ON "project_reference" FOR EACH ROW EXECUTE FUNCTION work_change_ref();
CREATE TRIGGER work_change_del AFTER DELETE ON "project_reference" FOR EACH ROW EXECUTE FUNCTION work_change_ref();

DROP FUNCTION IF EXISTS work_change_bump() CASCADE;
CREATE OR REPLACE FUNCTION work_change_self() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM work_change_one(NEW."id");
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS work_change_self ON "work_project";
CREATE TRIGGER work_change_self AFTER UPDATE ON "work_project" FOR EACH ROW
  WHEN ((OLD."kind", OLD."settings", OLD."modules", OLD."status", OLD."workflow_id", OLD."approval_settings", OLD."capability_off", OLD."modules_seen")
        IS DISTINCT FROM (NEW."kind", NEW."settings", NEW."modules", NEW."status", NEW."workflow_id", NEW."approval_settings", NEW."capability_off", NEW."modules_seen"))
  EXECUTE FUNCTION work_change_self();
