#!/usr/bin/env python3
"""Deploy pending migrations and study-assistant before GitHub Pages."""

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
INITIAL_VERSION = "202610310005"
# These deployed versions are now represented by INITIAL_VERSION. This is only
# a migration-ledger transition; an incomplete installation must not be adopted.
SQUASHED_VERSIONS = {
    "202610300001", "202610310001", "202610310002", "202610310003", "202610310004",
}


class DeploymentError(Exception):
    pass


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
    local = set()
    for path in MIGRATIONS.glob("*.sql"):
        match = re.fullmatch(r"([0-9]+)_.+\.sql", path.name)
        if not match or match[1] in local:
            raise DeploymentError("Migration files must have unique numeric versions.")
        local.add(match[1])
    if not local or min(local) != INITIAL_VERSION:
        raise DeploymentError("Keep the initial schema and add new migrations after it.")
    project = project_ref()
    token = os.environ["SUPABASE_ACCESS_TOKEN"]
    remote = remote_versions(project, token)
    obsolete = remote - local
    if obsolete and (obsolete != SQUASHED_VERSIONS or INITIAL_VERSION not in remote):
        raise DeploymentError("Remote migration history is incomplete or unknown. Reconcile it before deploying.")

    run_cli("link", "--project-ref", project, "--yes")
    if obsolete:
        # Only one local file exists through this version: CLI skips schema
        # generation and atomically replaces the six history rows with one.
        run_cli("migration", "squash", "--linked", "--version", INITIAL_VERSION, "--yes")
        if remote_versions(project, token) != remote - obsolete:
            raise DeploymentError("Migration history consolidation did not complete.")
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
