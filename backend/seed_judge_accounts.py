import argparse
import os

from app.config import settings
from app.database import SessionLocal
from app.judge_demo import (
    JUDGE_ACCOUNTS,
    revoke_judge_accounts,
    seed_judge_accounts,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create or revoke temporary OpsWork judge demo accounts."
    )
    parser.add_argument(
        "--revoke",
        action="store_true",
        help="Deactivate the judge accounts without changing their passwords.",
    )
    args = parser.parse_args()

    if not settings.is_production:
        raise SystemExit("Judge accounts can only be managed in production.")
    if not args.revoke and os.getenv("JUDGE_DEMO_ENABLED", "").lower() != "true":
        raise SystemExit(
            "Set JUDGE_DEMO_ENABLED=true for the one-time account provisioning step."
        )

    with SessionLocal() as db:
        if args.revoke:
            print(
                f"Deactivated {revoke_judge_accounts(db)} judge demo account(s)."
            )
            return

        passwords = seed_judge_accounts(db)

    print("Judge accounts are ready. Share these credentials privately:")
    for account in JUDGE_ACCOUNTS:
        print(
            f"{account['key'].title()} ({account['email']}): "
            f"{passwords[account['email']]}"
        )
    print("Passwords are displayed only once. Store them securely.")


if __name__ == "__main__":
    main()
