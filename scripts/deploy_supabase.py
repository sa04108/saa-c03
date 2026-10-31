#!/usr/bin/env python3
"""Deploy pending migrations and study-assistant; adopt the confirmed manual baseline once."""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase/migrations"


class DeploymentError(Exception):
    pass


def sql_literal(value):
    return "'" + value.replace("'", "''") + "'"


def project_ref():
    config = (ROOT / "assets/account-config.js").read_text()
    match = re.search(r'''supabaseUrl\s*:\s*["']https://([a-z]{20})\.supabase\.co["']''', config)
    if not match:
        raise DeploymentError("Cannot identify the Supabase project in assets/account-config.js.")
    return match[1]


def database_query(project, token, query):
    # Only deployment metadata is read here, never application rows or secrets.
    request = Request(
        f"https://api.supabase.com/v1/projects/{project}/database/query",
        data=json.dumps({"query": query, "read_only": True}).encode(),
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=30) as response:
            result = json.load(response)
    except HTTPError as error:
        raise DeploymentError(f"Supabase metadata query failed (HTTP {error.code}). Check token/project access.") from None
    except (URLError, TimeoutError, ValueError):
        raise DeploymentError("Could not read Supabase deployment metadata.") from None
    if not isinstance(result, list) or any(not isinstance(row, dict) for row in result):
        raise DeploymentError("Unexpected Supabase metadata response.")
    return result


def remote_versions(project, token):
    rows = database_query(project, token, "select to_regclass('supabase_migrations.schema_migrations') is not null as present")
    if len(rows) != 1 or not isinstance(rows[0].get("present"), bool):
        raise DeploymentError("Could not determine migration history state.")
    if not rows[0]["present"]:
        return set()
    rows = database_query(project, token, "select version from supabase_migrations.schema_migrations order by version")
    if any(not isinstance(row.get("version"), str) or not re.fullmatch(r"[0-9]+", row["version"]) for row in rows):
        raise DeploymentError("Unexpected version in remote migration history.")
    return {row["version"] for row in rows}


def baseline_files():
    baseline = json.loads((ROOT / ".github/supabase-manual-baseline.json").read_text())
    files = []
    for entry in baseline["migrations"]:
        path = MIGRATIONS / entry["file"]
        if path.parent != MIGRATIONS or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
            raise DeploymentError("An applied baseline migration changed. Restore it and add a new migration instead.")
        files.append(path)
    versions = [path.name.split("_", 1)[0] for path in files]
    if not versions or versions != sorted(set(versions)) or versions[-1] != baseline["confirmed_through"]:
        raise DeploymentError("Invalid manual migration baseline manifest.")
    return baseline, files


def expected_functions(files):
    """Follow CREATE/REPLACE and the progress RPC rename in the six baseline files."""
    create = re.compile(r"create(?: or replace)? function public\.(\w+)\s*\((.*?)\)\s*returns\b.*?\bas \$\$(.*?)\$\$;", re.S | re.I)
    rename = re.compile(r"alter function public\.(\w+)\((.*?)\) rename to (\w+);", re.S | re.I)
    functions = {}
    for path in files:
        source = path.read_text()
        events = [(m.start(), "create", m) for m in create.finditer(source)] + [(m.start(), "rename", m) for m in rename.finditer(source)]
        for _, operation, match in sorted(events):
            if operation == "create":
                parameters = [p.strip().split(None, 1)[1] for p in match[2].split(",") if p.strip()]
                signature = match[1] + "(" + ",".join(parameters) + ")"
                functions[signature] = match[3].replace("\r\n", "\n").strip()
            else:
                old = match[1] + "(" + re.sub(r"\s+", "", match[2]) + ")"
                new = match[3] + old[len(match[1]):]
                if old not in functions:
                    raise DeploymentError("Could not resolve a baseline function rename.")
                functions[new] = functions.pop(old)
    if len(functions) != 14:
        raise DeploymentError("Unexpected baseline function definitions.")
    return functions


