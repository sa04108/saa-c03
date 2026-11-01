#!/usr/bin/env python3
"""Deploy pending migrations and study-assistant before GitHub Pages."""

import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase/migrations"


class DeploymentError(Exception):
    pass


def project_ref():
    config = (ROOT / "src/lib/backend/config.js").read_text()
    match = re.search(r'''supabaseUrl\s*:\s*["']https://([a-z]{20})\.supabase\.co["']''', config)
    if not match:
        raise DeploymentError("Cannot identify the Supabase project in src/lib/backend/config.js.")
    return match[1]


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
    if not local:
        raise DeploymentError("No SQL migration files found in supabase/migrations.")
    project = project_ref()

    run_cli("link", "--project-ref", project, "--yes")
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