def baseline_check_sql(files):
    # Final schema after 005. A column existing alone is not proof of a complete migration.
    columns = {
        "study_progress": "user_id uuid!,bank_id text!,revision bigint!,state jsonb!,updated_at timestamptz!",
        "ai_suggestion_cache": "context_id text!,questions jsonb,model text!,prompt_version text!,content_hash text!,generation_id uuid!",
        "ai_usage_windows": "scope text!,window_start timestamptz!,used integer!,expires_at timestamptz!",
        "ai_model_cooldowns": "model text!,retry_at timestamptz!,failure_count integer!,last_error text,last_attempt_started_at timestamptz",
        "ai_conversations": "id uuid!,user_id uuid!,title text!,context jsonb!,created_at timestamptz!,updated_at timestamptz!,last_turn_seq bigint!,summary jsonb,summary_through_seq bigint!,summary_revision integer!,summary_model text,summary_prompt_version text,summary_job_id uuid,summary_job_through_seq bigint,summary_lease_until timestamptz,summary_retry_after timestamptz!",
        "ai_chat_turns": "id uuid!,conversation_id uuid!,question text!,answer text!,created_at timestamptz!,turn_seq bigint!",
        "ai_deleted_conversations": "id uuid!,user_id uuid!",
    }
    checks = []

    def require(label, condition):
        checks.append(f"select {sql_literal(label)} as problem where not coalesce(({condition}), false)")

    for table, definitions in columns.items():
        relation = f"to_regclass('public.{table}')"
        require(table + " RLS", f"select relrowsecurity from pg_class where oid = {relation}")
        require(table + " primary key", f"exists(select 1 from pg_index where indrelid = {relation} and indisprimary and indisvalid)")
        require(table + " write privileges", f"not has_table_privilege('authenticated', {relation}, 'INSERT,UPDATE,DELETE') and not has_table_privilege('anon', {relation}, 'INSERT,UPDATE,DELETE')")
        for definition in definitions.split(","):
            name, type_name = definition.split(" ", 1)
            not_null = type_name.endswith("!")
            require(table + "." + name, f"exists(select 1 from pg_attribute where attrelid = {relation} and attname = '{name}' and not attisdropped and atttypid = to_regtype('{type_name.rstrip('!')}') and attnotnull = {'true' if not_null else 'false'})")

    member_functions = {"save_study_progress", "save_ai_chat_turn", "list_ai_conversation_selection", "delete_ai_conversations"}
    for signature, body in expected_functions(files).items():
        proc = f"to_regprocedure({sql_literal('public.' + signature)})"
        checksum = hashlib.md5(body.encode()).hexdigest()
        require(signature, f"exists(select 1 from pg_proc where oid = {proc} and prosecdef and proconfig @> array['search_path=\"\"'] and md5(btrim(replace(prosrc, E'\\r\\n', E'\\n'), E' \\t\\n\\r')) = '{checksum}')")
        member = "true" if signature.split("(")[0] in member_functions else "false"
        require(signature + " grants", f"not has_function_privilege('anon', {proc}, 'EXECUTE') and has_function_privilege('authenticated', {proc}, 'EXECUTE') = {member}")

    for table, trigger, function in [
        ("ai_chat_turns", "ai_chat_turn_sequence", "sequence_ai_chat_turn()"),
        ("ai_conversations", "guard_deleted_ai_conversation", "guard_deleted_ai_conversation()"),
    ]:
        require(trigger, f"exists(select 1 from pg_trigger where tgrelid = to_regclass('public.{table}') and tgname = '{trigger}' and tgenabled = 'O' and tgtype = 7 and tgfoid = to_regprocedure('public.{function}'))")
    for table, column, parent in [
        ("study_progress", "user_id", "auth.users"), ("ai_conversations", "user_id", "auth.users"),
        ("ai_chat_turns", "conversation_id", "public.ai_conversations"), ("ai_deleted_conversations", "user_id", "auth.users"),
    ]:
        require(table + " cascade", f"exists(select 1 from pg_constraint where conrelid = to_regclass('public.{table}') and contype = 'f' and confrelid = to_regclass('{parent}') and confdeltype = 'c' and convalidated and conkey = array[(select attnum from pg_attribute where attrelid = to_regclass('public.{table}') and attname = '{column}')])")
    for table, policy in [("study_progress", "Read own study progress"), ("ai_conversations", "Read own AI conversations"), ("ai_chat_turns", "Read own AI chat turns")]:
        require(policy, f"exists(select 1 from pg_policy where polrelid = to_regclass('public.{table}') and polname = {sql_literal(policy)} and polcmd = 'r')")
    require("unique turn sequence", "exists(select 1 from pg_index where indexrelid = to_regclass('public.ai_chat_turns_sequence') and indrelid = to_regclass('public.ai_chat_turns') and indisunique and indisvalid)")
    for constraint in ["ai_summary_range", "ai_summary_size"]:
        require(constraint, f"exists(select 1 from pg_constraint where conrelid = to_regclass('public.ai_conversations') and conname = '{constraint}' and convalidated)")
    return "\nunion all\n".join(checks)


def run_cli(*arguments):
    print("Running: supabase " + " ".join(arguments), flush=True)
    result = subprocess.run(["supabase", *arguments], cwd=ROOT, check=False)
    if result.returncode:
        raise DeploymentError("Supabase command failed; subsequent deployments were stopped.")


def deploy():
    if os.environ.get("GITHUB_REF") not in (None, "refs/heads/main"):
        raise DeploymentError("Production deployment is only allowed from main.")
    for name in ("SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD"):
        if not os.environ.get(name):
            raise DeploymentError(f"Set the GitHub Actions repository secret {name} before deployment.")
    project = project_ref()
    token = os.environ["SUPABASE_ACCESS_TOKEN"]
    baseline, files = baseline_files()
    baseline_versions = {path.name.split("_", 1)[0] for path in files}
    local_versions = set()
    for path in sorted(MIGRATIONS.glob("*.sql")):
        match = re.fullmatch(r"([0-9]+)_.+\.sql", path.name)
        if not match or match[1] in local_versions:
            raise DeploymentError("Migration files must have unique numeric versions.")
        version = match[1]
        if version not in baseline_versions and version <= baseline["confirmed_through"]:
            raise DeploymentError("New migrations must sort after the confirmed baseline.")
        local_versions.add(version)
    remote = remote_versions(project, token)
    if remote - local_versions:
        raise DeploymentError("Remote history contains migrations absent from this checkout. Reconcile history before deploying.")
    missing = baseline_versions - remote
    if missing:
        if project != baseline["project_ref"] or remote - baseline_versions:
            raise DeploymentError("This database is not eligible for the confirmed manual baseline. Inspect its history first.")
        problems = database_query(project, token, baseline_check_sql(files))
        if problems:
            labels = ", ".join(str(row.get("problem", "unknown object")) for row in problems)
            raise DeploymentError("Database does not match the complete 005 baseline: " + labels)

    run_cli("link", "--project-ref", project, "--yes")
    if missing:
        # The owner confirmed all six files were applied in SQL Editor. Record
        # only missing history entries; never rerun those SQL statements.
        run_cli("migration", "repair", *sorted(missing), "--status", "applied", "--linked", "--yes")
        if not baseline_versions.issubset(remote_versions(project, token)):
            raise DeploymentError("Manual migration history registration did not complete.")
    run_cli("db", "push", "--linked", "--dry-run", "--skip-vault", "--yes")
    run_cli("db", "push", "--linked", "--skip-vault", "--yes")
    run_cli("functions", "deploy", "study-assistant", "--project-ref", project, "--use-api", "--no-verify-jwt", "--yes")
    print("Supabase deployment completed. GitHub Pages can now deploy.", flush=True)


if __name__ == "__main__":
    try:
        deploy()
    except (DeploymentError, OSError, ValueError) as error:
        print(f"Deployment stopped: {error}", file=sys.stderr)
        sys.exit(1)
